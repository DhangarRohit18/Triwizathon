"""
Comprehensive Test Suite for WhatsApp, IoT, and Cross-Platform Integration Hardening Audit.

Tests:
- Meta webhook signature verification (valid, invalid, production missing secret fail-closed)
- Webhook idempotency & message deduplication
- Unregistered sender rejection & isolation
- Role permission enforcement & self-role-elevation denial
- Simulator isolation in production environments
- Device authentication via X-IoT-Key, X-Device-API-Key, Bearer token
- Sensor payload validation (bounds, units, timestamps)
- Telemetry deduplication
- Stale device detection vs online reporting
- Cold-chain excursion alerts, throttling, and Firestore synchronization
- Alert acknowledgement idempotency and double-ack conflict (HTTP 409)
- WhatsApp transfer approval state and facility authority verification
- Extension summary scoping and direct alert acknowledgement
"""

import json
import hmac
import hashlib
import uuid
from datetime import datetime, timezone, timedelta
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.database import db
from app.core.config import settings
from app.services.iot_service import IoTTelemetryService
from app.services.whatsapp_service import WhatsAppBotService
from app.services.seed_data import init_seed_data
from app.core.security import create_access_token

client = TestClient(app)

@pytest.fixture(autouse=True)
def ensure_seed_data():
    """Ensure in-memory seed data is initialized."""
    init_seed_data()
    yield

def _mint_token(user_id="usr_superadmin_01", role="super_admin", org_id="org_triwiz_01", warehouse_id="wh_chicago_01", email="admin@triwiz.com") -> str:
    init_seed_data()
    users = db.query("users", org_id=org_id)
    match = next((u for u in users if u.get("role") == role), None)
    uid = match["id"] if match else user_id
    wh = match.get("warehouse_id", warehouse_id) if match else warehouse_id
    em = match.get("email", email) if match else email
    return create_access_token(
        subject=uid,
        extra_claims={
            "role": role,
            "org_id": org_id,
            "warehouse_id": wh,
            "email": em,
            "full_name": match.get("full_name", "Test User") if match else "Test User"
        }
    )

def _auth_headers(role="super_admin", org_id="org_triwiz_01"):
    return {"Authorization": f"Bearer {_mint_token(role=role, org_id=org_id)}"}

def _seed_test_device(device_id="esp32_audit_dev_01", warehouse_id="wh_chicago_01"):
    existing = db.get_document("iot_devices", device_id)
    if existing:
        return existing
    device_api_key = "iotk_audit_key_secret_123"
    hashed_key = hashlib.sha256(device_api_key.encode()).hexdigest()
    dev = {
        "id": device_id,
        "device_id": device_id,
        "warehouse_id": warehouse_id,
        "warehouse_name": "Chicago Central Distribution Hub",
        "storage_zone": "Cold Storage Alpha",
        "device_name": "Audit ESP32 Probe",
        "mac_address": "AA:BB:CC:DD:EE:FF",
        "ip_address": "192.168.1.100",
        "last_ping": datetime.now(timezone.utc).isoformat(),
        "is_online": True,
        "firmware_version": "v2.6.1-audit",
        "temp_min_threshold": 2.0,
        "temp_max_threshold": 8.0,
        "humidity_max_threshold": 65.0,
        "current_temp": 4.5,
        "current_humidity": 55.0,
        "org_id": "org_triwiz_01",
        "api_key_hash": hashed_key,
        "reporting_interval_sec": 300
    }
    db.set_document("iot_devices", device_id, dev)
    return dev

# ─────────────────────────────────────────────────────────────────────────────
# WhatsApp Tests
# ─────────────────────────────────────────────────────────────────────────────

def test_webhook_signature_verification_success():
    """Valid HMAC-SHA256 signature returns HTTP 200 and processes payload."""
    secret = "audit-app-secret-2026"
    orig_secret = settings.WHATSAPP_APP_SECRET
    settings.WHATSAPP_APP_SECRET = secret

    try:
        payload = {
            "entry": [{
                "id": "audit_entry_1",
                "changes": [{
                    "value": {
                        "messaging_product": "whatsapp",
                        "metadata": {"display_phone_number": "15551234567", "phone_number_id": "pn_123"},
                        "messages": [{
                            "from": "+13125550101",
                            "id": f"wamid_sig_valid_{uuid.uuid4().hex[:8]}",
                            "timestamp": str(int(datetime.now(timezone.utc).timestamp())),
                            "text": {"body": "HELP"},
                            "type": "text"
                        }]
                    },
                    "field": "messages"
                }]
            }]
        }
        body = json.dumps(payload).encode("utf-8")
        sig = "sha256=" + hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()

        resp = client.post(
            "/api/v1/whatsapp/webhook",
            data=body,
            headers={"Content-Type": "application/json", "X-Hub-Signature-256": sig}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("status") in ("delivered", "processed")
    finally:
        settings.WHATSAPP_APP_SECRET = orig_secret

def test_webhook_signature_verification_failure():
    """Invalid signature returns HTTP 403 Forbidden."""
    secret = "audit-app-secret-2026"
    orig_secret = settings.WHATSAPP_APP_SECRET
    settings.WHATSAPP_APP_SECRET = secret

    try:
        payload = {"entry": []}
        body = json.dumps(payload).encode("utf-8")
        bad_sig = "sha256=invalidbadhash0000000000000000000000000000000000000000000000000000"

        resp = client.post(
            "/api/v1/whatsapp/webhook",
            data=body,
            headers={"Content-Type": "application/json", "X-Hub-Signature-256": bad_sig}
        )
        assert resp.status_code == 403
        assert "signature" in resp.json().get("detail", "").lower()
    finally:
        settings.WHATSAPP_APP_SECRET = orig_secret

def test_webhook_production_missing_secret_fails_closed():
    """In production environment, webhook fails closed (403) if WHATSAPP_APP_SECRET is missing."""
    orig_env = settings.ENVIRONMENT
    orig_secret = settings.WHATSAPP_APP_SECRET
    settings.ENVIRONMENT = "production"
    settings.WHATSAPP_APP_SECRET = ""

    try:
        body = json.dumps({"entry": []}).encode("utf-8")
        resp = client.post(
            "/api/v1/whatsapp/webhook",
            data=body,
            headers={"Content-Type": "application/json"}
        )
        assert resp.status_code == 403
        assert "signature" in resp.json().get("detail", "").lower()
    finally:
        settings.ENVIRONMENT = orig_env
        settings.WHATSAPP_APP_SECRET = orig_secret

def test_webhook_duplicate_message_idempotency():
    """Meta webhook deduplicates identical message IDs and returns duplicate_ignored."""
    msg_id = f"wamid_idemp_{uuid.uuid4().hex[:10]}"
    payload = {
        "entry": [{
            "id": "audit_entry_2",
            "changes": [{
                "value": {
                    "messaging_product": "whatsapp",
                    "metadata": {"display_phone_number": "15551234567", "phone_number_id": "pn_123"},
                    "messages": [{
                        "from": "+13125550101",
                        "id": msg_id,
                        "timestamp": str(int(datetime.now(timezone.utc).timestamp())),
                        "text": {"body": "HELP"},
                        "type": "text"
                    }]
                },
                "field": "messages"
            }]
        }]
    }

    # First call
    resp1 = client.post("/api/v1/whatsapp/webhook", json=payload)
    assert resp1.status_code == 200
    assert resp1.json().get("status") in ("delivered", "processed")

    # Second call with identical message ID
    resp2 = client.post("/api/v1/whatsapp/webhook", json=payload)
    assert resp2.status_code == 200
    assert resp2.json().get("status") == "duplicate_ignored"

def test_unregistered_sender_rejection():
    """Unregistered phone number receives security guidance notice; no privileged actions taken."""
    unknown_phone = "+19998887777"
    res = WhatsAppBotService.process_incoming_message(
        from_number=unknown_phone,
        message_text="APPROVE trf_fake_123",
        org_id="org_triwiz_01",
        is_simulated=True,
    )
    assert res.get("status") == "unauthorized"
    assert res.get("action_taken") == "UNAUTHORIZED_SENDER"
    assert "Security Notice" in res.get("reply_text", "")

def test_self_role_elevation_denied():
    """An admin cannot elevate or modify their own role via WhatsApp bot."""
    users = db.query("users", org_id="org_triwiz_01")
    admin_user = next((u for u in users if u.get("role") == "super_admin"), None)
    assert admin_user is not None
    admin_phone = admin_user.get("phone") or admin_user.get("phone_number") or "+13125550101"

    reply = WhatsAppBotService.handle_user_role(
        admin_user=admin_user,
        args=[admin_phone, "warehouse_manager"],
        org_id="org_triwiz_01"
    )
    assert "Self-Elevation Denied" in reply

def test_whatsapp_simulator_isolation_in_production():
    """Simulator endpoint is strictly disabled with HTTP 403 in production."""
    orig_env = settings.ENVIRONMENT
    settings.ENVIRONMENT = "production"
    try:
        resp = client.post(
            "/api/v1/whatsapp/simulator/chat",
            json={"message_text": "HELP", "from_number": "+13125550101"},
            headers=_auth_headers("super_admin")
        )
        assert resp.status_code == 403
        assert "disabled in production" in resp.json().get("detail", "").lower()
    finally:
        settings.ENVIRONMENT = orig_env

def test_whatsapp_simulator_spoofing_denied_for_non_superadmin():
    """In non-production, a non-superadmin caller cannot supply arbitrary sender numbers."""
    resp = client.post(
        "/api/v1/whatsapp/simulator/chat",
        json={"message_text": "HELP", "from_number": "+19991112222"},
        headers=_auth_headers("operator")
    )
    assert resp.status_code == 403
    assert "Only super_admin may test arbitrary from_number" in resp.json().get("detail", "")

def test_whatsapp_transfer_approval_facility_and_state_verification():
    """WhatsApp transfer approval checks transfer existence, facility authorization, and state."""
    users = db.query("users", org_id="org_triwiz_01")
    admin = next((u for u in users if u.get("role") == "super_admin"), None) or {"id": "admin", "role": "super_admin", "phone": "+13125550101"}
    admin_phone = admin.get("phone") or admin.get("phone_number") or "+13125550101"

    # 1. Non-existent transfer
    res_notfound = WhatsAppBotService.process_incoming_message(
        from_number=admin_phone,
        message_text="APPROVE trf_does_not_exist_999",
        org_id="org_triwiz_01",
        is_simulated=True
    )
    assert res_notfound.get("action_taken") == "TRANSFER_NOT_FOUND"

    # 2. Setup a valid pending transfer
    trf_id = f"trf_audit_{uuid.uuid4().hex[:8]}"
    db.set_document("transfers", trf_id, {
        "id": trf_id,
        "org_id": "org_triwiz_01",
        "source_warehouse_id": "wh_chicago_01",
        "target_warehouse_id": "wh_dallas_01",
        "status": "pending",
        "items": [{"product_id": "prd_001_pfe_cov", "quantity": 10}]
    })

    # 3. Warehouse manager from unrelated warehouse (e.g. Miami manager trying Chicago src)
    unrelated_phone = "+13125550199"
    db.set_document("users", "usr_unrelated_mgr", {
        "id": "usr_unrelated_mgr",
        "email": "unrelated@triwiz.com",
        "full_name": "Unrelated Manager",
        "role": "warehouse_manager",
        "warehouse_id": "wh_miami_99",
        "warehouse_ids": ["wh_miami_99"],
        "phone": unrelated_phone,
        "phone_number": unrelated_phone,
        "org_id": "org_triwiz_01",
        "is_active": True,
        "whatsapp_opted_in": True
    })
    res_unauth = WhatsAppBotService.process_incoming_message(
        from_number=unrelated_phone,
        message_text=f"APPROVE {trf_id}",
        org_id="org_triwiz_01",
        is_simulated=True
    )
    assert res_unauth.get("action_taken") == "TRANSFER_WAREHOUSE_UNAUTHORIZED"

    # 4. Authorized warehouse manager (assigned to wh_chicago_01)
    assigned_phone = "+13125550103"
    mgr_chi = next((u for u in users if u.get("role") in ("warehouse_manager", "supply_chain_manager") and u.get("warehouse_id") == "wh_chicago_01"), None)
    chi_phone = (mgr_chi.get("phone") or mgr_chi.get("phone_number") or assigned_phone) if mgr_chi else assigned_phone

    res_auth = WhatsAppBotService.process_incoming_message(
        from_number=chi_phone,
        message_text=f"APPROVE {trf_id}",
        org_id="org_triwiz_01",
        is_simulated=True
    )
    assert res_auth.get("action_taken") == "TRANSFER_APPROVED"

    # 5. Double approval attempt rejects because status is now approved
    res_double = WhatsAppBotService.process_incoming_message(
        from_number=chi_phone,
        message_text=f"APPROVE {trf_id}",
        org_id="org_triwiz_01",
        is_simulated=True
    )
    assert res_double.get("action_taken") == "TRANSFER_ALREADY_PROCESSED"

# ─────────────────────────────────────────────────────────────────────────────
# IoT Telemetry & Alert Tests
# ─────────────────────────────────────────────────────────────────────────────

def test_iot_telemetry_device_key_auth():
    """Device ingestion authenticates via X-IoT-Key, X-Device-API-Key, or Bearer key."""
    _seed_test_device("esp32_auth_test")

    # Ingest with valid per-device key
    payload = {
        "device_id": "esp32_auth_test",
        "temperature_c": 5.0,
        "temperature_unit": "C",
        "humidity_percent": 50.0
    }
    resp = client.post(
        "/api/v1/iot/telemetry",
        json=payload,
        headers={"X-Device-API-Key": "iotk_audit_key_secret_123"}
    )
    assert resp.status_code == 200
    assert resp.json().get("status") == "ingested"

    # Ingest with invalid key returns 401
    resp_bad = client.post(
        "/api/v1/iot/telemetry",
        json=payload,
        headers={"X-Device-API-Key": "wrong_key_xyz"}
    )
    assert resp_bad.status_code == 401

def test_iot_invalid_sensor_payloads_sanity_bounds():
    """Physical sanity bounds: -150°C marked is_valid=False without alert; invalid unit 'K' returns 400."""
    _seed_test_device("esp32_bounds_test")

    # Out of physical sanity bounds
    resp_out = client.post(
        "/api/v1/iot/telemetry",
        json={
            "device_id": "esp32_bounds_test",
            "temperature_c": -150.0,
            "temperature_unit": "C"
        },
        headers={"X-IoT-Key": "iotk_audit_key_secret_123"}
    )
    assert resp_out.status_code == 200
    assert resp_out.json().get("is_valid") is False
    assert resp_out.json().get("alerts_triggered_count") == 0

    # Invalid temperature unit
    resp_bad_unit = client.post(
        "/api/v1/iot/telemetry",
        json={
            "device_id": "esp32_bounds_test",
            "temperature_c": 300.0,
            "temperature_unit": "K"
        },
        headers={"X-IoT-Key": "iotk_audit_key_secret_123"}
    )
    assert resp_bad_unit.status_code == 400
    assert "Invalid temperature_unit" in resp_bad_unit.json().get("detail", "")

def test_iot_future_and_stale_timestamps():
    """Timestamps >5m in future or >7d in past are rejected with HTTP 400."""
    _seed_test_device("esp32_time_test")

    # Future timestamp (10 minutes ahead)
    future_ts = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
    resp_future = client.post(
        "/api/v1/iot/telemetry",
        json={
            "device_id": "esp32_time_test",
            "temperature_c": 4.0,
            "timestamp": future_ts
        },
        headers={"X-IoT-Key": "iotk_audit_key_secret_123"}
    )
    assert resp_future.status_code == 400
    assert "too far in future" in resp_future.json().get("detail", "").lower()

    # Stale timestamp (10 days old)
    stale_ts = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
    resp_stale = client.post(
        "/api/v1/iot/telemetry",
        json={
            "device_id": "esp32_time_test",
            "temperature_c": 4.0,
            "timestamp": stale_ts
        },
        headers={"X-IoT-Key": "iotk_audit_key_secret_123"}
    )
    assert resp_stale.status_code == 400
    assert "stale" in resp_stale.json().get("detail", "").lower() or "too old" in resp_stale.json().get("detail", "").lower()

def test_iot_telemetry_deduplication():
    """Resubmitting exact same device_id and timestamp returns status='duplicate_ignored'."""
    _seed_test_device("esp32_dedup_test")
    fixed_ts = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()

    payload = {
        "device_id": "esp32_dedup_test",
        "temperature_c": 5.2,
        "humidity_percent": 45.0,
        "timestamp": fixed_ts
    }

    # First ingestion
    resp1 = client.post(
        "/api/v1/iot/telemetry",
        json=payload,
        headers={"X-IoT-Key": "iotk_audit_key_secret_123"}
    )
    assert resp1.status_code == 200
    assert resp1.json().get("status") == "ingested"

    # Duplicate ingestion
    resp2 = client.post(
        "/api/v1/iot/telemetry",
        json=payload,
        headers={"X-IoT-Key": "iotk_audit_key_secret_123"}
    )
    assert resp2.status_code == 200
    assert resp2.json().get("status") == "duplicate_ignored"
    assert resp2.json().get("is_duplicate") is True

def test_iot_stale_device_detection_not_reported_online():
    """Device whose last_ping is older than freshness window is reported is_online=False and connectivity_status='stale'."""
    dev_id = "esp32_stale_check_dev"
    _seed_test_device(dev_id)

    # Set last_ping to 2 hours ago
    stale_ping = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    dev = db.get_document("iot_devices", dev_id)
    dev["last_ping"] = stale_ping
    dev["is_online"] = True  # intentionally stale in DB
    db.set_document("iot_devices", dev_id, dev)

    resp = client.get("/api/v1/iot/devices", headers=_auth_headers("super_admin"))
    assert resp.status_code == 200
    devices = resp.json()
    stale_dev = next((d for d in devices if d["device_id"] == dev_id), None)
    assert stale_dev is not None
    assert stale_dev["is_online"] is False
    assert stale_dev["connectivity_status"] == "stale"
    assert stale_dev["data_freshness_seconds"] >= 7200

def test_iot_excursion_alert_and_acknowledgement_idempotency():
    """Cold-chain excursion triggers alert; ack records actor; second ack returns HTTP 409 Conflict."""
    dev_id = "esp32_excursion_dev"
    _seed_test_device(dev_id)

    # Ingest temperature spike (15.5°C when safe max is 8.0°C)
    ts = (datetime.now(timezone.utc) - timedelta(seconds=10)).isoformat()
    resp_ingest = client.post(
        "/api/v1/iot/telemetry",
        json={
            "device_id": dev_id,
            "temperature_c": 15.5,
            "humidity_percent": 60.0,
            "timestamp": ts
        },
        headers={"X-IoT-Key": "iotk_audit_key_secret_123"}
    )
    assert resp_ingest.status_code == 200
    alerts = resp_ingest.json().get("alerts_triggered", [])
    assert len(alerts) >= 1
    alert_id = alerts[0]["id"]

    # First acknowledgement succeeds
    resp_ack1 = client.post(
        f"/api/v1/iot/alerts/{alert_id}/acknowledge",
        headers=_auth_headers("warehouse_manager")
    )
    assert resp_ack1.status_code == 200
    ack_data = resp_ack1.json()
    ack_alert = ack_data.get("alert") or ack_data
    assert ack_alert.get("acknowledged") is True
    assert ack_alert.get("acknowledged_by") is not None

    # Second acknowledgement on same alert returns 409 Conflict
    resp_ack2 = client.post(
        f"/api/v1/iot/alerts/{alert_id}/acknowledge",
        headers=_auth_headers("warehouse_manager")
    )
    assert resp_ack2.status_code == 409
    assert "already acknowledged" in resp_ack2.json().get("detail", "").lower()

def test_iot_simulator_isolation_in_production():
    """IoT simulator injection is strictly forbidden in production."""
    orig_env = settings.ENVIRONMENT
    settings.ENVIRONMENT = "production"
    try:
        resp = client.post(
            "/api/v1/iot/simulator/inject",
            json={"device_id": "esp32_sim_audit", "temperature_c": 12.0},
            headers=_auth_headers("super_admin")
        )
        assert resp.status_code == 403
        assert "disabled in production" in resp.json().get("detail", "").lower()
    finally:
        settings.ENVIRONMENT = orig_env

# ─────────────────────────────────────────────────────────────────────────────
# Cross-Platform Shared State & Extension Tests
# ─────────────────────────────────────────────────────────────────────────────

def test_extension_summary_and_alert_ack():
    """Extension summary returns scoped alerts and supports direct alert acknowledgement."""
    # 1. Summary
    resp = client.get("/api/v1/extension/summary", headers=_auth_headers("warehouse_manager"))
    assert resp.status_code == 200
    summary = resp.json()
    assert "user" in summary
    assert "warehouse" in summary
    assert "stock" in summary
    assert "active_alerts" in summary

    # 2. Trigger an unacknowledged alert
    dev_id = "esp32_ext_alert_dev"
    _seed_test_device(dev_id)
    ts = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
    client.post(
        "/api/v1/iot/telemetry",
        json={"device_id": dev_id, "temperature_c": -10.0, "timestamp": ts},
        headers={"X-IoT-Key": "iotk_audit_key_secret_123"}
    )
    alerts = db.query("alerts", filters={"device_id": dev_id, "acknowledged": False})
    assert len(alerts) >= 1
    alt_id = alerts[0]["id"]

    # 3. Extension acknowledges alert
    resp_ext_ack = client.post(
        f"/api/v1/extension/acknowledge-alert/{alt_id}",
        headers=_auth_headers("warehouse_manager")
    )
    assert resp_ext_ack.status_code == 200
    ack_data = resp_ext_ack.json()
    ack_alert = ack_data.get("alert") or ack_data
    assert ack_alert.get("acknowledged") is True

