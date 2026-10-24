import uuid
import hashlib
import secrets
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional
from fastapi import HTTPException, status
from app.core.database import db

CLOCK_DRIFT_FUTURE_SECONDS = 5 * 60
STALE_READING_SECONDS = 7 * 24 * 3600
TEMP_MIN_SANITY = -100.0
TEMP_MAX_SANITY = 80.0
HUMIDITY_MIN_SANITY = 0.0
HUMIDITY_MAX_SANITY = 100.0
VALID_TEMP_UNITS = {"C", "F"}
LOW_BATTERY_THRESHOLD = 15.0


class IoTTelemetryService:

    @classmethod
    def register_device(cls, device_id, org_id, warehouse_id, storage_zone,
                        device_type="ESP32_COLD_CHAIN", temp_min_threshold=2.0,
                        temp_max_threshold=8.0, humidity_max_threshold=65.0,
                        reporting_interval_sec=300, actor_id="system", actor_name="System"):
        existing = db.get_document("iot_devices", device_id)
        if existing:
            raise HTTPException(status_code=409, detail="Device already registered.")
        warehouse = db.get_document("warehouses", warehouse_id)
        if not warehouse or warehouse.get("org_id") != org_id:
            raise HTTPException(status_code=400, detail="Warehouse not found or not in org.")
        device_api_key = "iotk_" + secrets.token_urlsafe(32)
        key_hash = hashlib.sha256(device_api_key.encode()).hexdigest()
        now_iso = datetime.now(timezone.utc).isoformat()
        record = {"id": device_id, "org_id": org_id, "warehouse_id": warehouse_id,
                  "storage_zone": storage_zone, "device_type": device_type,
                  "temp_min_threshold": temp_min_threshold, "temp_max_threshold": temp_max_threshold,
                  "humidity_max_threshold": humidity_max_threshold,
                  "reporting_interval_sec": reporting_interval_sec,
                  "api_key_hash": key_hash, "is_online": False, "last_ping": None,
                  "current_temp": None, "current_humidity": None, "battery_level_percent": None,
                  "rssi_dbm": None, "boot_count": 0, "health_status": "unknown",
                  "registered_by": actor_id, "registered_at": now_iso}
        db.set_document("iot_devices", device_id, record, merge=False)
        return {**record, "device_api_key": device_api_key}

    @classmethod
    def update_device_config(cls, device_id, org_id, updates, actor_id, actor_name):
        device = db.get_document("iot_devices", device_id)
        if not device or device.get("org_id") != org_id:
            raise HTTPException(status_code=404, detail="Device not found.")
        allowed_keys = {"temp_min_threshold", "temp_max_threshold", "humidity_max_threshold",
                        "reporting_interval_sec", "storage_zone"}
        filtered = {k: v for k, v in updates.items() if k in allowed_keys}
        if not filtered:
            raise HTTPException(status_code=400, detail="No valid config fields supplied.")
        db.set_document("iot_devices", device_id, filtered)
        return db.get_document("iot_devices", device_id)

    @classmethod
    def ingest_reading(cls, payload, auth_api_key, expected_api_key):
        device_id = payload.get("device_id")
        if not device_id:
            raise HTTPException(status_code=400, detail="Missing device_id.")
        device = db.get_document("iot_devices", device_id)
        if not device:
            raise HTTPException(status_code=403, detail="Device not registered.")
        key_hash = hashlib.sha256(auth_api_key.encode()).hexdigest()
        if key_hash != device.get("api_key_hash", "") and auth_api_key != expected_api_key:
            raise HTTPException(status_code=401, detail="Invalid IoT Device Authentication Key.")
        auth_org_id = device["org_id"]
        auth_warehouse_id = device["warehouse_id"]
        storage_zone = device.get("storage_zone", "Unknown Zone")
        location_mismatch = False
        supplied_org = payload.get("supplied_org_id") or payload.get("org_id")
        supplied_wh = payload.get("supplied_warehouse_id") or payload.get("warehouse_id")
        if supplied_org and supplied_org != auth_org_id:
            location_mismatch = True
        if supplied_wh and supplied_wh != auth_warehouse_id:
            location_mismatch = True
        now_utc = datetime.now(timezone.utc)
        now_iso = now_utc.isoformat()
        reading_ts = now_iso
        raw_ts = payload.get("timestamp")
        if raw_ts:
            try:
                if isinstance(raw_ts, str):
                    ts_dt = datetime.fromisoformat(raw_ts.replace("Z", "+00:00"))
                    if ts_dt.tzinfo is None:
                        ts_dt = ts_dt.replace(tzinfo=timezone.utc)
                elif isinstance(raw_ts, (int, float)):
                    ts_dt = datetime.fromtimestamp(raw_ts, tz=timezone.utc)
                else:
                    raise ValueError("Unsupported timestamp type")
                delta_sec = (ts_dt - now_utc).total_seconds()
                if delta_sec > CLOCK_DRIFT_FUTURE_SECONDS:
                    raise HTTPException(status_code=400,
                        detail="Timestamp too far in future (>{} s). Check device clock.".format(CLOCK_DRIFT_FUTURE_SECONDS))
                age_sec = (now_utc - ts_dt).total_seconds()
                if age_sec > STALE_READING_SECONDS:
                    raise HTTPException(status_code=400,
                        detail="Stale timestamp: {:.1f}h old (limit {}h).".format(age_sec/3600, STALE_READING_SECONDS//3600))
                reading_ts = ts_dt.isoformat()
            except HTTPException:
                raise
            except Exception as exc:
                raise HTTPException(status_code=400, detail="Invalid timestamp: {}".format(exc))
        temp_unit = (payload.get("temperature_unit") or "C").strip().upper()
        if temp_unit not in VALID_TEMP_UNITS:
            raise HTTPException(status_code=400,
                detail="Invalid temperature_unit='{}'. Accepted: C or F.".format(temp_unit))
        raw_temp = float(payload.get("temperature_c") or payload.get("temperature") or 0.0)
        temp_c = (raw_temp - 32.0) * 5.0 / 9.0 if temp_unit == "F" else raw_temp
        hum = float(payload.get("humidity_percent") or 0.0)
        battery = float(payload.get("battery_level_percent") or 100.0)
        door_open = bool(payload.get("door_open", False))
        rssi_dbm = payload.get("rssi_dbm")
        boot_count = int(payload.get("boot_count") or device.get("boot_count") or 0)
        is_valid = (TEMP_MIN_SANITY <= temp_c <= TEMP_MAX_SANITY) and (HUMIDITY_MIN_SANITY <= hum <= HUMIDITY_MAX_SANITY)
        is_simulated = bool(payload.get("is_simulated", False)) or "SIMULATOR" in str(payload.get("data_source", "")).upper()
        data_source = payload.get("data_source", "ESP32_HARDWARE")
        if is_simulated and "SIMULATOR" not in data_source.upper():
            data_source = "SIMULATOR_" + data_source
        reading_id = "read_" + uuid.uuid4().hex[:14]
        reading = {"id": reading_id, "device_id": device_id, "org_id": auth_org_id,
                   "warehouse_id": auth_warehouse_id, "storage_zone": storage_zone,
                   "timestamp": reading_ts, "server_received_at": now_iso,
                   "temperature_c": round(temp_c, 3), "temperature_unit_received": temp_unit,
                   "humidity_percent": hum, "battery_level_percent": battery,
                   "door_open": door_open, "rssi_dbm": rssi_dbm, "boot_count": boot_count,
                   "is_valid": is_valid, "location_mismatch_detected": location_mismatch,
                   "is_simulated": is_simulated, "data_source": data_source}
        db.set_document("sensor_readings", reading_id, reading, merge=False)
        health_status = "low_battery" if battery < LOW_BATTERY_THRESHOLD else ("sensor_fault" if not is_valid else "healthy")
        db.set_document("iot_devices", device_id, {
            "last_ping": now_iso, "is_online": True, "current_temp": round(temp_c, 3),
            "current_humidity": hum, "battery_level_percent": battery, "rssi_dbm": rssi_dbm,
            "boot_count": boot_count, "health_status": health_status})
        if is_valid:
            cls._update_aggregate(auth_org_id, auth_warehouse_id, device_id, storage_zone, temp_c, hum, now_utc)
        alerts_triggered = []
        if is_valid:
            min_thresh = device.get("temp_min_threshold", 2.0)
            max_thresh = device.get("temp_max_threshold", 8.0)
            max_hum = device.get("humidity_max_threshold", 65.0)
            if temp_c < min_thresh or temp_c > max_thresh:
                sev = "critical" if (temp_c > max_thresh + 4.0 or temp_c < min_thresh - 5.0) else "warning"
                alerts_triggered.append(cls._create_alert(auth_org_id, auth_warehouse_id, device_id,
                    storage_zone, "temp_excursion", sev,
                    "Temperature breach in {}: {:.1f}C (Threshold: {}-{})".format(storage_zone, temp_c, min_thresh, max_thresh),
                    temp_c, max_thresh if temp_c > max_thresh else min_thresh, now_iso))
            if hum > max_hum:
                alerts_triggered.append(cls._create_alert(auth_org_id, auth_warehouse_id, device_id,
                    storage_zone, "humidity_breach", "warning",
                    "High humidity in {}: {:.1f}% (Limit: {:.1f}%)".format(storage_zone, hum, max_hum),
                    hum, max_hum, now_iso))
            if door_open:
                alerts_triggered.append(cls._create_alert(auth_org_id, auth_warehouse_id, device_id,
                    storage_zone, "door_ajar", "warning",
                    "Storage bay door left open in {}!".format(storage_zone), 1.0, 0.0, now_iso))
            if battery < LOW_BATTERY_THRESHOLD:
                alerts_triggered.append(cls._create_alert(auth_org_id, auth_warehouse_id, device_id,
                    storage_zone, "low_battery", "warning",
                    "Device {} battery low: {:.0f}%".format(device_id, battery),
                    battery, LOW_BATTERY_THRESHOLD, now_iso))
        return {"status": "ingested", "reading_id": reading_id, "device_id": device_id,
                "warehouse_id": auth_warehouse_id, "temperature_c_stored": round(temp_c, 3),
                "temperature_unit_received": temp_unit, "server_received_at": now_iso,
                "is_valid": is_valid, "is_simulated": is_simulated,
                "location_mismatch_detected": location_mismatch,
                "alerts_triggered_count": len(alerts_triggered),
                "alerts_triggered": alerts_triggered}

    @classmethod
    def _update_aggregate(cls, org_id, warehouse_id, device_id, storage_zone, temp_c, hum, ts):
        hour_key = ts.strftime("%Y-%m-%dT%H")
        agg_id = device_id + "_" + hour_key
        ex = db.get_document("iot_aggregates", agg_id) or {}
        n = ex.get("sample_count", 0)
        new_n = n + 1
        sum_t = ex.get("sum_temp_c", 0.0) + temp_c
        sum_h = ex.get("sum_humidity", 0.0) + hum
        db.set_document("iot_aggregates", agg_id, {
            "id": agg_id, "org_id": org_id, "warehouse_id": warehouse_id,
            "device_id": device_id, "storage_zone": storage_zone, "hour_bucket": hour_key,
            "sample_count": new_n, "sum_temp_c": sum_t, "sum_humidity": sum_h,
            "avg_temp_c": round(sum_t / new_n, 3), "avg_humidity": round(sum_h / new_n, 3),
            "min_temp_c": min(ex.get("min_temp_c", temp_c), temp_c),
            "max_temp_c": max(ex.get("max_temp_c", temp_c), temp_c),
            "last_updated": datetime.now(timezone.utc).isoformat()})

    @staticmethod
    def _create_alert(org_id, warehouse_id, device_id, storage_zone, alert_type, severity,
                      message, reading_value, threshold_value, now_iso):
        alert_id = "alt_" + uuid.uuid4().hex[:12]
        alert = {"id": alert_id, "org_id": org_id, "warehouse_id": warehouse_id,
                 "device_id": device_id, "storage_zone": storage_zone,
                 "alert_type": alert_type, "severity": severity, "message": message,
                 "reading_value": reading_value, "threshold_value": threshold_value,
                 "timestamp": now_iso, "acknowledged": False,
                 "acknowledged_by": None, "acknowledged_at": None}
        db.set_document("alerts", alert_id, alert, merge=False)
        return alert

    @classmethod
    def get_device_readings(cls, device_id, org_id, granularity="raw", limit=48):
        device = db.get_document("iot_devices", device_id)
        if not device or device.get("org_id") != org_id:
            raise HTTPException(status_code=404, detail="Device not found.")
        if granularity == "hourly":
            aggs = db.query("iot_aggregates", filters={"device_id": device_id}, org_id=org_id,
                           order_by="hour_bucket", descending=True, limit=limit)
            return list(reversed(aggs))
        readings = db.query("sensor_readings", filters={"device_id": device_id}, org_id=org_id,
                           order_by="timestamp", descending=True, limit=limit)
        return list(reversed(readings))

    @classmethod
    def acknowledge_alert(cls, alert_id, actor_id, actor_name, org_id):
        alert = db.get_document("alerts", alert_id)
        if not alert or alert.get("org_id") != org_id:
            raise HTTPException(status_code=404, detail="Alert not found.")
        if alert.get("acknowledged"):
            raise HTTPException(status_code=409,
                detail="Alert {} already acknowledged by '{}'.".format(alert_id, alert.get("acknowledged_by")))
        db.set_document("alerts", alert_id, {"acknowledged": True, "acknowledged_by": actor_name,
            "acknowledged_by_id": actor_id, "acknowledged_at": datetime.now(timezone.utc).isoformat()})
        return db.get_document("alerts", alert_id)

    @classmethod
    def prune_and_aggregate_telemetry(cls, org_id, retain_raw_days=7, retain_hourly_days=90):
        now_utc = datetime.now(timezone.utc)
        raw_cutoff = (now_utc - timedelta(days=retain_raw_days)).isoformat()
        hourly_cutoff = (now_utc - timedelta(days=retain_hourly_days)).strftime("%Y-%m-%dT%H")
        pruned_readings = 0
        pruned_aggregates = 0
        for r in db.query("sensor_readings", org_id=org_id):
            if r.get("timestamp", "") < raw_cutoff:
                db.delete_document("sensor_readings", r["id"])
                pruned_readings += 1
        for a in db.query("iot_aggregates", org_id=org_id):
            if a.get("hour_bucket", "") < hourly_cutoff:
                db.delete_document("iot_aggregates", a["id"])
                pruned_aggregates += 1
        return {"status": "pruned", "org_id": org_id, "pruned_raw_readings": pruned_readings,
                "pruned_hourly_aggregates": pruned_aggregates, "raw_cutoff_iso": raw_cutoff,
                "hourly_cutoff_bucket": hourly_cutoff}
