import pytest
from datetime import datetime, timezone
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


def test_extension_me_authentication(auth_tokens):
    """Test session validation endpoint across roles and rejection on missing token."""
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


def test_extension_summary_scoping(auth_tokens):
    """Test that summary payload is scoped appropriately by warehouse and role."""
    # Operator
    op_token = auth_tokens["operator"]
    res_op = client.get("/api/v1/extension/summary", headers={"Authorization": f"Bearer {op_token}"})
    assert res_op.status_code == 200
    data_op = res_op.json()
    assert "stock" in data_op
    assert "available_warehouses" in data_op
    assert data_op["warehouse"]["id"] is not None

    # Supply Chain Manager - Multi-hub scope
    scm_token = auth_tokens["supply_chain_manager"]
    res_scm = client.get("/api/v1/extension/summary", headers={"Authorization": f"Bearer {scm_token}"})
    assert res_scm.status_code == 200
    data_scm = res_scm.json()
    assert len(data_scm["available_warehouses"]) >= 1

    # Check optimizer recommendations summary has real structure if present
    if data_scm.get("recommendations_summary"):
        rec = data_scm["recommendations_summary"]
        assert "run_id" in rec
        assert "cost_savings_pct" in rec


def test_extension_quick_search(auth_tokens):
    """Test SKU search across authorized organization."""
    token = auth_tokens["operator"]
    res = client.get("/api/v1/extension/search?q=VAX", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    results = res.json()
    assert isinstance(results, list)
    if len(results) > 0:
        item = results[0]
        assert "sku" in item
        assert "total_available" in item


def test_extension_transfer_approval_authorization(auth_tokens):
    """Test transfer approval permissions: managers permitted, operators & distributors denied."""
    # Find or create a test pending transfer
    transfers = db.query("transfers", filters={"status": "pending"})
    if not transfers:
        test_transfer = {
            "id": "trf_test_companion_01",
            "org_id": "org_triwiz_01",
            "transfer_number": "TRF-TEST-COMPANION-01",
            "source_warehouse_id": "wh_chicago_01",
            "target_warehouse_id": "wh_boston_01",
            "items": [{"product_id": "prd_vax_01", "quantity": 10}],
            "status": "pending",
            "created_at": "2026-10-25T00:00:00Z"
        }
        db.set_document("transfers", "trf_test_companion_01", test_transfer)
        trf_id = "trf_test_companion_01"
    else:
        trf_id = transfers[0]["id"]

    # Negative authorization 1: Operator attempting approval -> 403 Forbidden
    op_token = auth_tokens["operator"]
    res_op = client.post(
        f"/api/v1/extension/approve-transfer/{trf_id}",
        headers={"Authorization": f"Bearer {op_token}"}
    )
    assert res_op.status_code == 403

    # Negative authorization 2: Distributor attempting approval -> 403 Forbidden
    dist_token = auth_tokens["distributor"]
    res_dist = client.post(
        f"/api/v1/extension/approve-transfer/{trf_id}",
        headers={"Authorization": f"Bearer {dist_token}"}
    )
    assert res_dist.status_code == 403

    # Positive authorization: Supply Chain Manager approving -> 200 OK
    scm_token = auth_tokens["supply_chain_manager"]
    res_scm = client.post(
        f"/api/v1/extension/approve-transfer/{trf_id}",
        headers={"Authorization": f"Bearer {scm_token}"}
    )
    assert res_scm.status_code == 200
    assert res_scm.json()["status"] == "approved"
