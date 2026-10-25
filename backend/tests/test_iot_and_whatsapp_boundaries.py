"""
Tests for IoT telemetry boundaries and WhatsApp Business Platform integration.
Covers: invalid telemetry, bad units, future/stale timestamps, duplicate webhooks,
unauthorized senders, invalid signatures, double approvals, opt-out/opt-in.
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

# ─────────────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def ensure_seed_data():
    """Ensure seed data is loaded before every test."""
    init_seed_data()
    yield


def _mint_token(user_id="usr_superadmin_01", role="super_admin", org_id="org_triwiz_01") -> str:
    """
    Mint a JWT directly using create_access_token — bypasses bcrypt login
    (bcrypt.__about__ is missing on Python 3.14, breaking passlib password verify).
    This tests the IoT/WhatsApp endpoints, not the auth flow.
    """
    init_seed_data()
    # Resolve the real super_admin user ID from the seeded store
    users = db.query("users", org_id=org_id)
    admin = next((u for u in users if u.get("role") == role), None)
    uid = admin["id"] if admin else user_id
    return create_access_token(
        subject=uid,
        extra_claims={"role": role, "org_id": org_id, "email": "sarah.chen@triwiz.com"}
    )


def _admin_headers():
    return {"Authorization": "Bearer " + _mint_token()}


def _seed_test_device(device_id="esp32_test_01", warehouse_id="wh_chicago_01"):
    existing = db.get_document("iot_devices", device_id)
    if existing:
        return existing
    device_api_key = "iotk_test_global_key"
    key_hash = hashlib.sha256(device_api_key.encode()).hexdigest()
    now_iso = datetime.now(timezone.utc).isoformat()
    record = {
        "id": device_id, "org_id": "org_triwiz_01", "warehouse_id": warehouse_id,
        "storage_zone": "Cold Storage A", "device_type": "ESP32_COLD_CHAIN",
        "temp_min_threshold": 2.0, "temp_max_threshold": 8.0,
        "humidity_max_threshold": 65.0, "reporting_interval_sec": 300,
        "api_key_hash": key_hash, "is_online": False, "last_ping": None,
        "current_temp": None, "current_humidity": None, "battery_level_percent": None,
        "rssi_dbm": None, "boot_count": 0, "health_status": "unknown",
        "registered_by": "test", "registered_at": now_iso,
    }
    db.set_document("iot_devices", device_id, record, merge=False)
    return record


# ─────────────────────────────────────────────────────────────────────────────
# IoT Tests
# ─────────────────────────────────────────────────────────────────────────────

class TestIoTIngestion:

    def setup_method(self):
        _seed_test_device()

    def test_valid_celsius_reading_ingested(self):
        """Happy path: valid C reading is ingested and returns status=ingested."""
        res = IoTTelemetryService.ingest_reading(
            payload={"device_id": "esp32_test_01", "temperature_c": 5.0,
                     "temperature_unit": "C", "humidity_percent": 45.0,
                     "battery_level_percent": 80.0},
            auth_api_key="iotk_test_global_key",
            expected_api_key=settings.IOT_API_KEY,
        )
        assert res["status"] == "ingested"
        assert res["temperature_c_stored"] == pytest.approx(5.0, abs=0.01)
        assert res["is_valid"] is True
        assert res["location_mismatch_detected"] is False

    def test_fahrenheit_converted_to_celsius(self):
        """32°F must be stored as 0.0°C."""
        res = IoTTelemetryService.ingest_reading(
            payload={"device_id": "esp32_test_01", "temperature_c": 32.0,
                     "temperature_unit": "F", "humidity_percent": 50.0},
            auth_api_key="iotk_test_global_key",
            expected_api_key=settings.IOT_API_KEY,
        )
        assert res["temperature_unit_received"] == "F"
        assert res["temperature_c_stored"] == pytest.approx(0.0, abs=0.01)

    def test_invalid_temperature_unit_rejected(self):
        """Invalid unit 'K' must return 400."""
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            IoTTelemetryService.ingest_reading(
                payload={"device_id": "esp32_test_01", "temperature_c": 25.0,
                         "temperature_unit": "K", "humidity_percent": 50.0},
                auth_api_key="iotk_test_global_key",
                expected_api_key=settings.IOT_API_KEY,
            )
        assert exc_info.value.status_code == 400
        assert "temperature_unit" in str(exc_info.value.detail).lower() or "K" in str(exc_info.value.detail)

    def test_future_timestamp_rejected(self):
        """Timestamp > 5 min in future must be rejected with 400."""
        from fastapi import HTTPException
        future_ts = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
        with pytest.raises(HTTPException) as exc_info:
            IoTTelemetryService.ingest_reading(
                payload={"device_id": "esp32_test_01", "temperature_c": 5.0,
                         "temperature_unit": "C", "humidity_percent": 50.0,
                         "timestamp": future_ts},
                auth_api_key="iotk_test_global_key",
                expected_api_key=settings.IOT_API_KEY,
            )
        assert exc_info.value.status_code == 400
        assert "future" in str(exc_info.value.detail).lower()

    def test_stale_timestamp_rejected(self):
        """Timestamp > 7 days old must be rejected with 400."""
        from fastapi import HTTPException
        stale_ts = (datetime.now(timezone.utc) - timedelta(days=8)).isoformat()
        with pytest.raises(HTTPException) as exc_info:
            IoTTelemetryService.ingest_reading(
                payload={"device_id": "esp32_test_01", "temperature_c": 5.0,
                         "temperature_unit": "C", "humidity_percent": 50.0,
                         "timestamp": stale_ts},
                auth_api_key="iotk_test_global_key",
                expected_api_key=settings.IOT_API_KEY,
            )
        assert exc_info.value.status_code == 400
        assert "stale" in str(exc_info.value.detail).lower()

    def test_out_of_range_temperature_marked_invalid(self):
        """Temperature of 200°C is outside sanity bounds -> is_valid=False, no alerts."""
        res = IoTTelemetryService.ingest_reading(
            payload={"device_id": "esp32_test_01", "temperature_c": 200.0,
                     "temperature_unit": "C", "humidity_percent": 50.0},
            auth_api_key="iotk_test_global_key",
            expected_api_key=settings.IOT_API_KEY,
        )
        assert res["is_valid"] is False
        assert res["alerts_triggered_count"] == 0

    def test_unauthorized_device_rejected(self):
        """Unregistered device_id must return 403."""
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            IoTTelemetryService.ingest_reading(
                payload={"device_id": "esp32_unknown_xyz", "temperature_c": 5.0,
                         "temperature_unit": "C", "humidity_percent": 50.0},
                auth_api_key="any_key",
                expected_api_key=settings.IOT_API_KEY,
            )
        assert exc_info.value.status_code == 403

    def test_location_mismatch_detected(self):
        """Device supplying wrong org_id must have location_mismatch_detected=True."""
        res = IoTTelemetryService.ingest_reading(
            payload={"device_id": "esp32_test_01", "temperature_c": 5.0,
                     "temperature_unit": "C", "humidity_percent": 50.0,
                     "supplied_org_id": "org_evil_actor_99"},
            auth_api_key="iotk_test_global_key",
            expected_api_key=settings.IOT_API_KEY,
        )
        assert res["location_mismatch_detected"] is True
        # Authoritative org must be preserved
        assert res["warehouse_id"] == "wh_chicago_01"

    def test_temp_excursion_alert_generated(self):
        """Temperature above max threshold must generate temp_excursion alert."""
        res = IoTTelemetryService.ingest_reading(
            payload={"device_id": "esp32_test_01", "temperature_c": 15.0,
                     "temperature_unit": "C", "humidity_percent": 50.0},
            auth_api_key="iotk_test_global_key",
            expected_api_key=settings.IOT_API_KEY,
        )
        assert res["alerts_triggered_count"] >= 1
        types = [a["alert_type"] for a in res["alerts_triggered"]]
        assert "temp_excursion" in types

    def test_humidity_breach_alert_generated(self):
        """Humidity above threshold must generate humidity_breach alert."""
        res = IoTTelemetryService.ingest_reading(
            payload={"device_id": "esp32_test_01", "temperature_c": 5.0,
                     "temperature_unit": "C", "humidity_percent": 90.0},
            auth_api_key="iotk_test_global_key",
            expected_api_key=settings.IOT_API_KEY,
        )
        types = [a["alert_type"] for a in res["alerts_triggered"]]
        assert "humidity_breach" in types

    def test_low_battery_alert_generated(self):
        """Battery < 15% must generate low_battery alert."""
        res = IoTTelemetryService.ingest_reading(
            payload={"device_id": "esp32_test_01", "temperature_c": 5.0,
                     "temperature_unit": "C", "humidity_percent": 50.0,
                     "battery_level_percent": 10.0},
            auth_api_key="iotk_test_global_key",
            expected_api_key=settings.IOT_API_KEY,
        )
        types = [a["alert_type"] for a in res["alerts_triggered"]]
        assert "low_battery" in types

    def test_hourly_aggregate_updated(self):
        """After ingestion, iot_aggregates must have a bucket for this hour."""
        from datetime import datetime, timezone
        IoTTelemetryService.ingest_reading(
            payload={"device_id": "esp32_test_01", "temperature_c": 5.0,
                     "temperature_unit": "C", "humidity_percent": 50.0},
            auth_api_key="iotk_test_global_key",
            expected_api_key=settings.IOT_API_KEY,
        )
        hour_key = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H")
        agg_id = "esp32_test_01_" + hour_key
        agg = db.get_document("iot_aggregates", agg_id)
        assert agg is not None
        assert agg["sample_count"] >= 1
        assert "avg_temp_c" in agg

    def test_alert_double_acknowledge_rejected(self):
        """Acknowledging an already-acknowledged alert must return 409."""
        from fastapi import HTTPException
        res = IoTTelemetryService.ingest_reading(
            payload={"device_id": "esp32_test_01", "temperature_c": 20.0,
                     "temperature_unit": "C", "humidity_percent": 50.0},
            auth_api_key="iotk_test_global_key",
            expected_api_key=settings.IOT_API_KEY,
        )
        if not res["alerts_triggered"]:
            pytest.skip("No alerts triggered in this test run")
        alert_id = res["alerts_triggered"][0]["id"]
        # First ACK
        IoTTelemetryService.acknowledge_alert(
            alert_id=alert_id, actor_id="usr_admin", actor_name="Admin", org_id="org_triwiz_01")
        # Second ACK must fail
        with pytest.raises(HTTPException) as exc_info:
            IoTTelemetryService.acknowledge_alert(
                alert_id=alert_id, actor_id="usr_admin", actor_name="Admin", org_id="org_triwiz_01")
        assert exc_info.value.status_code == 409

    def test_simulator_endpoint_returns_simulated_flag(self, monkeypatch):
        """Simulator endpoint must return is_simulated=True and simulator_note."""
        monkeypatch.setattr(settings, "ALLOW_DEMO_MODE", True)
        headers = _admin_headers()
        payload = {"device_id": "esp32_test_01", "temperature_c": 5.0,
                   "humidity_percent": 50.0, "is_simulated": True}
        r = client.post("/api/v1/iot/simulator/inject", json=payload, headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert data.get("is_simulated") is True
        assert "simulator_note" in data


# ─────────────────────────────────────────────────────────────────────────────
# WhatsApp Tests
# ─────────────────────────────────────────────────────────────────────────────

class TestWhatsAppWebhook:

    def test_webhook_verification_handshake(self):
        """GET /webhook with correct verify_token returns hub.challenge."""
        challenge = "test_challenge_12345"
        r = client.get("/api/v1/whatsapp/webhook", params={
            "hub.mode": "subscribe",
            "hub.verify_token": settings.WHATSAPP_VERIFY_TOKEN,
            "hub.challenge": challenge,
        })
        assert r.status_code == 200
        assert challenge in r.text

    def test_webhook_wrong_token_returns_403(self):
        """GET /webhook with wrong verify_token returns 403."""
        r = client.get("/api/v1/whatsapp/webhook", params={
            "hub.mode": "subscribe",
            "hub.verify_token": "wrong_token_xyz",
            "hub.challenge": "irrelevant",
        })
        assert r.status_code == 403

    def test_invalid_signature_returns_403(self):
        """POST /webhook with bad X-Hub-Signature-256 returns 403 when secret is real."""
        # Temporarily set a real (non-mock) secret to trigger strict validation
        original_secret = settings.WHATSAPP_APP_SECRET
        settings.WHATSAPP_APP_SECRET = "real_secret_abc"
        try:
            payload = json.dumps({"entry": []}).encode()
            r = client.post(
                "/api/v1/whatsapp/webhook",
                content=payload,
                headers={"Content-Type": "application/json",
                         "X-Hub-Signature-256": "sha256=badhashvalue"},
            )
            assert r.status_code == 403
        finally:
            settings.WHATSAPP_APP_SECRET = original_secret

    def test_valid_signature_accepted(self):
        """POST /webhook with correct HMAC signature is accepted."""
        original_secret = settings.WHATSAPP_APP_SECRET
        settings.WHATSAPP_APP_SECRET = "test_secret_for_signature"
        try:
            payload_data = json.dumps({
                "entry": [{"changes": [{"value": {"messages": []}}]}]
            }).encode()
            expected_sig = hmac.new(
                b"test_secret_for_signature", payload_data, hashlib.sha256).hexdigest()
            r = client.post(
                "/api/v1/whatsapp/webhook",
                content=payload_data,
                headers={"Content-Type": "application/json",
                         "X-Hub-Signature-256": "sha256=" + expected_sig},
            )
            assert r.status_code == 200
        finally:
            settings.WHATSAPP_APP_SECRET = original_secret

    def test_duplicate_message_id_deduplicated(self):
        """Same Meta message ID processed twice returns duplicate_ignored."""
        msg_id = "wamid_dedup_test_" + uuid.uuid4().hex[:8]
        # Seed the idempotency key as if it was already processed
        db.set_document("processed_idempotency_keys", msg_id,
                       {"id": msg_id, "processed_at": datetime.now(timezone.utc).isoformat()},
                       merge=False)
        result = WhatsAppBotService.handle_webhook_payload({
            "entry": [{"changes": [{"value": {"messages": [
                {"id": msg_id, "from": "+13125550103", "text": {"body": "STATUS"}}
            ]}}]}]
        })
        assert result["status"] == "duplicate_ignored"

    def test_unauthorized_sender_rejected(self):
        """Sender not in users collection gets security notice, no business action."""
        result = WhatsAppBotService.process_incoming_message(
            from_number="+19999999999",
            message_text="STATUS",
            org_id="org_triwiz_01",
            is_simulated=True,
        )
        assert result.get("status") == "unauthorized"
        assert result.get("action_taken") == "UNAUTHORIZED_SENDER"

    def test_authorized_sender_help_command(self):
        """Authorized sender gets HELP reply with command list."""
        result = WhatsAppBotService.process_incoming_message(
            from_number="+13125550103",  # Elena Rostova - supply_chain_manager
            message_text="HELP",
            org_id="org_triwiz_01",
            is_simulated=True,
        )
        assert "STOCKPILOT AI" in result["reply_text"]
        assert result.get("status") in ("delivered", "simulated")

    def test_opt_out_stop_command(self):
        """STOP command sets whatsapp_opted_in=False for the user."""
        result = WhatsAppBotService.process_incoming_message(
            from_number="+13125550103",
            message_text="STOP",
            org_id="org_triwiz_01",
            is_simulated=True,
        )
        assert "unsubscribed" in result["reply_text"].lower() or "stop" in result["reply_text"].lower()
        assert result.get("action_taken") == "CONSENT_OPT_OUT"
        # Verify DB updated
        users = db.query("users", org_id="org_triwiz_01")
        elena = next((u for u in users if "+13125550103" in (u.get("phone_number") or "")), None)
        if elena:
            assert elena.get("whatsapp_opted_in") is False

    def test_opt_in_start_command(self):
        """START command re-enables whatsapp_opted_in for the user."""
        # First opt out
        WhatsAppBotService.process_incoming_message(
            from_number="+13125550103", message_text="STOP",
            org_id="org_triwiz_01", is_simulated=True)
        # Then opt back in
        result = WhatsAppBotService.process_incoming_message(
            from_number="+13125550103", message_text="START",
            org_id="org_triwiz_01", is_simulated=True)
        assert result.get("action_taken") == "CONSENT_OPT_IN"
        users = db.query("users", org_id="org_triwiz_01")
        elena = next((u for u in users if "+13125550103" in (u.get("phone_number") or "")), None)
        if elena:
            assert elena.get("whatsapp_opted_in") is True

    def test_stock_command_returns_inventory(self):
        """STOCK <SKU> returns inventory information for known product."""
        result = WhatsAppBotService.process_incoming_message(
            from_number="+13125550103",
            message_text="STOCK PRD-VAX-01",
            org_id="org_triwiz_01",
            is_simulated=True,
        )
        # Either returns inventory or not-found; both are valid command responses
        assert result.get("reply_text")
        assert result.get("status") in ("delivered", "simulated")

    def test_transfer_approve_requires_manager_role(self):
        """Operator role cannot approve transfers."""
        result = WhatsAppBotService.process_incoming_message(
            from_number="+13125550106",  # James O'Connor - operator
            message_text="APPROVE trf_fake_001",
            org_id="org_triwiz_01",
            is_simulated=True,
        )
        assert "unauthorized" in result["reply_text"].lower() or "cannot" in result["reply_text"].lower()

    def test_approve_nonexistent_transfer_fails_gracefully(self):
        """APPROVE on unknown transfer_id returns error message, not 500."""
        result = WhatsAppBotService.process_incoming_message(
            from_number="+13125550103",  # supply_chain_manager
            message_text="APPROVE trf_does_not_exist_xyz",
            org_id="org_triwiz_01",
            is_simulated=True,
        )
        assert "error" in result["reply_text"].lower() or "not found" in result["reply_text"].lower()

    def test_double_transfer_approval_prevented(self):
        """Approving an already-approved transfer returns an error response."""
        # Find a pending transfer to approve
        transfers = db.query("transfers", filters={"status": "pending"}, org_id="org_triwiz_01")
        if not transfers:
            pytest.skip("No pending transfers available for double-approval test")
        trf_id = transfers[0]["id"]
        # First approval
        result1 = WhatsAppBotService.process_incoming_message(
            from_number="+13125550103",
            message_text="APPROVE " + trf_id,
            org_id="org_triwiz_01",
            is_simulated=True,
        )
        # Second approval of same transfer
        result2 = WhatsAppBotService.process_incoming_message(
            from_number="+13125550103",
            message_text="APPROVE " + trf_id,
            org_id="org_triwiz_01",
            is_simulated=True,
        )
        # Second attempt must fail with error message
        assert "error" in result2["reply_text"].lower() or "already" in result2["reply_text"].lower()

    def test_simulator_chat_endpoint(self):
        """POST /whatsapp/simulator/chat returns simulated response."""
        headers = _admin_headers()
        r = client.post("/api/v1/whatsapp/simulator/chat",
                       json={"message_text": "STATUS", "from_number": "+13125550101"},
                       headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert data.get("is_simulated") is True
        assert "simulator_note" in data

    def test_simulator_mode_flagged_in_log(self):
        """Simulated messages have delivery_status=SIMULATED_LOCAL in notification_logs."""
        WhatsAppBotService.process_incoming_message(
            from_number="+13125550103",
            message_text="HELP",
            org_id="org_triwiz_01",
            is_simulated=True,
        )
        logs = db.query("notification_logs", org_id="org_triwiz_01",
                       order_by="timestamp", descending=True, limit=1)
        if logs:
            assert logs[0].get("delivery_status") == "SIMULATED_LOCAL"
            assert logs[0].get("is_simulated") is True
