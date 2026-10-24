import pytest
import uuid
from datetime import datetime, timezone
from fastapi.testclient import TestClient

from app.main import app
from app.core.database import db
from app.services.seed_data import init_seed_data
from app.core.security import create_access_token
from app.core.permissions import (
    ROLE_SUPER_ADMIN,
    ROLE_ORG_ADMIN,
    ROLE_SUPPLY_CHAIN_MANAGER,
    ROLE_WAREHOUSE_MANAGER,
    ROLE_WAREHOUSE_OPERATOR,
    ROLE_DISTRIBUTOR_FIELD_OPERATOR,
    ROLE_DEFAULT_PERMISSIONS,
    user_has_permission,
    get_user_effective_permissions,
    PERM_ORGANIZATIONS_MANAGE,
    PERM_USERS_MANAGE,
    PERM_PRODUCTS_MANAGE,
    PERM_WAREHOUSES_MANAGE,
    PERM_INVENTORY_VIEW,
    PERM_INVENTORY_RECEIVE,
    PERM_INVENTORY_DISPATCH,
    PERM_INVENTORY_ADJUST,
    PERM_OPTIMIZATION_RUN,
    PERM_OPTIMIZATION_APPROVE,
    PERM_TRANSFERS_VIEW,
    PERM_TRANSFERS_CREATE,
    PERM_TRANSFERS_DISPATCH,
    PERM_TRANSFERS_RECEIVE,
    PERM_IOT_DEVICES_MANAGE,
    PERM_ALERTS_MANAGE,
    PERM_AUDIT_VIEW,
    PERM_SCANS_EXECUTE,
    PERM_DELIVERY_CONFIRM,
)

client = TestClient(app)

@pytest.fixture(scope="module", autouse=True)
def setup_test_db():
    init_seed_data()
    yield

def make_auth_headers(user: dict) -> dict:
    permissions = list(get_user_effective_permissions(user))
    token = create_access_token(
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
    return {"Authorization": f"Bearer {token}"}

# -------------------------------------------------------------
# 1. Six-Role Permission Model Integrity
# -------------------------------------------------------------
def test_all_six_roles_permission_mapping():
    roles = [
        ROLE_SUPER_ADMIN,
        ROLE_ORG_ADMIN,
        ROLE_SUPPLY_CHAIN_MANAGER,
        ROLE_WAREHOUSE_MANAGER,
        ROLE_WAREHOUSE_OPERATOR,
        ROLE_DISTRIBUTOR_FIELD_OPERATOR,
    ]
    for r in roles:
        assert r in ROLE_DEFAULT_PERMISSIONS, f"Role {r} missing from default permissions dictionary"
        assert len(ROLE_DEFAULT_PERMISSIONS[r]) > 0, f"Role {r} must have at least one permission"

    # Super Admin has platform-level perms
    sa_user = {"role": "super_admin"}
    assert user_has_permission(sa_user, PERM_ORGANIZATIONS_MANAGE)
    assert user_has_permission(sa_user, PERM_AUDIT_VIEW)

    # Org Admin has user and product management perms
    oa_user = {"role": "org_admin"}
    assert user_has_permission(oa_user, PERM_USERS_MANAGE)
    assert user_has_permission(oa_user, PERM_PRODUCTS_MANAGE)
    assert user_has_permission(oa_user, PERM_WAREHOUSES_MANAGE)
    assert not user_has_permission(oa_user, PERM_ORGANIZATIONS_MANAGE)

    # Supply Chain Manager has optimization perms
    scm_user = {"role": "supply_chain_manager"}
    assert user_has_permission(scm_user, PERM_OPTIMIZATION_RUN)
    assert user_has_permission(scm_user, PERM_OPTIMIZATION_APPROVE)
    assert not user_has_permission(scm_user, PERM_USERS_MANAGE)
    assert not user_has_permission(scm_user, PERM_WAREHOUSES_MANAGE)

    # Warehouse Manager has warehouse-level operational perms
    wm_user = {"role": "warehouse_manager"}
    assert user_has_permission(wm_user, PERM_INVENTORY_VIEW)
    assert user_has_permission(wm_user, PERM_INVENTORY_ADJUST)
    assert not user_has_permission(wm_user, PERM_OPTIMIZATION_RUN)
    assert not user_has_permission(wm_user, PERM_OPTIMIZATION_APPROVE)

    # Warehouse Operator has task execution perms
    wo_user = {"role": "operator"}
    assert user_has_permission(wo_user, PERM_INVENTORY_RECEIVE)
    assert user_has_permission(wo_user, PERM_TRANSFERS_DISPATCH)
    assert user_has_permission(wo_user, PERM_SCANS_EXECUTE)
    assert not user_has_permission(wo_user, PERM_INVENTORY_ADJUST)
    assert not user_has_permission(wo_user, PERM_OPTIMIZATION_APPROVE)

    # Distributor Field Operator has delivery perms
    dist_user = {"role": "distributor"}
    assert user_has_permission(dist_user, PERM_DELIVERY_CONFIRM)
    assert user_has_permission(dist_user, PERM_TRANSFERS_VIEW)
    assert not user_has_permission(dist_user, PERM_INVENTORY_ADJUST)
    assert not user_has_permission(dist_user, PERM_OPTIMIZATION_RUN)

# -------------------------------------------------------------
# 2. Authentication Perimeter (401 Unauthorized)
# -------------------------------------------------------------
def test_unauthenticated_requests_fail_with_401():
    endpoints = [
        ("GET", "/api/v1/inventory"),
        ("GET", "/api/v1/transfers"),
        ("GET", "/api/v1/auth/users"),
        ("GET", "/api/v1/audit"),
        ("GET", "/api/v1/optimization/runs"),
    ]
    for method, path in endpoints:
        res = client.request(method, path)
        assert res.status_code == 401, f"{method} {path} should return 401 when unauthenticated, got {res.status_code}"

# -------------------------------------------------------------
# 3. Privilege Boundaries & Role Isolation (403 Forbidden)
# -------------------------------------------------------------
def test_operator_privilege_boundaries():
    operator = db.get_document("users", "usr_operator")
    assert operator is not None
    headers = make_auth_headers(operator)

    # 1. Operator cannot run optimization
    res_opt = client.post("/api/v1/optimization/run", json={"horizon_days": 7}, headers=headers)
    assert res_opt.status_code == 403

    # 2. Operator cannot approve transfers
    res_appr = client.post("/api/v1/transfers/approve", json={"transfer_id": "trf_mock_01", "approved": True}, headers=headers)
    assert res_appr.status_code == 403

    # 3. Operator cannot adjust inventory stock directly
    res_adj = client.post("/api/v1/inventory/adjust", json={
        "correlation_id": f"ADJ-{uuid.uuid4().hex[:6]}",
        "warehouse_id": "wh_chicago_01",
        "product_id": "prd_vax_01",
        "batch_id": "bat_vax_chi_01",
        "new_quantity": 500,
        "reason": "Routine count update"
    }, headers=headers)
    assert res_adj.status_code == 403

    # 4. Operator cannot invite or manage users
    res_inv = client.post("/api/v1/auth/invite", json={
        "email": "test@stockpilot.ai",
        "full_name": "Test User",
        "role": "operator"
    }, headers=headers)
    assert res_inv.status_code == 403

    # 5. Operator cannot view compliance audit logs
    res_audit = client.get("/api/v1/audit", headers=headers)
    assert res_audit.status_code == 403

def test_warehouse_manager_privilege_boundaries():
    wm = db.get_document("users", "usr_whmanager")
    assert wm is not None
    headers = make_auth_headers(wm)

    # Warehouse Manager cannot approve optimization runs by default
    res_opt_appr = client.post("/api/v1/transfers/approve", json={"transfer_id": "trf_mock_01", "approved": True}, headers=headers)
    assert res_opt_appr.status_code == 403

    # Warehouse Manager cannot manage platform or organization users
    res_inv = client.post("/api/v1/auth/invite", json={
        "email": "test2@stockpilot.ai",
        "full_name": "Test User 2",
        "role": "operator"
    }, headers=headers)
    assert res_inv.status_code == 403

# -------------------------------------------------------------
# 4. Location Scoping & Warehouse Isolation
# -------------------------------------------------------------
def test_location_scoping_enforcement():
    # Chicago operator: assigned exclusively to wh_chicago_01
    operator = db.get_document("users", "usr_operator")
    assert operator is not None
    headers = make_auth_headers(operator)

    # A) Attempting to query Dallas inventory explicitly -> 403 Forbidden
    res_dallas = client.get("/api/v1/inventory?warehouse_id=wh_dallas_03", headers=headers)
    assert res_dallas.status_code == 403
    assert "Location access denied" in res_dallas.json()["detail"]

    # B) Querying without warehouse_id parameter -> automatically pinned to assigned Chicago warehouse
    res_auto = client.get("/api/v1/inventory", headers=headers)
    assert res_auto.status_code == 200
    items = res_auto.json()
    assert len(items) > 0
    for item in items:
        assert item["warehouse_id"] == "wh_chicago_01", "Operator inventory query leaked unassigned warehouse items"

    # C) Attempting to receive stock into unassigned Dallas warehouse -> 403 Forbidden
    corr_id = f"LOC-TEST-{uuid.uuid4().hex[:6]}"
    res_rec_dallas = client.post("/api/v1/inventory/receive", json={
        "correlation_id": corr_id,
        "warehouse_id": "wh_dallas_03",
        "product_id": "prd_vax_01",
        "batch_number": f"BATCH-{uuid.uuid4().hex[:6]}",
        "supplier_reference": "Test Supplier",
        "mfg_date": "2026-01-01",
        "expiry_date": "2026-12-31",
        "quantity": 100,
        "unit_cost": 25.0,
        "storage_bin": "BIN-TEST-01"
    }, headers=headers)
    assert res_rec_dallas.status_code == 403

    # D) Receiving stock into assigned Chicago warehouse -> 200 OK
    corr_id_chi = f"LOC-TEST-{uuid.uuid4().hex[:6]}"
    res_rec_chi = client.post("/api/v1/inventory/receive", json={
        "correlation_id": corr_id_chi,
        "warehouse_id": "wh_chicago_01",
        "product_id": "prd_vax_01",
        "batch_number": f"BATCH-{uuid.uuid4().hex[:6]}",
        "supplier_reference": "Test Supplier",
        "mfg_date": "2026-01-01",
        "expiry_date": "2026-12-31",
        "quantity": 100,
        "unit_cost": 25.0,
        "storage_bin": "BIN-TEST-01"
    }, headers=headers)
    assert res_rec_chi.status_code == 200
    assert res_rec_chi.json()["success"] is True

# -------------------------------------------------------------
# 5. Distributor Transfer Scoping
# -------------------------------------------------------------
def test_distributor_transfer_scoping():
    distributor = db.get_document("users", "usr_distributor")
    assert distributor is not None
    headers = make_auth_headers(distributor)

    # Create an assigned transfer and an unassigned transfer in db
    t_assigned = {
        "id": f"trf_dist_assigned_{uuid.uuid4().hex[:6]}",
        "org_id": "org_triwiz_01",
        "transfer_number": "TRF-TEST-ASSIGNED",
        "source_warehouse_id": "wh_chicago_01",
        "target_warehouse_id": "wh_ny_02",
        "assigned_distributor_id": "usr_distributor",
        "status": "in_transit",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "items": [{"product_id": "prd_vax_01", "quantity": 50}]
    }
    t_other = {
        "id": f"trf_dist_other_{uuid.uuid4().hex[:6]}",
        "org_id": "org_triwiz_01",
        "transfer_number": "TRF-TEST-OTHER",
        "source_warehouse_id": "wh_dallas_03",
        "target_warehouse_id": "wh_reno_04",
        "assigned_distributor_id": "usr_someone_else",
        "status": "in_transit",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "items": [{"product_id": "prd_vax_01", "quantity": 50}]
    }
    db.set_document("transfers", t_assigned["id"], t_assigned)
    db.set_document("transfers", t_other["id"], t_other)

    res = client.get("/api/v1/transfers", headers=headers)
    assert res.status_code == 200
    transfers = res.json()
    transfer_ids = [t["id"] for t in transfers]
    assert t_assigned["id"] in transfer_ids, "Assigned transfer must be visible to distributor"
    assert t_other["id"] not in transfer_ids, "Unrelated distributor transfer must NOT be visible"

# -------------------------------------------------------------
# 6. Admin User Governance & Protections
# -------------------------------------------------------------
def test_admin_user_governance_and_protections():
    admin = db.get_document("users", "usr_orgadmin")
    assert admin is not None
    admin_headers = make_auth_headers(admin)

    # 1. Org admin can list organization users
    res_list = client.get("/api/v1/auth/users", headers=admin_headers)
    assert res_list.status_code == 200
    assert len(res_list.json()) >= 6

    # 2. Org admin can update a user's role and assigned locations
    res_update = client.put("/api/v1/auth/users/usr_operator", json={
        "full_name": "James Operator (Updated)",
        "role": "warehouse_manager",
        "warehouse_ids": ["wh_chicago_01", "wh_ny_02"]
    }, headers=admin_headers)
    assert res_update.status_code == 200
    updated_user = res_update.json()
    assert updated_user["full_name"] == "James Operator (Updated)"
    assert updated_user["role"] == "warehouse_manager"
    assert "wh_ny_02" in updated_user["warehouse_ids"]

    # Revert back to operator for clean state
    client.put("/api/v1/auth/users/usr_operator", json={
        "full_name": "James Vance",
        "role": "operator",
        "warehouse_ids": ["wh_chicago_01"]
    }, headers=admin_headers)

    # 3. Org admin can toggle user active state
    res_toggle = client.post("/api/v1/auth/users/usr_operator/toggle-active", headers=admin_headers)
    assert res_toggle.status_code == 200
    assert res_toggle.json()["is_active"] is False

    # Toggle back on
    res_toggle_back = client.post("/api/v1/auth/users/usr_operator/toggle-active", headers=admin_headers)
    assert res_toggle_back.status_code == 200
    assert res_toggle_back.json()["is_active"] is True

    # 4. Protection: Cannot deactivate own session
    res_self_deact = client.post(f"/api/v1/auth/users/{admin['id']}/toggle-active", headers=admin_headers)
    assert res_self_deact.status_code == 400
    assert "Cannot deactivate your own active session" in res_self_deact.json()["detail"]

    # 5. Protection: Non-super-admin cannot self-promote or promote others to super_admin
    res_promote = client.put("/api/v1/auth/users/usr_operator", json={
        "role": "super_admin"
    }, headers=admin_headers)
    assert res_promote.status_code == 403
    assert "Super Admin" in res_promote.json()["detail"]

# -------------------------------------------------------------
# 7. Inventory Ledger Concurrency & Safety
# -------------------------------------------------------------
def test_inventory_ledger_safety_and_idempotency():
    admin = db.get_document("users", "usr_orgadmin")
    assert admin is not None
    headers = make_auth_headers(admin)

    corr_key = f"IDEMP-{uuid.uuid4().hex[:8]}"
    batch_num = f"BN-{uuid.uuid4().hex[:6]}"

    # Commit receive
    payload = {
        "correlation_id": corr_key,
        "warehouse_id": "wh_chicago_01",
        "product_id": "prd_vax_01",
        "batch_number": batch_num,
        "supplier_reference": "Pfizer Global",
        "mfg_date": "2026-01-01",
        "expiry_date": "2026-12-31",
        "quantity": 300,
        "unit_cost": 21.0,
        "storage_bin": "BIN-TEST-01"
    }
    res1 = client.post("/api/v1/inventory/receive", json=payload, headers=headers)
    assert res1.status_code == 200

    # Repeat commit with exact same correlation_id must be rejected (idempotency safety)
    res2 = client.post("/api/v1/inventory/receive", json=payload, headers=headers)
    assert res2.status_code == 409

    # Negative stock over-dispatch prevention
    disp_corr = f"DISP-{uuid.uuid4().hex[:8]}"
    disp_payload = {
        "correlation_id": disp_corr,
        "warehouse_id": "wh_chicago_01",
        "product_id": "prd_vax_01",
        "destination_id": "dest_boston_01",
        "quantity": 9999999  # Exceeds available stock
    }
    res_disp = client.post("/api/v1/inventory/dispatch", json=disp_payload, headers=headers)
    assert res_disp.status_code == 400
    assert "Insufficient available stock" in res_disp.json()["detail"]
