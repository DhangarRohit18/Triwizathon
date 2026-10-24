from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Header, Query, status
from pydantic import BaseModel
from app.core.config import settings
from app.core.database import db
from app.models.domain import IoTDevice, SensorReading, IoTAlert
from app.api.deps import get_current_user, require_permission
from app.core.permissions import (
    PERM_IOT_DEVICES_MANAGE,
    PERM_IOT_READINGS_VIEW,
    PERM_ALERTS_MANAGE,
    get_authorized_warehouses,
    validate_warehouse_access
)
from app.services.iot_service import IoTTelemetryService
from app.services.audit_service import AuditService

router = APIRouter(prefix="/iot", tags=["IoT Telemetry & Cold-Chain Monitoring"])

class DeviceRegistrationRequest(BaseModel):
    device_id: str
    warehouse_id: str
    storage_zone: str
    device_type: str = "ESP32_COLD_CHAIN"
    temp_min_threshold: float = 2.0
    temp_max_threshold: float = 8.0
    humidity_max_threshold: float = 65.0
    reporting_interval_sec: int = 300

class DeviceConfigUpdateRequest(BaseModel):
    temp_min_threshold: Optional[float] = None
    temp_max_threshold: Optional[float] = None
    humidity_max_threshold: Optional[float] = None
    reporting_interval_sec: Optional[int] = None
    storage_zone: Optional[str] = None

class TelemetryPayload(BaseModel):
    device_id: str
    temperature_c: Optional[float] = None
    temperature: Optional[float] = None
    temperature_unit: Optional[str] = "C"
    humidity_percent: Optional[float] = 50.0
    battery_level_percent: Optional[float] = 98.0
    door_open: Optional[bool] = False
    rssi_dbm: Optional[float] = None
    boot_count: Optional[int] = None
    timestamp: Optional[str] = None
    data_source: Optional[str] = "ESP32_SECURE_HARDWARE"
    supplied_org_id: Optional[str] = None
    supplied_warehouse_id: Optional[str] = None

class SimulatorPayload(TelemetryPayload):
    is_simulated: bool = True

class PruneRequest(BaseModel):
    retain_raw_days: int = 7
    retain_hourly_days: int = 90

@router.post("/devices/register", summary="Register a new ESP32 IoT device")
def register_iot_device(
    req: DeviceRegistrationRequest,
    current_user: dict = Depends(require_permission(PERM_IOT_DEVICES_MANAGE))
):
    """
    Registers a new ESP32 device. Requires 'iot.devices.manage' permission.
    Returns the device record AND a one-time device_api_key.
    """
    result = IoTTelemetryService.register_device(
        device_id=req.device_id,
        org_id=current_user["org_id"],
        warehouse_id=req.warehouse_id,
        storage_zone=req.storage_zone,
        device_type=req.device_type,
        temp_min_threshold=req.temp_min_threshold,
        temp_max_threshold=req.temp_max_threshold,
        humidity_max_threshold=req.humidity_max_threshold,
        reporting_interval_sec=req.reporting_interval_sec,
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
    )
    AuditService.log_event(
        org_id=current_user["org_id"],
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
        actor_role=current_user["role"],
        action="IOT_DEVICE_REGISTERED",
        target_entity="iot_device",
        entity_id=req.device_id,
        details={"warehouse_id": req.warehouse_id, "storage_zone": req.storage_zone},
    )
    return result

@router.patch("/devices/{device_id}", summary="Update device thresholds and config")
def update_device_config(
    device_id: str,
    req: DeviceConfigUpdateRequest,
    current_user: dict = Depends(require_permission(PERM_IOT_DEVICES_MANAGE))
):
    updates = req.model_dump(exclude_none=True)
    result = IoTTelemetryService.update_device_config(
        device_id=device_id,
        org_id=current_user["org_id"],
        updates=updates,
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
    )
    AuditService.log_event(
        org_id=current_user["org_id"],
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
        actor_role=current_user["role"],
        action="IOT_DEVICE_CONFIG_UPDATED",
        target_entity="iot_device",
        entity_id=device_id,
        details=updates,
    )
    return result

@router.post("/telemetry", summary="ESP32 hardware ingestion endpoint")
def ingest_telemetry(
    payload: TelemetryPayload,
    x_device_id: Optional[str] = Header(None, alias="X-Device-ID"),
    x_device_api_key: Optional[str] = Header(None, alias="X-Device-API-Key"),
):
    dev_id = x_device_id or payload.device_id
    if not dev_id:
        raise HTTPException(status_code=400, detail="device_id required")
    temp = payload.temperature_c if payload.temperature_c is not None else payload.temperature
    if temp is None:
        raise HTTPException(status_code=400, detail="Temperature reading is required.")
    payload_dict = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
    payload_dict["device_id"] = dev_id
    payload_dict["temperature"] = temp
    payload_dict["temperature_c"] = temp
    return IoTTelemetryService.ingest_reading(
        payload=payload_dict,
        auth_api_key=x_device_api_key or "",
        expected_api_key=settings.IOT_API_KEY
    )

@router.post("/simulator/telemetry", summary="Simulator ingest for demo")
@router.post("/simulator/inject", summary="Simulator inject for demo")
def simulator_telemetry(payload: SimulatorPayload):
    temp = payload.temperature_c if payload.temperature_c is not None else payload.temperature
    if temp is None:
        raise HTTPException(status_code=400, detail="Temperature reading required.")
    payload_dict = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
    payload_dict["temperature"] = temp
    payload_dict["temperature_c"] = temp
    res = IoTTelemetryService.ingest_reading(
        payload=payload_dict,
        auth_api_key=settings.IOT_API_KEY,
        expected_api_key=settings.IOT_API_KEY
    )
    return {**res, "simulator_note": "This reading is SIMULATED and does not represent real hardware telemetry.", "is_simulated": True}

@router.get("/devices", response_model=List[Dict[str, Any]], summary="List registered IoT devices")
def list_iot_devices(current_user: dict = Depends(require_permission(PERM_IOT_READINGS_VIEW))):
    org_id = current_user["org_id"]
    devices = db.query("iot_devices", org_id=org_id)
    
    # Location scoping
    allowed = get_authorized_warehouses(current_user)
    if allowed is not None:
        devices = [d for d in devices if d.get("warehouse_id") in allowed]

    enriched = []
    for d in devices:
        wh = db.get_document("warehouses", d.get("warehouse_id", ""))
        enriched.append({**d, "warehouse_name": wh["name"] if wh else d.get("warehouse_id")})
    return enriched

@router.get("/readings", response_model=List[Dict[str, Any]], summary="Get sensor readings")
def get_sensor_readings(
    device_id: Optional[str] = Query(None),
    granularity: str = Query("raw", description="'raw' or 'hourly'"),
    limit: int = Query(48, le=200),
    current_user: dict = Depends(require_permission(PERM_IOT_READINGS_VIEW))
):
    org_id = current_user["org_id"]
    if device_id:
        dev = db.get_document("iot_devices", device_id)
        if dev:
            validate_warehouse_access(current_user, dev.get("warehouse_id"))
        return IoTTelemetryService.get_device_readings(
            device_id=device_id, org_id=org_id, granularity=granularity, limit=limit)
    
    readings = db.query("sensor_readings", filters={}, org_id=org_id,
                       order_by="timestamp", descending=True, limit=limit)
    
    # Location scoping
    allowed = get_authorized_warehouses(current_user)
    if allowed is not None:
        readings = [r for r in readings if r.get("warehouse_id") in allowed]

    return list(reversed(readings))

@router.get("/alerts", response_model=List[Dict[str, Any]], summary="List IoT alerts")
def list_iot_alerts(
    acknowledged: Optional[bool] = Query(None),
    alert_type: Optional[str] = Query(None),
    current_user: dict = Depends(require_permission(PERM_ALERTS_MANAGE))
):
    org_id = current_user["org_id"]
    filters = {}
    if acknowledged is not None:
        filters["acknowledged"] = acknowledged
    if alert_type:
        filters["alert_type"] = alert_type
    alerts = db.query("alerts", filters=filters, org_id=org_id,
                     order_by="timestamp", descending=True)
    
    # Location scoping: filter alerts by user's assigned warehouse(s)
    allowed = get_authorized_warehouses(current_user)
    if allowed is not None:
        alerts = [a for a in alerts if a.get("warehouse_id") in allowed]

    return alerts

@router.post("/alerts/{alert_id}/acknowledge", summary="Acknowledge an IoT alert")
def acknowledge_iot_alert(
    alert_id: str,
    current_user: dict = Depends(require_permission(PERM_ALERTS_MANAGE))
):
    alert = db.get_document("alerts", alert_id)
    if alert:
        validate_warehouse_access(current_user, alert.get("warehouse_id"))

    res = IoTTelemetryService.acknowledge_alert(
        alert_id=alert_id,
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
        org_id=current_user["org_id"]
    )
    AuditService.log_event(
        org_id=current_user["org_id"],
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
        actor_role=current_user["role"],
        action="ALERT_ACKNOWLEDGED",
        target_entity="alert",
        entity_id=alert_id,
        details={"alert_type": res.get("alert_type"), "message": res.get("message")}
    )
    return {"success": True, "alert": res}

@router.post("/retention/prune-and-aggregate", summary="Prune old telemetry and compact aggregates")
def prune_and_aggregate(
    req: PruneRequest,
    current_user: dict = Depends(require_permission(PERM_IOT_DEVICES_MANAGE))
):
    result = IoTTelemetryService.prune_and_aggregate_telemetry(
        org_id=current_user["org_id"],
        retain_raw_days=req.retain_raw_days,
        retain_hourly_days=req.retain_hourly_days,
    )
    AuditService.log_event(
        org_id=current_user["org_id"],
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
        actor_role=current_user["role"],
        action="IOT_RETENTION_PRUNE",
        target_entity="sensor_readings",
        entity_id="batch",
        details=result
    )
    return result
