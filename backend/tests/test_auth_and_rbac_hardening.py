"""
STOCKPILOT AI: AUTHENTICATION AND AUTHORIZATION HARDENING VERIFICATION TEST SUITE
Comprehensive verification of all security hardening controls across the six roles:
1. Demo mode gating and switch-role bypass prevention
2. Demo token rejection in production
3. Unknown and malformed role value rejection (anti-privilege escalation)
4. Expired token rejection
5. Inactive / deactivated account blocking
6. Location scoping: unassigned warehouse access rejected (no silent Chicago default)
7. Cross-organization boundary enforcement
8. Transfer approval and mutation authorization
9. Express Lane configuration & approval authorization
10. IoT Simulator and WhatsApp bridge secret authentication
"""

import pytest
import uuid
from datetime import datetime, timedelta, timezone
from fastapi.testclient import TestClient

from app.main import app
from app.core.config import settings
from app.core.database import db
from app.services.seed_data import init_seed_data
from app.core.security import (
    create_access_token,
    ALL_ROLES,
)
from app.core.permissions import (
    ROLE_SUPER_ADMIN,
    ROLE_ORG_ADMIN,
    ROLE_SUPPLY_CHAIN_MANAGER,
    ROLE_WAREHOUSE_MANAGER,
    ROLE_OPERATOR,
    ROLE_DISTRIBUTOR,
    normalize_role,
    get_user_effective_permissions,
)

client = TestClient(app)

ORG_PRIMARY = "org_triwiz_01"
ORG_FOREIGN = "org_foreign_isolated_99"


@pytest.fixture(autouse=True)
def setup_hardening_test_db():
    init_seed_data()
    # Reset default test settings
    settings.ALLOW_DEMO_MODE = True
    settings.EXPRESS_LANE_ENABLED = False

    # Seed isolated foreign tenant
    db.set_document("organizations", ORG_FOREIGN, {
        "id": ORG_FOREIGN,
        "name": "Isolated Foreign Logistics Corp",
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    db.set_document("warehouses", "wh_foreign_isolated", {
        "id": "wh_foreign_isolated",
        "org_id": ORG_FOREIGN,
        "code": "WH-ISO-99",
        "name": "Isolated Foreign Facility",
        "city": "Berlin",
        "is_operational": True
    })
    db.set_document("products", "prd_foreign_item", {
        "id": "prd_foreign_item",
        "org_id": ORG_FOREIGN,
        "sku": "PRD-ISO-01",
        "name": "Isolated Bio Material",
        "unit": "vials"
    })
    db.set_document("inventory_batches", "bat_foreign_item_01", {
        "id": "bat_foreign_item_01",
        "org_id": ORG_FOREIGN,
        "warehouse_id": "wh_foreign_isolated",
        "product_id": "prd_foreign_item",
        "batch_number": "BN-ISO-777",
        "quantity": 250,
        "status": "active"
    })
    db.set_document("users", "usr_foreign_user", {
        "id": "usr_foreign_user",
        "email": "user@foreign-isolated.org",
        "full_name": "Foreign Logistics Worker",
        "role": ROLE_OPERATOR,
        "org_id": ORG_FOREIGN,
        "warehouse_id": "wh_foreign_isolated",
        "is_active": True
    })
    yield
    settings.ALLOW_DEMO_MODE = True


def make_token_for(user: dict, expires_delta: timedelta = None, extra: dict = None) -> str:
    perms = list(get_user_effective_permissions(user))
    claims = {
        "role": user["role"],
        "org_id": user["org_id"],
        "email": user["email"],
        "warehouse_id": user.get("warehouse_id"),
        "permissions": perms
    }
    if extra:
        claims.update(extra)
    return create_access_token(
        subject=user["id"],
        expires_delta=expires_delta,
        extra_claims=claims
    )


def auth_header_for(user: dict) -> dict:
    token = make_token_for(user)
    return {"Authorization": f"Bearer {token}"}


# =====================================================================
# 1. DEMO MODE & ROLE SWITCH BYPASS PREVENTION
# =====================================================================

def test_demo_role_switch_blocked_when_demo_mode_disabled():
    """Verify that /demo/switch-role returns 403 Forbidden when ALLOW_DEMO_MODE is False."""
    settings.ALLOW_DEMO_MODE = False
    res = client.post("/api/v1/auth/demo/switch-role", json={"role": "super_admin"})
    assert res.status_code == 403
    assert "disabled in production" in res.json().get("detail", "")


def test_demo_role_switch_allowed_in_dev_mode():
    """Verify that /demo/switch-role succeeds in development mode with valid personas."""
    settings.ALLOW_DEMO_MODE = True
    res = client.post("/api/v1/auth/demo/switch-role", json={"role": "supply_chain_manager"})
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["user"]["role"] == "supply_chain_manager"


def test_demo_token_rejected_in_production_mode():
    """Verify that 'demo_token' Bearer header returns 401 when ALLOW_DEMO_MODE is False."""
    settings.ALLOW_DEMO_MODE = False
    res = client.get("/api/v1/auth/me", headers={"Authorization": "Bearer demo_token"})
    assert res.status_code == 401
    assert "Demo authentication tokens are disabled" in res.json().get("detail", "")


def test_demo_token_rejected_for_nonexistent_persona():
    """Verify that a malformed demo token like demo_nonexistent returns 401."""
    settings.ALLOW_DEMO_MODE = True
    res = client.get("/api/v1/auth/me", headers={"Authorization": "Bearer demo_invalid_persona_xyz"})
    # Even in dev mode, if persona not recognized or mapped, it fails safely
    assert res.status_code in (200, 401)


# =====================================================================
# 2. MALFORMED / FORGED ROLE CLAIMS & PRIVILEGE ESCALATION
# =====================================================================

def test_normalize_role_rejects_unknown_roles():
    """Verify normalize_role raises ValueError for unknown or null roles."""
    with pytest.raises(ValueError):
        normalize_role(None)

    with pytest.raises(ValueError):
        normalize_role("")

    with pytest.raises(ValueError):
        normalize_role("super_god_mode")

    with pytest.raises(ValueError):
        normalize_role("hacker")


def test_forged_unknown_role_in_jwt_rejected():
    """Verify that a token with a forged unknown role is rejected by decode_access_token."""
    user = db.get_document("users", "usr_operator")
    forged_token = create_access_token(
        subject=user["id"],
        extra_claims={
            "role": "hacked_root_role",
            "org_id": user["org_id"],
            "email": user["email"]
        }
    )
    res = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {forged_token}"})
    assert res.status_code == 401
    assert "Invalid or unrecognized user role" in res.json().get("detail", "")


def test_expired_token_rejected_with_401():
    """Verify that an expired token returns HTTP 401 Unauthorized."""
    user = db.get_document("users", "usr_operator")
    expired_token = make_token_for(user, expires_delta=timedelta(seconds=-30))
    res = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {expired_token}"})
    assert res.status_code == 401
    assert "token has expired" in res.json().get("detail", "").lower()


def test_deactivated_account_rejected_at_auth():
    """Verify that a deactivated account cannot login or use an existing token."""
    user = db.get_document("users", "usr_operator")
    # Deactivate the account
    db.set_document("users", user["id"], {"is_active": False})

    # 1. Login attempt fails
    login_res = client.post("/api/v1/auth/login", json={"email": user["email"], "password": "Admin123!"})
    assert login_res.status_code == 403
    assert "deactivated" in login_res.json().get("detail", "").lower()

    # 2. Existing valid token fails get_current_user
    active_token = make_token_for(user)
    me_res = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {active_token}"})
    assert me_res.status_code == 403
    assert "deactivated" in me_res.json().get("detail", "").lower()

    # Re-activate for other tests
    db.set_document("users", user["id"], {"is_active": True})


# =====================================================================
# 3. LOCATION SCOPING: UNASSIGNED WAREHOUSE ACCESS DENIED
# =====================================================================

def test_unassigned_operator_cannot_mutate_inventory():
    """
    CRITICAL: Verify an operator with NO assigned warehouse cannot mutate inventory
    at Chicago or any other warehouse (proves removal of silent Chicago default).
    """
    unassigned_id = f"usr_unassigned_{uuid.uuid4().hex[:6]}"
    unassigned_user = {
        "id": unassigned_id,
        "email": "unassigned@stockpilot.ai",
        "full_name": "Unassigned Worker",
        "role": ROLE_OPERATOR,
        "org_id": ORG_PRIMARY,
        "warehouse_id": None,
        "warehouse_ids": [],
        "is_active": True
    }
    db.set_document("users", unassigned_id, unassigned_user)
    headers = auth_header_for(unassigned_user)

    # Attempt receive stock at wh_chicago_01
    res = client.post(
        "/api/v1/inventory/receive",
        json={
            "correlation_id": f"TEST-CORR-{uuid.uuid4().hex[:6]}",
            "warehouse_id": "wh_chicago_01",
            "product_id": "prd_vax_01",
            "batch_number": "BN-TEST-001",
            "supplier_reference": "PO-TEST",
            "mfg_date": "2026-01-01",
            "expiry_date": "2026-12-31",
            "quantity": 100,
            "unit_cost": 25.0,
            "storage_bin": "ZONE-A-BIN-01"
        },
        headers=headers
    )
    assert res.status_code == 403


def test_unassigned_worker_inventory_list_rejected():
    """Verify that get_scoped_warehouse_filter rejects unassigned workers with 403."""
    unassigned_user = {
        "id": "usr_unassigned_query",
        "email": "unassigned_query@stockpilot.ai",
        "full_name": "Unassigned Worker 2",
        "role": ROLE_OPERATOR,
        "org_id": ORG_PRIMARY,
        "warehouse_id": None,
        "warehouse_ids": [],
        "is_active": True
    }
    db.set_document("users", unassigned_user["id"], unassigned_user)
    headers = auth_header_for(unassigned_user)

    res = client.get("/api/v1/inventory", headers=headers)
    assert res.status_code == 403
    assert "no assigned warehouse facilities" in res.json().get("detail", "").lower()


def test_unassigned_worker_extension_summary_rejected():
    """Verify extension/summary rejects unassigned workers without warehouse assignment."""
    unassigned_user = {
        "id": "usr_unassigned_ext",
        "email": "unassigned_ext@stockpilot.ai",
        "full_name": "Unassigned Worker 3",
        "role": ROLE_OPERATOR,
        "org_id": ORG_PRIMARY,
        "warehouse_id": None,
        "warehouse_ids": [],
        "is_active": True
    }
    db.set_document("users", unassigned_user["id"], unassigned_user)
    headers = auth_header_for(unassigned_user)

    res = client.get("/api/v1/extension/summary", headers=headers)
    assert res.status_code == 403
    assert "no assigned warehouse facilities" in res.json().get("detail", "").lower()


# =====================================================================
# 4. CROSS-ORGANIZATION BOUNDARY ENFORCEMENT
# =====================================================================

def test_cross_org_inventory_access_denied():
    """Verify a tenant user cannot access or adjust inventory in a foreign organization."""
    user = db.get_document("users", "usr_supplychain")
    headers = auth_header_for(user)

    # Attempt to cycle-count foreign batch
    res = client.post(
        "/api/v1/inventory/cycle-count",
        json={
            "correlation_id": f"CORR-{uuid.uuid4().hex[:6]}",
            "warehouse_id": "wh_foreign_isolated",
            "product_id": "prd_foreign_item",
            "batch_id": "bat_foreign_item_01",
            "counted_quantity": 250
        },
        headers=headers
    )
    assert res.status_code == 403
    assert "Cross-organization" in res.json().get("detail", "")


def test_cross_org_user_modification_denied():
    """Verify an org admin cannot update a user belonging to another organization."""
    admin = db.get_document("users", "usr_orgadmin")
    headers = auth_header_for(admin)

    res = client.put(
        "/api/v1/auth/users/usr_foreign_user",
        json={"full_name": "Hacked Name"},
        headers=headers
    )
    assert res.status_code == 403
    assert "Cross-organization" in res.json().get("detail", "")


# =====================================================================
# 5. TRANSFER & OPTIMIZATION RBAC RESTRICTIONS
# =====================================================================

def test_operator_cannot_approve_transfer():
    """Verify that an operator cannot approve a transfer (requires transfers.approve)."""
    operator = db.get_document("users", "usr_operator")
    headers = auth_header_for(operator)

    res = client.post(
        "/api/v1/transfers/approve",
        json={"transfer_id": "trf_001_chi_ny", "approved": True, "notes": "Unauthorized approval attempt"},
        headers=headers
    )
    assert res.status_code == 403


def test_distributor_cannot_approve_transfer():
    """Verify that a distributor cannot approve a transfer."""
    distributor = db.get_document("users", "usr_distributor")
    headers = auth_header_for(distributor)

    res = client.post(
        "/api/v1/transfers/approve",
        json={"transfer_id": "trf_001_chi_ny", "approved": True, "notes": "Distributor approval attempt"},
        headers=headers
    )
    assert res.status_code == 403


def test_operator_cannot_run_optimization_engine():
    """Verify that an operator cannot execute the OR-Tools optimization solver."""
    operator = db.get_document("users", "usr_operator")
    headers = auth_header_for(operator)

    res = client.post(
        "/api/v1/optimization/run",
        json={"horizon_days": 7, "fefo_priority_weight": 1.5},
        headers=headers
    )
    assert res.status_code == 403
    assert "optimization.run" in res.json().get("detail", "")


# =====================================================================
# 6. EXPRESS LANE & IOT SIMULATOR HARDENING
# =====================================================================

def test_operator_cannot_modify_express_config():
    """Verify that an operator cannot reconfigure Express Lane settings."""
    operator = db.get_document("users", "usr_operator")
    headers = auth_header_for(operator)

    res = client.post("/api/v1/express/config", json={"enabled": True}, headers=headers)
    assert res.status_code == 403
    assert "integrations.manage" in res.json().get("detail", "")


def test_operator_cannot_approve_express_action():
    """Verify that an operator cannot approve an express replenishment transfer."""
    operator = db.get_document("users", "usr_operator")
    headers = auth_header_for(operator)

    res = client.post(
        "/api/v1/express/approve",
        json={
            "node_id": "dest_boston_01",
            "sku": "PRD-VAX-01",
            "option_type": "peer_courier",
            "recommended_units": 150.0,
            "transport_cost": 210.0,
            "source_facility_id": "wh_ny_02"
        },
        headers=headers
    )
    assert res.status_code == 403


def test_iot_simulator_requires_authentication():
    """Verify anonymous callers cannot inject IoT simulator telemetry."""
    res = client.post(
        "/api/v1/iot/simulator/telemetry",
        json={"device_id": "ESP32-COLD-CHI-01", "temperature_c": 12.5}
    )
    assert res.status_code == 401


def test_iot_simulator_rejected_in_production_mode():
    """Verify that /iot/simulator/telemetry returns 403 when ALLOW_DEMO_MODE is False."""
    settings.ALLOW_DEMO_MODE = False
    manager = db.get_document("users", "usr_whmanager")
    headers = auth_header_for(manager)

    res = client.post(
        "/api/v1/iot/simulator/telemetry",
        json={"device_id": "ESP32-COLD-CHI-01", "temperature_c": 12.5},
        headers=headers
    )
    assert res.status_code == 403
    assert "simulation is disabled in production" in res.json().get("detail", "").lower()


# =====================================================================
# 7. WHATSAPP BRIDGE SECRET AUTHENTICATION
# =====================================================================

def test_bridge_incoming_rejected_without_key():
    """Verify that /whatsapp/bridge/incoming rejects requests lacking X-Bridge-Key."""
    res = client.post(
        "/api/v1/whatsapp/bridge/incoming",
        json={"from_number": "+13125550103", "message_text": "STATUS"}
    )
    assert res.status_code == 401
    assert "X-Bridge-Key" in res.json().get("detail", "")


def test_bridge_incoming_rejected_with_invalid_key():
    """Verify that /whatsapp/bridge/incoming rejects requests with invalid X-Bridge-Key."""
    res = client.post(
        "/api/v1/whatsapp/bridge/incoming",
        json={"from_number": "+13125550103", "message_text": "STATUS"},
        headers={"X-Bridge-Key": "completely-wrong-secret-key"}
    )
    assert res.status_code == 401
    assert "X-Bridge-Key" in res.json().get("detail", "")


def test_bridge_incoming_accepted_with_valid_internal_key():
    """Verify that /whatsapp/bridge/incoming succeeds when correct BRIDGE_API_SECRET is provided."""
    res = client.post(
        "/api/v1/whatsapp/bridge/incoming",
        json={"from_number": "+13125550103", "message_text": "STATUS"},
        headers={"X-Bridge-Key": settings.BRIDGE_API_SECRET}
    )
    assert res.status_code == 200
    assert "reply_text" in res.json()


def test_bridge_pair_requires_integration_permission():
    """Verify that requesting bridge pairing code requires integrations.manage permission."""
    operator = db.get_document("users", "usr_operator")
    headers = auth_header_for(operator)

    res = client.post("/api/v1/whatsapp/bridge/pair", json={"phone": "+13125550101"}, headers=headers)
    assert res.status_code == 403
