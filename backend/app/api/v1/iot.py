from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Header, Query
from pydantic import BaseModel
from app.core.config import settings
from app.core.database import db
from app.models.domain import IoTDevice, SensorReading, IoTAlert
from app.api.deps import get_current_user
from app.services.iot_service import IoTTelemetryService
from app.services.audit_service import AuditService

router = APIRouter(prefix="/iot", tags=["IoT Telemetry & Cold-Chain Monitoring"])

class TelemetryPayload(BaseModel):
    device_id: str
    temperature_c: float
    humidity_percent: float
    battery_level_percent: Optional[float] = 98.0
    door_open: Optional[bool] = False
    data_source: Optional[str] = "ESP32_SECURE_HARDWARE"

@router.post("/telemetry")
def ingest_esp32_telemetry(
    payload: TelemetryPayload,
    x_iot_key: Optional[str] = Header(None, alias="X-IoT-Key"),
    api_key: Optional[str] = Query(None)
):
    """
    Authenticated telemetry ingestion endpoint for physical ESP32 microcontrollers.
    Validates X-IoT-Key header or query parameter against settings.IOT_API_KEY.
    """
    key = x_iot_key or api_key or ""
    res = IoTTelemetryService.ingest_reading(
        payload=payload.model_dump(),
        auth_api_key=key,
        expected_api_key=settings.IOT_API_KEY
    )
    return res

@router.post("/simulator/inject")
def inject_simulator_telemetry(
    payload: TelemetryPayload,
    current_user: dict = Depends(get_current_user)
):
    """
    Interactive hardware simulator endpoint: allows testing storage condition fluctuations,
    temperature excursions, and door openings from the UI.
    """
    data = payload.model_dump()
    data["data_source"] = f"SIMULATOR_TRIGGERED_BY_{current_user['full_name'].upper()}"
    res = IoTTelemetryService.ingest_reading(
        payload=data,
        auth_api_key=settings.IOT_API_KEY,
        expected_api_key=settings.IOT_API_KEY
    )
    return res

@router.get("/devices", response_model=List[Dict[str, Any]])
def list_iot_devices(current_user: dict = Depends(get_current_user)):
    org_id = current_user["org_id"]
    devices = db.query("iot_devices", org_id=org_id)
    enriched = []
    for d in devices:
        wh = db.get_document("warehouses", d["warehouse_id"])
        enriched.append({
            **d,
            "warehouse_name": wh["name"] if wh else d["warehouse_id"]
        })
    return enriched

@router.get("/readings", response_model=List[Dict[str, Any]])
def get_sensor_readings(
    device_id: Optional[str] = Query(None),
    limit: int = Query(48, le=100),
    current_user: dict = Depends(get_current_user)
):
    org_id = current_user["org_id"]
    filters = {}
    if device_id:
        filters["device_id"] = device_id
    readings = db.query("sensor_readings", filters=filters, org_id=org_id, order_by="timestamp", descending=True, limit=limit)
    # Return chronologically ascending for charts
    return list(reversed(readings))

@router.get("/alerts", response_model=List[Dict[str, Any]])
def list_iot_alerts(
    acknowledged: Optional[bool] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    org_id = current_user["org_id"]
    filters = {}
    if acknowledged is not None:
        filters["acknowledged"] = acknowledged
    alerts = db.query("alerts", filters=filters, org_id=org_id, order_by="timestamp", descending=True)
    return alerts

@router.post("/alerts/{alert_id}/acknowledge")
def acknowledge_iot_alert(
    alert_id: str,
    current_user: dict = Depends(get_current_user)
):
    res = IoTTelemetryService.acknowledge_alert(
        alert_id=alert_id,
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
        details={"message": res.get("message")}
    )
    return {"success": True, "alert": res}
