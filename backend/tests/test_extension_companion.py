import pytest
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient

from app.main import app
from app.core.database import db
from app.core.security import create_access_token
from app.core.permissions import (
    ROLE_SUPER_ADMIN,
    ROLE_ORG_ADMIN,
    ROLE_SUPPLY_CHAIN_MANAGER,
    ROLE_WAREHOUSE_MANAGER,
    ROLE_OPERATOR,
    ROLE_DISTRIBUTOR,
    get_user_effective_permissions,
)
from app.services.seed_data import init_seed_data

client = TestClient(app)
ORG_PRIMARY = "org_triwiz_01"

@pytest.fixture(autouse=True)
def setup_test_db():
    init_seed_data()

def make_role_token(role: str, user_id: str, org_id: str = ORG_PRIMARY, warehouse_id: str = "wh_chicago_01") -> str:
    user = {
        "id": user_id,
        "email": f"{user_id}@stockpilot.ai",
        "full_name": f"Test {user_id}",
        "role": role,
        "org_id": org_id,
        "warehouse_id": warehouse_id,
        "warehouse_ids": [warehouse_id] if warehouse_id else [],
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    db.set_document("users", user_id, user)
    permissions = list(get_user_effective_permissions(user))
    return create_access_token(
        subject=user["id"],
        extra_claims={
            "email": user["email"],
            "role": user["role"],
            "org_id": user["org_id"],
            "warehouse_id": user.get("warehouse_id"),
            "warehouse_ids": user.get("warehouse_ids", []),
            "permissions": permissions,
        }
    )

@pytest.fixture
def auth_tokens():
    """Generate authenticated tokens for all 6 roles."""
    roles = {
        "super_admin": ROLE_SUPER_ADMIN,
        "org_admin": ROLE_ORG_ADMIN,
        "supply_chain_manager": ROLE_SUPPLY_CHAIN_MANAGER,
        "warehouse_manager": ROLE_WAREHOUSE_MANAGER,
        "distributor": ROLE_DISTRIBUTOR,
        "operator": ROLE_OPERATOR,
    }
    tokens = {}
    for r_key, r_val in roles.items():
        wh = "wh_chicago_01" if r_key != "super_admin" else None
        tokens[r_key] = make_role_token(r_val, f"usr_{r_key}_companion", warehouse_id=wh)
    return tokens


def test_extension_login_contract():
    """Verify backend login endpoint returns valid JWT token and rejects invalid credentials."""
    # Positive login with seed user
    res_valid = client.post("/api/v1/auth/login", json={
        "email": "operator@stockpilot.ai",
        "password": "Password123!"
    })
    # If password is Admin123! or Password123!, verify contract
    if res_valid.status_code != 200:
        res_valid = client.post("/api/v1/auth/login", json={
            "email": "operator@stockpilot.ai",
            "password": "Admin123!"
        })
    assert res_valid.status_code == 200
    data = res_valid.json()
    assert "access_token" in data
    assert data.get("token_type") == "bearer"

    # Negative login: Wrong password
    res_bad_pw = client.post("/api/v1/auth/login", json={
        "email": "operator@stockpilot.ai",
        "password": "wrong_password_attempt"
    })
    assert res_bad_pw.status_code in (400, 401)

    # Negative login: Nonexistent email
    res_bad_email = client.post("/api/v1/auth/login", json={
        "email": "unknown_ghost_user@stockpilot.ai",
        "password": "SomePassword!"
    })
    assert res_bad_email.status_code in (400, 401)


def test_extension_me_authentication(auth_tokens):
    """Test session validation endpoint across roles and rejection on missing or invalid tokens."""
    for role, token in auth_tokens.items():
        res = client.get("/api/v1/extension/me", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        data = res.json()
        assert data["role"] == role
        assert "org_id" in data
        assert "email" in data

    # Negative: Missing token yields 401
    res_no_token = client.get("/api/v1/extension/me")
    assert res_no_token.status_code in (401, 403)

    # Negative: Invalid or expired token yields 401
    res_invalid_token = client.get(
        "/api/v1/extension/me",
        headers={"Authorization": "Bearer invalid_expired_jwt_token_payload"}
    )
    assert res_invalid_token.status_code == 401


def test_extension_summary_scoping_and_telemetry(auth_tokens):
    """Test summary payload scoping and telemetry source labeling."""
    op_token = auth_tokens["operator"]
    res_op = client.get("/api/v1/extension/summary", headers={"Authorization": f"Bearer {op_token}"})
    assert res_op.status_code == 200
    data_op = res_op.json()

    assert "stock" in data_op
    assert "available_warehouses" in data_op
    assert data_op["warehouse"]["id"] is not None
    assert "active_alerts" in data_op

    # Verify alerts have authoritative telemetry tags (ESP32 LIVE vs SIMULATED LAB)
    for alert in data_op["active_alerts"]:
        assert "source_label" in alert
        assert alert["source_label"] in ("ESP32 LIVE", "SIMULATED LAB")
        assert "is_stale" in alert
        assert isinstance(alert["is_stale"], bool)

    # Supply Chain Manager - Multi-hub scope and OR-Tools optimization summary
    scm_token = auth_tokens["supply_chain_manager"]
    res_scm = client.get("/api/v1/extension/summary", headers={"Authorization": f"Bearer {scm_token}"})
    assert res_scm.status_code == 200
    data_scm = res_scm.json()
    assert len(data_scm["available_warehouses"]) >= 1

    if data_scm.get("recommendations_summary"):
        rec = data_scm["recommendations_summary"]
        assert "run_id" in rec
        assert "status" in rec


def test_extension_multi_attribute_search(auth_tokens):
    """Test context-aware search across SKU, name, barcode, and batch with FEFO details."""
    token = auth_tokens["operator"]

    # 1. Search by SKU
    res_sku = client.get("/api/v1/extension/search?q=PRD-VAX-01", headers={"Authorization": f"Bearer {token}"})
    assert res_sku.status_code == 200
    items_sku = res_sku.json()
    assert len(items_sku) >= 1
    vax = items_sku[0]
    assert vax["sku"] == "PRD-VAX-01"
    assert "batches" in vax
    assert "warehouses" in vax
    assert "stock_status" in vax
    assert "total_available" in vax
    assert "total_reserved" in vax

    # 2. Search by Product Name
    res_name = client.get("/api/v1/extension/search?q=Comirnaty", headers={"Authorization": f"Bearer {token}"})
    assert res_name.status_code == 200
    items_name = res_name.json()
    assert len(items_name) >= 1
    assert any("Comirnaty" in p["name"] for p in items_name)

    # 3. Search by Batch Number
    res_batch = client.get("/api/v1/extension/search?q=BN-VX-2026-B4", headers={"Authorization": f"Bearer {token}"})
    assert res_batch.status_code == 200
    items_batch = res_batch.json()
    assert len(items_batch) >= 1
    assert items_batch[0]["sku"] == "PRD-VAX-01"

    # 4. Search by Barcode
    res_barcode = client.get("/api/v1/extension/search?q=8901234567891", headers={"Authorization": f"Bearer {token}"})
    assert res_barcode.status_code == 200
    items_bc = res_barcode.json()
    assert len(items_bc) >= 1
    assert items_bc[0]["sku"] == "PRD-VAX-01"

    # 5. Empty search result for non-existent item
    res_empty = client.get("/api/v1/extension/search?q=NONEXISTENT_ITEM_XYZ", headers={"Authorization": f"Bearer {token}"})
    assert res_empty.status_code == 200
    assert len(res_empty.json()) == 0


def test_extension_transfer_approval_authorization(auth_tokens):
    """Test transfer approval permissions: managers permitted, operators & distributors denied."""
    test_transfer = {
        "id": "trf_test_companion_approval_01",
        "org_id": "org_triwiz_01",
        "transfer_number": "TRF-TEST-COMPANION-01",
        "source_warehouse_id": "wh_chicago_01",
        "target_warehouse_id": "wh_boston_01",
        "items": [{"product_id": "prd_vax_01", "quantity": 10}],
        "status": "pending",
        "created_at": "2026-10-25T00:00:00Z"
    }
    db.set_document("transfers", "trf_test_companion_approval_01", test_transfer)
    trf_id = "trf_test_companion_approval_01"

    # Negative 1: Operator denied (403)
    op_token = auth_tokens["operator"]
    res_op = client.post(
        f"/api/v1/extension/approve-transfer/{trf_id}",
        headers={"Authorization": f"Bearer {op_token}"}
    )
    assert res_op.status_code == 403

    # Negative 2: Distributor denied (403)
    dist_token = auth_tokens["distributor"]
    res_dist = client.post(
        f"/api/v1/extension/approve-transfer/{trf_id}",
        headers={"Authorization": f"Bearer {dist_token}"}
    )
    assert res_dist.status_code == 403

    # Positive: Supply Chain Manager approved (200)
    scm_token = auth_tokens["supply_chain_manager"]
    res_scm = client.post(
        f"/api/v1/extension/approve-transfer/{trf_id}",
        headers={"Authorization": f"Bearer {scm_token}"}
    )
    assert res_scm.status_code == 200
    assert res_scm.json()["status"] == "approved"

    # Duplicate Action Prevention: Second approval attempt must conflict (409)
    res_duplicate = client.post(
        f"/api/v1/extension/approve-transfer/{trf_id}",
        headers={"Authorization": f"Bearer {scm_token}"}
    )
    assert res_duplicate.status_code == 409


def test_extension_alert_acknowledgment(auth_tokens):
    """Test alert acknowledgment action from extension."""
    now_iso = datetime.now(timezone.utc).isoformat()
    alert_id = "alt_test_companion_01"
    test_alert = {
        "id": alert_id,
        "org_id": "org_triwiz_01",
        "warehouse_id": "wh_chicago_01",
        "device_id": "ESP32-WH-01",
        "storage_zone": "Cold Zone Bay 1",
        "alert_type": "temperature_excursion",
        "severity": "CRITICAL",
        "message": "Cold-chain excursion: Temperature 6.8C exceeds threshold 4.0C",
        "reading_value": 6.8,
        "threshold_value": 4.0,
        "timestamp": now_iso,
        "acknowledged": False,
        "is_simulated": False
    }
    db.set_document("alerts", alert_id, test_alert)

    op_token = auth_tokens["operator"]
    res_ack = client.post(
        f"/api/v1/extension/acknowledge-alert/{alert_id}",
        headers={"Authorization": f"Bearer {op_token}"}
    )
    assert res_ack.status_code == 200
    ack_data = res_ack.json()
    assert ack_data.get("acknowledged") is True

    # Verify persisted in database
    persisted = db.get_document("alerts", alert_id)
    assert persisted["acknowledged"] is True
    assert persisted["acknowledged_by"] is not None


def test_extension_task_completion(auth_tokens):
    """Test warehouse operational task completion workflow from extension."""
    task_id = "TASK-TEST-COMP-01"
    test_task = {
        "id": task_id,
        "title": "FEFO Verification: Comirnaty Batch B4",
        "description": "Inspect expiry label and lot number",
        "type": "cycle_count",
        "status": "PENDING",
        "priority": "HIGH",
        "warehouse_id": "wh_chicago_01",
        "org_id": "org_triwiz_01",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    db.set_document("warehouse_tasks", task_id, test_task)

    op_token = auth_tokens["operator"]
    res_complete = client.post(
        f"/api/v1/extension/tasks/{task_id}/complete",
        headers={"Authorization": f"Bearer {op_token}"}
    )
    assert res_complete.status_code == 200
    assert res_complete.json().get("success") is True

    # Verify persisted task status
    persisted = db.get_document("warehouse_tasks", task_id)
    assert persisted["status"] == "COMPLETED"
