import uuid
from datetime import datetime, timezone
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.database import db
from app.core.security import create_access_token
from app.core.permissions import (
    ROLE_SUPER_ADMIN,
    ROLE_OPERATOR,
    ROLE_WAREHOUSE_MANAGER,
    get_user_effective_permissions,
)
from app.services.seed_data import init_seed_data

client = TestClient(app)
ORG_ID = "org_triwiz_01"
WH_ID = "wh_chicago_01"

@pytest.fixture(autouse=True)
def setup_test_db():
    init_seed_data()

def make_token(role: str, user_id: str, warehouse_id: str = WH_ID) -> str:
    user = {
        "id": user_id,
        "email": f"{user_id}@stockpilot.ai",
        "full_name": f"Rural Test {user_id}",
        "role": role,
        "org_id": ORG_ID,
        "warehouse_id": warehouse_id,
        "warehouse_ids": [warehouse_id] if warehouse_id else [],
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    db.set_document("users", user_id, user)
    perms = list(get_user_effective_permissions(user))
    return create_access_token(
        subject=user["id"],
        extra_claims={
            "email": user["email"],
            "role": user["role"],
            "org_id": user["org_id"],
            "warehouse_id": user.get("warehouse_id"),
            "warehouse_ids": user.get("warehouse_ids", []),
            "permissions": perms,
        }
    )

def test_ruralreach_snapshot_download():
    """Verify RuralReach snapshot returns authorized catalogue, inventory, batches and cached AI recommendations."""
    token = make_token(ROLE_OPERATOR, "usr_rural_operator", WH_ID)
    res = client.get(
        f"/api/v1/ruralreach/snapshot?warehouse_id={WH_ID}",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 200
    data = res.json()

    assert "products" in data
    assert len(data["products"]) > 0
    assert "inventory" in data
    assert "batches" in data
    assert "checksum" in data
    assert "server_time" in data
    assert data["warehouse"]["id"] == WH_ID

    # Verify products include key attributes
    first_p = data["products"][0]
    assert "sku" in first_p
    assert "name" in first_p
    assert "unit" in first_p

    # Verify recommendations are tagged as cached
    if data["recommendations"]:
        assert data["recommendations"]["is_cached"] is True
        assert "disclaimer" in data["recommendations"]

def test_ruralreach_sync_receive_and_dispatch():
    """Verify batch synchronization of offline-queued receive and dispatch transactions."""
    token = make_token(ROLE_OPERATOR, "usr_rural_operator", WH_ID)

    txn_receive = f"RURAL-REC-{uuid.uuid4().hex[:8]}"
    txn_dispatch = f"RURAL-DISP-{uuid.uuid4().hex[:8]}"

    # Get an existing product
    products = db.query("products", org_id=ORG_ID)
    assert len(products) > 0
    test_prod = products[0]["id"]

    sync_payload = {
        "device_id": "rural-tablet-01",
        "warehouse_id": WH_ID,
        "client_sync_time": datetime.now(timezone.utc).isoformat(),
        "transactions": [
            {
                "transaction_id": txn_receive,
                "action": "RECEIVE",
                "payload": {
                    "product_id": test_prod,
                    "quantity": 100,
                    "batch_number": "BN-RURAL-REC-01",
                    "supplier_reference": "Direct Farmer Coop",
                    "unit_cost": 15.0,
                    "storage_bin": "BIN-RURAL-01"
                },
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "client_notes": "Offline received at village hub"
            },
            {
                "transaction_id": txn_dispatch,
                "action": "DISPATCH",
                "payload": {
                    "product_id": test_prod,
                    "quantity": 10,
                    "destination_id": "VILLAGE_HEALTH_CLINIC_01"
                },
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "client_notes": "Offline emergency dispatch"
            }
        ]
    }

    res = client.post(
        "/api/v1/ruralreach/sync",
        json=sync_payload,
        headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 200
    res_data = res.json()
    assert res_data["success"] is True
    assert res_data["synced_count"] == 2
    assert res_data["conflict_count"] == 0

    results_map = {r["transaction_id"]: r["status"] for r in res_data["results"]}
    assert results_map[txn_receive] == "COMMITTED"
    assert results_map[txn_dispatch] == "COMMITTED"

def test_ruralreach_idempotency_prevents_duplicate_stock_movements():
    """Verify that re-sending an already synchronized transaction does not duplicate stock movements."""
    token = make_token(ROLE_OPERATOR, "usr_rural_operator", WH_ID)
    txn_id = f"RURAL-IDEMP-{uuid.uuid4().hex[:8]}"

    products = db.query("products", org_id=ORG_ID)
    test_prod = products[0]["id"]

    # Initial stock level
    inv_before = db.query("inventory", filters={"warehouse_id": WH_ID, "product_id": test_prod}, org_id=ORG_ID)
    stock_before = inv_before[0]["available_quantity"] if inv_before else 0

    sync_payload = {
        "device_id": "rural-tablet-01",
        "warehouse_id": WH_ID,
        "client_sync_time": datetime.now(timezone.utc).isoformat(),
        "transactions": [
            {
                "transaction_id": txn_id,
                "action": "RECEIVE",
                "payload": {
                    "product_id": test_prod,
                    "quantity": 50,
                    "batch_number": "BN-IDEMP-01",
                    "unit_cost": 12.0
                },
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
        ]
    }

    # First sync: Committed
    res1 = client.post("/api/v1/ruralreach/sync", json=sync_payload, headers={"Authorization": f"Bearer {token}"})
    assert res1.status_code == 200
    assert res1.json()["results"][0]["status"] == "COMMITTED"

    # Second sync with identical transaction ID: Must be ALREADY_COMMITTED
    res2 = client.post("/api/v1/ruralreach/sync", json=sync_payload, headers={"Authorization": f"Bearer {token}"})
    assert res2.status_code == 200
    assert res2.json()["results"][0]["status"] == "ALREADY_COMMITTED"

    # Verify inventory was incremented by exactly 50 (not 100)
    inv_after = db.query("inventory", filters={"warehouse_id": WH_ID, "product_id": test_prod}, org_id=ORG_ID)
    assert inv_after[0]["available_quantity"] == stock_before + 50

def test_ruralreach_conflict_detection_needs_review():
    """Verify that an offline dispatch exceeding server stock is flagged as NEEDS_REVIEW rather than silently dropped."""
    token = make_token(ROLE_OPERATOR, "usr_rural_operator", WH_ID)
    txn_id = f"RURAL-CONF-{uuid.uuid4().hex[:8]}"

    products = db.query("products", org_id=ORG_ID)
    test_prod = products[0]["id"]

    # Request impossible quantity (999,999 units)
    sync_payload = {
        "device_id": "rural-tablet-01",
        "warehouse_id": WH_ID,
        "client_sync_time": datetime.now(timezone.utc).isoformat(),
        "transactions": [
            {
                "transaction_id": txn_id,
                "action": "DISPATCH",
                "payload": {
                    "product_id": test_prod,
                    "quantity": 999999,
                    "destination_id": "REMOTE_VILLAGE"
                },
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
        ]
    }

    res = client.post("/api/v1/ruralreach/sync", json=sync_payload, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    res_data = res.json()
    assert res_data["conflict_count"] == 1
    conflict_res = res_data["results"][0]
    assert conflict_res["status"] == "NEEDS_REVIEW"
    assert "conflict_id" in conflict_res

    # Verify conflict appears in conflicts listing
    conf_list_res = client.get(f"/api/v1/ruralreach/conflicts?warehouse_id={WH_ID}", headers={"Authorization": f"Bearer {token}"})
    assert conf_list_res.status_code == 200
    conflicts = conf_list_res.json()
    matched = [c for c in conflicts if c["transaction_id"] == txn_id]
    assert len(matched) == 1
    assert matched[0]["status"] == "NEEDS_REVIEW"

def test_ruralreach_conflict_resolution():
    """Verify that a manager can resolve a flagged conflict via DISCARD_DRAFT or APPROVE_OVERRIDE."""
    mgr_token = make_token(ROLE_WAREHOUSE_MANAGER, "usr_rural_mgr", WH_ID)
    op_token = make_token(ROLE_OPERATOR, "usr_rural_op", WH_ID)

    # 1. Create a conflict via operator sync
    txn_id = f"RURAL-CONF-RES-{uuid.uuid4().hex[:8]}"
    products = db.query("products", org_id=ORG_ID)
    test_prod = products[0]["id"]

    sync_payload = {
        "device_id": "rural-tablet-02",
        "warehouse_id": WH_ID,
        "client_sync_time": datetime.now(timezone.utc).isoformat(),
        "transactions": [
            {
                "transaction_id": txn_id,
                "action": "DISPATCH",
                "payload": {"product_id": test_prod, "quantity": 888888},
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
        ]
    }
    sync_res = client.post("/api/v1/ruralreach/sync", json=sync_payload, headers={"Authorization": f"Bearer {op_token}"})
    conflict_id = sync_res.json()["results"][0]["conflict_id"]

    # 2. Manager resolves via DISCARD_DRAFT
    res_discard = client.post(
        f"/api/v1/ruralreach/conflicts/{conflict_id}/resolve",
        json={"resolution_action": "DISCARD_DRAFT", "notes": "Duplicate local entry dismissed by manager"},
        headers={"Authorization": f"Bearer {mgr_token}"}
    )
    assert res_discard.status_code == 200
    assert res_discard.json()["status"] == "DISCARDED"

    # Verify no longer listed as NEEDS_REVIEW
    conf_list = client.get(f"/api/v1/ruralreach/conflicts?warehouse_id={WH_ID}", headers={"Authorization": f"Bearer {mgr_token}"}).json()
    assert conflict_id not in [c["id"] for c in conf_list]
