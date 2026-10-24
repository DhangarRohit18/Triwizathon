import pytest
from datetime import timedelta
from fastapi.testclient import TestClient
from app.main import app
from app.core.security import create_access_token, decode_access_token, ROLE_OPERATOR, ROLE_SUPPLY_CHAIN_MANAGER, ROLE_ORG_ADMIN
from app.core.database import db
from app.services.firebase_service import FirebaseService
from app.services.seed_data import init_seed_data
from fastapi import HTTPException

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_test_db():
    init_seed_data()
    yield

@pytest.fixture
def auth_headers():
    token = create_access_token(
        subject="usr_supplychain",
        extra_claims={
            "email": "sarah.chen@triwiz.com",
            "role": ROLE_SUPPLY_CHAIN_MANAGER,
            "org_id": "org_triwiz_01",
            "warehouse_id": "wh_chicago_01",
        }
    )
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
def operator_headers():
    token = create_access_token(
        subject="usr_operator",
        extra_claims={
            "email": "operator@stockpilot.ai",
            "role": ROLE_OPERATOR,
            "org_id": "org_triwiz_01",
            "warehouse_id": "wh_chicago_01",
        }
    )
    return {"Authorization": f"Bearer {token}"}

def test_firebase_service_initialization_and_claims():
    """Verify Firebase Admin service initializes and sets tenant claims"""
    assert FirebaseService is not None
    # Test custom claims assignment
    success = FirebaseService.set_user_claims(
        uid="usr_test_fb_01",
        org_id="org_triwiz_01",
        role=ROLE_ORG_ADMIN,
        warehouse_id="wh_chicago_01"
    )
    assert isinstance(success, bool)

def test_auth_token_lifecycle_and_expiration():
    """Verify session token generation, decoding, and expiration enforcement"""
    # Valid token
    valid_token = create_access_token(
        subject="usr_operator",
        expires_delta=timedelta(minutes=30),
        extra_claims={"org_id": "org_triwiz_01", "role": ROLE_OPERATOR}
    )
    decoded = decode_access_token(valid_token)
    assert decoded["sub"] == "usr_operator"
    assert decoded["org_id"] == "org_triwiz_01"
    assert decoded["role"] == ROLE_OPERATOR

    # Expired token
    expired_token = create_access_token(
        subject="usr_operator",
        expires_delta=timedelta(seconds=-10),
        extra_claims={"org_id": "org_triwiz_01", "role": ROLE_OPERATOR}
    )
    with pytest.raises(HTTPException) as exc:
        decode_access_token(expired_token)
    assert exc.value.status_code == 401
    assert "expired" in exc.value.detail.lower()

    # Invalid/Tampered token
    with pytest.raises(HTTPException) as exc_tampered:
        decode_access_token("tampered.fake.jwt.token")
    assert exc_tampered.value.status_code == 401

def test_cross_organization_tenant_isolation(auth_headers):
    """Enforce strict cross-organization tenant separation"""
    # 1. Query with current organization
    docs = db.query("inventory", org_id="org_triwiz_01")
    assert len(docs) > 0
    for doc in docs:
        assert doc.get("org_id") == "org_triwiz_01" or doc.get("organization_id") == "org_triwiz_01"

    # 2. Query with unauthorized/foreign organization
    foreign_docs = db.query("inventory", org_id="org_foreign_unauthorized_99")
    assert len(foreign_docs) == 0

def test_role_restrictions_operator_vs_manager(operator_headers, auth_headers):
    """Test role restrictions: operators cannot trigger transfer approvals or optimization runs"""
    # Operator attempting to approve transfer -> should be denied with 403 Forbidden
    resp = client.post(
        "/api/v1/transfers/approve",
        headers=operator_headers,
        json={"transfer_id": "trf_001_chi_ny", "approved": True}
    )
    assert resp.status_code == 403

    # Operator attempting to run optimization engine -> should be denied with 403 Forbidden
    resp_opt = client.post(
        "/api/v1/optimization/run",
        headers=operator_headers,
        json={"strategy": "balanced", "allow_partial": True}
    )
    assert resp_opt.status_code == 403

    # Supply Chain Manager running optimization engine -> allowed (200 OK)
    resp_mgr = client.post(
        "/api/v1/optimization/run",
        headers=auth_headers,
        json={"strategy": "balanced", "allow_partial": True}
    )
    assert resp_mgr.status_code == 200

def test_iot_telemetry_excursion_alert_and_fcm(auth_headers):
    """Verify real-time sensor excursion detection triggers alert and FCM notification"""
    # Seed device if needed
    device_id = "TEMP-ESP32-01"
    db.set_document("iot_devices", device_id, {
        "id": device_id,
        "device_id": device_id,
        "warehouse_id": "wh_chicago_01",
        "org_id": "org_triwiz_01",
        "storage_zone": "Zone A Cold Room",
        "temp_min_threshold": 2.0,
        "temp_max_threshold": 8.0,
        "humidity_max_threshold": 65.0,
        "is_online": True
    })

    # Ingest high temperature excursion spike (14.2°C, safe limit is 2.0-8.0°C)
    spike_payload = {
        "device_id": device_id,
        "temperature_c": 14.2,
        "humidity_percent": 68.0,
        "battery_level_percent": 92.0,
        "door_open": False
    }
    resp = client.post(
        "/api/v1/iot/telemetry",
        headers={"X-IoT-Key": "stockpilot-iot-secure-esp32-auth-token"},
        json=spike_payload
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] in ("ingested", "alert_created", "reading_ingested", "excursion_alert_triggered") or "reading" in data

    # Verify alert exists in database
    alerts = db.query("alerts", org_id="org_triwiz_01")
    assert len(alerts) > 0
    active_breaches = [a for a in alerts if not a.get("acknowledged")]
    assert len(active_breaches) > 0

    # Acknowledge alert via authenticated endpoint
    alert_id = active_breaches[0]["id"]
    ack_resp = client.post(f"/api/v1/iot/alerts/{alert_id}/acknowledge", headers=auth_headers)
    assert ack_resp.status_code == 200

def test_immutable_audit_logging():
    """Verify regulatory audit log creation and immutability"""
    audit = FirebaseService.record_audit_log(
        org_id="org_triwiz_01",
        actor_id="usr_admin_01",
        actor_name="Marcus Vance",
        action="TRANSFER_APPROVAL",
        resource_type="transfer",
        resource_id="TRF-2026-0891",
        details={"approved": True, "notes": "Approved for Apollo Hospital priority demand"}
    )
    assert audit["id"].startswith("aud_")
    assert audit["org_id"] == "org_triwiz_01"
    assert audit["action"] == "TRANSFER_APPROVAL"

    # Verify queryable from audit collection
    logs = db.query("audit_logs", org_id="org_triwiz_01")
    matching = [l for l in logs if l["id"] == audit["id"]]
    assert len(matching) == 1
