import uuid
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from fastapi import HTTPException, status
from app.core.database import db
from app.models.domain import SensorReading, IoTDevice, IoTAlert

class IoTTelemetryService:
    """
    Authenticated IoT Ingestion Engine for ESP32 and Cold-Chain Sensors.
    Validates device authorization, detects excursions, creates alerts,
    and manages device health telemetry.
    """

    @classmethod
    def ingest_reading(
        cls,
        payload: Dict[str, Any],
        auth_api_key: str,
        expected_api_key: str
    ) -> Dict[str, Any]:
        # Authenticate IoT gateway / device key
        if auth_api_key != expected_api_key:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid IoT Device Authentication Key."
            )

        device_id = payload.get("device_id")
        if not device_id:
            raise HTTPException(status_code=400, detail="Missing device_id in telemetry payload.")

        # 1. Authorize device registration in database
        device = db.get_document("iot_devices", device_id)
        if not device:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Device '{device_id}' is not registered or authorized to transmit telemetry."
            )

        # Securely bind organization and warehouse to verified device record
        org_id = device["org_id"]
        warehouse_id = device["warehouse_id"]
        storage_zone = device["storage_zone"]

        now_iso = datetime.now(timezone.utc).isoformat()
        temp = float(payload.get("temperature_c", 0.0))
        hum = float(payload.get("humidity_percent", 0.0))
        battery = float(payload.get("battery_level_percent", 100.0))
        door_open = bool(payload.get("door_open", False))

        # Check physical sensor validity (sanity bounds: e.g. -100C to +80C)
        is_valid = (-100.0 <= temp <= 80.0) and (0.0 <= hum <= 100.0)

        reading_id = f"read_{uuid.uuid4().hex[:12]}"
        reading = {
            "id": reading_id,
            "device_id": device_id,
            "org_id": org_id,
            "warehouse_id": warehouse_id,
            "storage_zone": storage_zone,
            "timestamp": payload.get("timestamp") or now_iso,
            "temperature_c": temp,
            "humidity_percent": hum,
            "battery_level_percent": battery,
            "door_open": door_open,
            "is_valid": is_valid,
            "data_source": payload.get("data_source", "ESP32_HARDWARE_OR_SIMULATOR")
        }
        db.set_document("sensor_readings", reading_id, reading)

        # 2. Update device status
        device["last_ping"] = now_iso
        device["is_online"] = True
        device["current_temp"] = temp
        device["current_humidity"] = hum
        db.set_document("iot_devices", device_id, device)

        # 3. Cold-Chain Excursion and Alert Detection
        alerts_triggered = []
        min_thresh = device.get("temp_min_threshold", 2.0)
        max_thresh = device.get("temp_max_threshold", 8.0)
        max_hum = device.get("humidity_max_threshold", 65.0)

        if is_valid:
            if temp < min_thresh or temp > max_thresh:
                severity = "critical" if (temp > max_thresh + 4.0 or temp < min_thresh - 5.0) else "warning"
                alert_id = f"alt_{uuid.uuid4().hex[:10]}"
                alert = {
                    "id": alert_id,
                    "org_id": org_id,
                    "warehouse_id": warehouse_id,
                    "device_id": device_id,
                    "alert_type": "temp_excursion",
                    "severity": severity,
                    "message": f"Temperature breach in {storage_zone}: {temp:.1f}°C (Threshold: {min_thresh}°C - {max_thresh}°C)",
                    "reading_value": temp,
                    "threshold_value": max_thresh if temp > max_thresh else min_thresh,
                    "timestamp": now_iso,
                    "acknowledged": False,
                    "acknowledged_by": None
                }
                db.set_document("alerts", alert_id, alert)
                alerts_triggered.append(alert)

            if hum > max_hum:
                alert_id = f"alt_{uuid.uuid4().hex[:10]}"
                alert = {
                    "id": alert_id,
                    "org_id": org_id,
                    "warehouse_id": warehouse_id,
                    "device_id": device_id,
                    "alert_type": "humidity_breach",
                    "severity": "warning",
                    "message": f"High humidity in {storage_zone}: {hum:.1f}% (Limit: {max_hum:.1f}%)",
                    "reading_value": hum,
                    "threshold_value": max_hum,
                    "timestamp": now_iso,
                    "acknowledged": False,
                    "acknowledged_by": None
                }
                db.set_document("alerts", alert_id, alert)
                alerts_triggered.append(alert)

            if door_open:
                alert_id = f"alt_{uuid.uuid4().hex[:10]}"
                alert = {
                    "id": alert_id,
                    "org_id": org_id,
                    "warehouse_id": warehouse_id,
                    "device_id": device_id,
                    "alert_type": "door_ajar",
                    "severity": "warning",
                    "message": f"Storage bay door left open in {storage_zone}!",
                    "reading_value": 1.0,
                    "threshold_value": 0.0,
                    "timestamp": now_iso,
                    "acknowledged": False,
                    "acknowledged_by": None
                }
                db.set_document("alerts", alert_id, alert)
                alerts_triggered.append(alert)

        return {
            "status": "ingested",
            "reading_id": reading_id,
            "device_id": device_id,
            "is_valid": is_valid,
            "alerts_triggered": alerts_triggered
        }

    @classmethod
    def acknowledge_alert(cls, alert_id: str, actor_name: str, org_id: str) -> Dict[str, Any]:
        alert = db.get_document("alerts", alert_id)
        if not alert or alert.get("org_id") != org_id:
            raise HTTPException(status_code=404, detail="Alert not found.")

        alert["acknowledged"] = True
        alert["acknowledged_by"] = actor_name
        alert["acknowledged_at"] = datetime.now(timezone.utc).isoformat()
        db.set_document("alerts", alert_id, alert)
        return alert
