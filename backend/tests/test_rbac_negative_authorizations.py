"""
STOCKPILOT AI: COMPREHENSIVE NEGATIVE AUTHORIZATION TEST SUITE
Enforces strict multi-tenant isolation, location scoping, transfer approval guards,
anti-self-promotion rules, and negative permission boundaries across ALL SIX ROLES:
1. SUPER_ADMIN
2. ORG_ADMIN
3. SUPPLY_CHAIN_MANAGER
4. WAREHOUSE_MANAGER
5. OPERATOR
6. DISTRIBUTOR
"""

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
    ROLE_OPERATOR,
    ROLE_DISTRIBUTOR,
    PERM_CROSS_ORG_AUDIT_ACCESS,
    get_user_effective_permissions,
)
from app.services.whatsapp_service import WhatsAppBotService

client = TestClient(app)

# Test tenant fixtures
ORG_PRIMARY = "org_triwiz_01"
ORG_FOREIGN = "org_foreign_competitor_99"

@pytest.fixture(autouse=True)
def setup_rbac_test_db():
    init_seed_data()
    # Seed a foreign tenant for cross-tenant negative testing
    db.set_document("organizations", ORG_FOREIGN, {
        "id": ORG_FOREIGN,
        "name": "Foreign BioLogistics Ltd",
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    # Foreign warehouse
    db.set_document("warehouses", "wh_foreign_01", {
        "id": "wh_foreign_01",
        "org_id": ORG_FOREIGN,
        "code": "WH-FRG-01",
        "name": "Foreign Facility London",
        "city": "London",
        "is_operational": True
    })
    # Foreign product
    db.set_document("products", "prd_foreign_vax", {
        "id": "prd_foreign_vax",
        "org_id": ORG_FOREIGN,
        "sku": "VAX-FRG-01",
        "name": "Foreign Vaccine Batch",
        "unit": "vials"
    })
    # Foreign batch
    db.set_document("inventory_batches", "bat_foreign_01", {
        "id": "bat_foreign_01",
        "org_id": ORG_FOREIGN,
        "warehouse_id": "wh_foreign_01",
        "product_id": "prd_foreign_vax",
        "batch_number": "BN-FRG-999",
        "quantity": 500,
        "status": "active"
    })
    # Foreign user
    db.set_document("users", "usr_foreign_admin", {
        "id": "usr_foreign_admin",
        "email": "admin@foreign.org",
        "full_name": "Foreign Admin",
        "role": ROLE_ORG_ADMIN,
        "org_id": ORG_FOREIGN,
        "is_active": True
    })
    # Foreign transfer
    db.set_document("transfers", "trf_foreign_01", {
        "id": "trf_foreign_01",
        "org_id": ORG_FOREIGN,
        "source_warehouse_id": "wh_foreign_01",
        "target_warehouse_id": "wh_foreign_02",
        "status": "requested",
        "items": []
    })
    yield

def make_role_headers(role: str, user_id: str, org_id: str = ORG_PRIMARY, warehouse_id: str = "wh_chicago_01") -> dict:
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

# =============================================================================
# 1. ROLE 5: OPERATOR NEGATIVE AUTHORIZATION TESTS
# =============================================================================
class TestOperatorNegativeBoundaries:
    """Operators must NOT approve transfers, mutate other warehouses, adjust stock, or manage users."""

    def test_operator_cannot_approve_transfer_via_rest(self):
        headers = make_role_headers(ROLE_OPERATOR, "usr_op_test_01", warehouse_id="wh_chicago_01")
        resp = client.post("/api/v1/transfers/approve", headers=headers, json={
            "transfer_id": "trf_001_chi_ny",
            "approved": True
        })
        assert resp.status_code == 403
        assert "transfers.approve" in resp.text or "Access denied" in resp.text

    def test_operator_cannot_approve_transfer_via_extension(self):
        headers = make_role_headers(ROLE_OPERATOR, "usr_op_test_02", warehouse_id="wh_chicago_01")
        resp = client.post("/api/v1/extension/approve-transfer/trf_001_chi_ny", headers=headers)
        assert resp.status_code == 403

    def test_operator_cannot_approve_transfer_via_whatsapp(self):
        # Authenticated operator sending APPROVE command via WhatsApp
        res = WhatsAppBotService.process_incoming_message(
            from_number="+13125550106",  # usr_operator
            message_text="APPROVE trf_001_chi_ny",
            org_id=ORG_PRIMARY
        )
        assert res.get("action_taken") == "TRANSFER_APPROVAL_UNAUTHORIZED"
        reply = res.get("reply_text") or res.get("reply") or ""
        assert "Unauthorized" in reply or "cannot approve" in reply

    def test_operator_cannot_reject_transfer_via_whatsapp(self):
        res = WhatsAppBotService.process_incoming_message(
            from_number="+13125550106",  # usr_operator
            message_text="REJECT trf_001_chi_ny",
            org_id=ORG_PRIMARY
        )
        assert res.get("action_taken") == "TRANSFER_REJECTION_UNAUTHORIZED"
        reply = res.get("reply_text") or res.get("reply") or ""
        assert "Unauthorized" in reply or "cannot reject" in reply

    def test_operator_cannot_perform_arbitrary_stock_adjustment(self):
        headers = make_role_headers(ROLE_OPERATOR, "usr_op_test_03", warehouse_id="wh_chicago_01")
        resp = client.post("/api/v1/inventory/adjust", headers=headers, json={
            "correlation_id": f"ADJ-OP-FAIL-{uuid.uuid4().hex[:6]}",
            "warehouse_id": "wh_chicago_01",
            "product_id": "prd_vax_01",
            "batch_id": "bat_chi_vax_01",
            "new_quantity": 9999,
            "reason": "Unauthorized manual boost attempt"
        })
        assert resp.status_code == 403
        assert "inventory.adjust" in resp.text or "Access denied" in resp.text

    def test_operator_cannot_mutate_unassigned_warehouse(self):
        # Assigned to Chicago, attempting to receive at Dallas
        headers = make_role_headers(ROLE_OPERATOR, "usr_op_test_04", warehouse_id="wh_chicago_01")
        resp = client.post("/api/v1/inventory/receive", headers=headers, json={
            "correlation_id": f"REC-OP-FAIL-{uuid.uuid4().hex[:6]}",
            "warehouse_id": "wh_dallas_03",
            "product_id": "prd_vax_01",
            "batch_number": "BN-TAMPER-01",
            "supplier_reference": "Supplier X",
            "mfg_date": "2026-01-01",
            "expiry_date": "2026-12-31",
            "quantity": 50,
            "unit_cost": 20.0,
            "storage_bin": "CR-BIN-01"
        })
        assert resp.status_code == 403
        assert "Location access denied" in resp.text or "Unauthorized warehouse operation" in resp.text

    def test_operator_cannot_invite_users(self):
        headers = make_role_headers(ROLE_OPERATOR, "usr_op_test_05", warehouse_id="wh_chicago_01")
        resp = client.post("/api/v1/auth/invite", headers=headers, json={
            "email": "rogue.worker@stockpilot.ai",
            "full_name": "Rogue Worker",
            "role": "operator"
        })
        assert resp.status_code == 403

    def test_operator_cannot_run_optimization(self):
        headers = make_role_headers(ROLE_OPERATOR, "usr_op_test_06", warehouse_id="wh_chicago_01")
        resp = client.post("/api/v1/optimization/run", headers=headers, json={"horizon_days": 7})
        assert resp.status_code == 403

    def test_operator_cannot_register_iot_device(self):
        headers = make_role_headers(ROLE_OPERATOR, "usr_op_test_07", warehouse_id="wh_chicago_01")
        resp = client.post("/api/v1/iot/devices/register", headers=headers, json={
            "device_id": "ROGUE-ESP32-99",
            "warehouse_id": "wh_chicago_01",
            "storage_zone": "Cold Room"
        })
        assert resp.status_code == 403


# =============================================================================
# 2. ROLE 6: DISTRIBUTOR NEGATIVE AUTHORIZATION TESTS
# =============================================================================
class TestDistributorNegativeBoundaries:
    """Distributors must NOT mutate warehouse inventory, approve transfers, view audit logs, or manage network."""

    def test_distributor_cannot_receive_warehouse_stock(self):
        headers = make_role_headers(ROLE_DISTRIBUTOR, "usr_dist_test_01", warehouse_id=None)
        resp = client.post("/api/v1/inventory/receive", headers=headers, json={
            "correlation_id": f"REC-DIST-FAIL-{uuid.uuid4().hex[:6]}",
            "warehouse_id": "wh_chicago_01",
            "product_id": "prd_vax_01",
            "batch_number": "BN-DIST-99",
            "supplier_reference": "Supplier X",
            "mfg_date": "2026-01-01",
            "expiry_date": "2026-12-31",
            "quantity": 100,
            "unit_cost": 25.0,
            "storage_bin": "CR-BIN-01"
        })
        assert resp.status_code == 403

    def test_distributor_cannot_adjust_stock(self):
        headers = make_role_headers(ROLE_DISTRIBUTOR, "usr_dist_test_02", warehouse_id=None)
        resp = client.post("/api/v1/inventory/adjust", headers=headers, json={
            "correlation_id": f"ADJ-DIST-FAIL-{uuid.uuid4().hex[:6]}",
            "warehouse_id": "wh_chicago_01",
            "product_id": "prd_vax_01",
            "batch_id": "bat_chi_vax_01",
            "new_quantity": 0,
            "reason": "Distributor zeroing out stock"
        })
        assert resp.status_code == 403

    def test_distributor_cannot_approve_transfer(self):
        headers = make_role_headers(ROLE_DISTRIBUTOR, "usr_dist_test_03", warehouse_id=None)
        resp = client.post("/api/v1/transfers/approve", headers=headers, json={
            "transfer_id": "trf_001_chi_ny",
            "approved": True
        })
        assert resp.status_code == 403

    def test_distributor_cannot_view_audit_logs(self):
        headers = make_role_headers(ROLE_DISTRIBUTOR, "usr_dist_test_04", warehouse_id=None)
        resp = client.get("/api/v1/audit", headers=headers)
        assert resp.status_code == 403

    def test_distributor_cannot_run_optimization(self):
        headers = make_role_headers(ROLE_DISTRIBUTOR, "usr_dist_test_05", warehouse_id=None)
        resp = client.post("/api/v1/optimization/run", headers=headers, json={"horizon_days": 7})
        assert resp.status_code == 403

    def test_distributor_cannot_create_warehouse(self):
        headers = make_role_headers(ROLE_DISTRIBUTOR, "usr_dist_test_06", warehouse_id=None)
        resp = client.post("/api/v1/warehouses", headers=headers, json={
            "code": "WH-ROGUE-01",
            "name": "Rogue Depot",
            "address": "123 Alley",
            "city": "Nowhere",
            "state": "IL",
            "lat": 40.0,
            "lng": -80.0,
            "capacity_pallets": 1000
        })
        assert resp.status_code == 403


# =============================================================================
# 3. ROLE 4: WAREHOUSE_MANAGER NEGATIVE AUTHORIZATION TESTS
# =============================================================================
class TestWarehouseManagerNegativeBoundaries:
    """Warehouse Managers must NOT manage other warehouses, approve transfers outside facility, or manage users."""

    def test_warehouse_manager_cannot_approve_transfer_outside_assigned_hub(self):
        # Assigned to Dallas (wh_dallas_03), attempting to approve transfer between Chicago and New York
        headers = make_role_headers(ROLE_WAREHOUSE_MANAGER, "usr_wm_dallas", warehouse_id="wh_dallas_03")
        resp = client.post("/api/v1/transfers/approve", headers=headers, json={
            "transfer_id": "trf_001_chi_ny",  # Chicago -> New York
            "approved": True
        })
        assert resp.status_code == 403
        assert "cannot approve transfers" in resp.text.lower() or "outside assigned facility" in resp.text.lower() or "access denied" in resp.text.lower()

    def test_warehouse_manager_cannot_receive_stock_at_foreign_facility(self):
        headers = make_role_headers(ROLE_WAREHOUSE_MANAGER, "usr_wm_dallas", warehouse_id="wh_dallas_03")
        resp = client.post("/api/v1/inventory/receive", headers=headers, json={
            "correlation_id": f"REC-WM-FAIL-{uuid.uuid4().hex[:6]}",
            "warehouse_id": "wh_chicago_01",  # Not Dallas
            "product_id": "prd_vax_01",
            "batch_number": "BN-WM-01",
            "supplier_reference": "Supplier X",
            "mfg_date": "2026-01-01",
            "expiry_date": "2026-12-31",
            "quantity": 50,
            "unit_cost": 20.0,
            "storage_bin": "CR-BIN-01"
        })
        assert resp.status_code == 403

    def test_warehouse_manager_cannot_invite_users(self):
        headers = make_role_headers(ROLE_WAREHOUSE_MANAGER, "usr_wm_chi", warehouse_id="wh_chicago_01")
        resp = client.post("/api/v1/auth/invite", headers=headers, json={
            "email": "friend.manager@stockpilot.ai",
            "full_name": "Friend Manager",
            "role": "warehouse_manager"
        })
        assert resp.status_code == 403

    def test_warehouse_manager_cannot_run_optimization(self):
        headers = make_role_headers(ROLE_WAREHOUSE_MANAGER, "usr_wm_chi", warehouse_id="wh_chicago_01")
        resp = client.post("/api/v1/optimization/run", headers=headers, json={"horizon_days": 7})
        assert resp.status_code == 403


# =============================================================================
# 4. ROLE 3: SUPPLY_CHAIN_MANAGER NEGATIVE AUTHORIZATION TESTS
# =============================================================================
class TestSupplyChainManagerNegativeBoundaries:
    """Supply Chain Managers must NOT invite users, manage system integrations, or toggle warehouse operational status."""

    def test_scm_cannot_invite_users(self):
        headers = make_role_headers(ROLE_SUPPLY_CHAIN_MANAGER, "usr_scm_01")
        resp = client.post("/api/v1/auth/invite", headers=headers, json={
            "email": "new.scm@stockpilot.ai",
            "full_name": "New SCM",
            "role": "supply_chain_manager"
        })
        assert resp.status_code == 403

    def test_scm_cannot_create_warehouse(self):
        headers = make_role_headers(ROLE_SUPPLY_CHAIN_MANAGER, "usr_scm_01")
        resp = client.post("/api/v1/warehouses", headers=headers, json={
            "code": "WH-SCM-01",
            "name": "SCM Warehouse",
            "address": "123 Way",
            "city": "Denver",
            "state": "CO",
            "lat": 39.7,
            "lng": -104.9,
            "capacity_pallets": 5000
        })
        assert resp.status_code == 403

    def test_scm_cannot_toggle_warehouse_operational(self):
        headers = make_role_headers(ROLE_SUPPLY_CHAIN_MANAGER, "usr_scm_01")
        resp = client.post("/api/v1/warehouses/wh_chicago_01/toggle-operational", headers=headers)
        assert resp.status_code == 403

    def test_scm_cannot_create_product(self):
        headers = make_role_headers(ROLE_SUPPLY_CHAIN_MANAGER, "usr_scm_01")
        resp = client.post("/api/v1/products", headers=headers, json={
            "sku": "NEW-PROD-SCM",
            "name": "New Medicine",
            "category": "Vaccines",
            "unit_cost": 10.0,
            "selling_price": 20.0
        })
        assert resp.status_code == 403


# =============================================================================
# 5. ROLE 2: ORG_ADMIN NEGATIVE AUTHORIZATION & PRIVILEGE ESCALATION TESTS
# =============================================================================
class TestOrgAdminNegativeBoundaries:
    """Org Admins cannot access cross-tenant data, self-promote, assign super_admin, or demote the last org admin."""

    def test_org_admin_cannot_access_cross_tenant_user(self):
        headers = make_role_headers(ROLE_ORG_ADMIN, "usr_admin_org1", org_id=ORG_PRIMARY)
        # Attempt to modify a user belonging to foreign organization
        resp = client.put("/api/v1/auth/users/usr_foreign_admin", headers=headers, json={
            "full_name": "Tampered Name"
        })
        assert resp.status_code == 403
        assert "Cross-organization user modification denied" in resp.text

    def test_org_admin_cannot_promote_to_super_admin(self):
        headers = make_role_headers(ROLE_ORG_ADMIN, "usr_admin_org1", org_id=ORG_PRIMARY)
        # Attempt to update a user to super_admin
        resp = client.put("/api/v1/auth/users/usr_operator", headers=headers, json={
            "role": "super_admin"
        })
        assert resp.status_code == 403
        assert "Only Super Admins can promote to Super Admin" in resp.text

    def test_org_admin_cannot_invite_super_admin(self):
        headers = make_role_headers(ROLE_ORG_ADMIN, "usr_admin_org1", org_id=ORG_PRIMARY)
        resp = client.post("/api/v1/auth/invite", headers=headers, json={
            "email": "fake.superadmin@stockpilot.ai",
            "full_name": "Fake SA",
            "role": "super_admin"
        })
        assert resp.status_code == 403
        assert "Only Super Admins can provision other Super Admins" in resp.text

    def test_org_admin_cannot_grant_unheld_permissions(self):
        headers = make_role_headers(ROLE_ORG_ADMIN, "usr_admin_org1", org_id=ORG_PRIMARY)
        # Attempt to grant platform cross_org permission which org_admin does not hold
        resp = client.post("/api/v1/auth/invite", headers=headers, json={
            "email": "elevated.user@stockpilot.ai",
            "full_name": "Elevated User",
            "role": "operator",
            "permissions": [PERM_CROSS_ORG_AUDIT_ACCESS]
        })
        assert resp.status_code == 403
        assert "exceeding your administrative privilege scope" in resp.text

    def test_org_admin_cannot_self_promote_or_change_own_role(self):
        headers = make_role_headers(ROLE_ORG_ADMIN, "usr_organizer_vk", org_id=ORG_PRIMARY)
        resp = client.put("/api/v1/auth/users/usr_organizer_vk", headers=headers, json={
            "role": "super_admin"
        })
        assert resp.status_code == 403
        assert "Self-promotion" in resp.text or "Only Super Admins" in resp.text

    def test_org_admin_cannot_deactivate_last_active_admin(self):
        # Deactivate all other org admins first so usr_organizer_vk is the last active
        for u in db.query("users", org_id=ORG_PRIMARY):
            if u.get("role") == ROLE_ORG_ADMIN and u["id"] != "usr_organizer_vk":
                u["is_active"] = False
                db.set_document("users", u["id"], u)

        headers = make_role_headers(ROLE_SUPER_ADMIN, "usr_sa_01", org_id=ORG_PRIMARY)
        resp = client.put("/api/v1/auth/users/usr_organizer_vk", headers=headers, json={
            "is_active": False
        })
        assert resp.status_code == 400
        assert "Cannot deactivate or demote the final required organization administrator" in resp.text

    def test_org_admin_cannot_approve_foreign_org_transfer(self):
        headers = make_role_headers(ROLE_ORG_ADMIN, "usr_admin_org1", org_id=ORG_PRIMARY)
        resp = client.post("/api/v1/transfers/approve", headers=headers, json={
            "transfer_id": "trf_foreign_01",
            "approved": True
        })
        assert resp.status_code == 404

    def test_org_admin_cannot_adjust_foreign_org_batch(self):
        headers = make_role_headers(ROLE_ORG_ADMIN, "usr_admin_org1", org_id=ORG_PRIMARY)
        resp = client.post("/api/v1/inventory/adjust", headers=headers, json={
            "correlation_id": f"ADJ-FRG-FAIL-{uuid.uuid4().hex[:6]}",
            "warehouse_id": "wh_foreign_01",
            "product_id": "prd_foreign_vax",
            "batch_id": "bat_foreign_01",
            "new_quantity": 0,
            "reason": "Hostile cross-tenant inventory deletion"
        })
        assert resp.status_code == 403
        assert "Cross-organization batch access denied" in resp.text


# =============================================================================
# 6. ROLE 1: SUPER_ADMIN INVARIANT AND SECURITY BOUNDARIES
# =============================================================================
class TestSuperAdminNegativeBoundaries:
    """Super Admin cannot violate business invariants or self-deactivate their active session."""

    def test_super_admin_cannot_self_deactivate(self):
        headers = make_role_headers(ROLE_SUPER_ADMIN, "usr_sa_active", org_id=ORG_PRIMARY)
        # Seed usr_sa_active
        db.set_document("users", "usr_sa_active", {
            "id": "usr_sa_active",
            "email": "sa_active@stockpilot.ai",
            "role": ROLE_SUPER_ADMIN,
            "org_id": ORG_PRIMARY,
            "is_active": True
        })
        resp = client.put("/api/v1/auth/users/usr_sa_active", headers=headers, json={
            "is_active": False
        })
        assert resp.status_code == 400
        assert "Cannot deactivate your own active session" in resp.text

    def test_super_admin_cannot_double_approve_transfer(self):
        headers = make_role_headers(ROLE_SUPER_ADMIN, "usr_sa_01", org_id=ORG_PRIMARY)
        # trf_001_chi_ny is already approved in seed data or after initial approval
        # Create a fresh transfer
        trf_id = f"trf_test_double_{uuid.uuid4().hex[:6]}"
        db.set_document("transfers", trf_id, {
            "id": trf_id,
            "org_id": ORG_PRIMARY,
            "source_warehouse_id": "wh_chicago_01",
            "target_warehouse_id": "wh_ny_02",
            "status": "in_transit",  # Already past approved state!
            "items": []
        })
        resp = client.post("/api/v1/transfers/approve", headers=headers, json={
            "transfer_id": trf_id,
            "approved": True
        })
        assert resp.status_code == 409
        assert "already in 'in_transit' state" in resp.text


# =============================================================================
# 7. TOKEN TAMPERING AND FORGERY NEGATIVE TESTS
# =============================================================================
class TestTokenTamperingAndClientSidePrivilegeAttacks:
    """Verify that forged tokens, altered signatures, and missing auth headers are rejected."""

    def test_rejected_tampered_jwt_signature(self):
        valid_headers = make_role_headers(ROLE_OPERATOR, "usr_op_tamper")
        token = valid_headers["Authorization"].replace("Bearer ", "")
        # Tamper last 5 characters
        tampered = token[:-5] + "AAAAA"
        resp = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tampered}"})
        assert resp.status_code == 401

    def test_rejected_unauthenticated_request_to_protected_endpoints(self):
        resp1 = client.get("/api/v1/auth/me")
        assert resp1.status_code == 401
        resp2 = client.post("/api/v1/transfers/approve", json={"transfer_id": "trf_001", "approved": True})
        assert resp2.status_code == 401
        resp3 = client.get("/api/v1/inventory")
        assert resp3.status_code == 401
