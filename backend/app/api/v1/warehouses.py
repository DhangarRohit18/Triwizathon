from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from app.core.database import db
from app.core.security import ROLE_SUPER_ADMIN
from app.core.permissions import (
    PERM_WAREHOUSES_MANAGE,
    get_authorized_warehouses,
    user_has_permission
)
from app.models.domain import Warehouse, Destination
from app.api.deps import get_current_user, require_permission
from app.services.audit_service import AuditService

router = APIRouter(prefix="/warehouses", tags=["Warehouses & Network"])

@router.get("", response_model=List[Warehouse])
def list_warehouses(current_user: dict = Depends(get_current_user)):
    org_id = current_user["org_id"] if current_user.get("role") != ROLE_SUPER_ADMIN else None
    warehouses = db.query("warehouses", org_id=org_id)
    
    # Location-scoping: filter if user is restricted to specific warehouse(s)
    allowed = get_authorized_warehouses(current_user)
    if allowed is not None:
        warehouses = [w for w in warehouses if w["id"] in allowed]

    return [Warehouse(**w) for w in warehouses]

@router.get("/destinations", response_model=List[Destination])
def list_destinations(current_user: dict = Depends(get_current_user)):
    org_id = current_user["org_id"] if current_user.get("role") != ROLE_SUPER_ADMIN else None
    destinations = db.query("destinations", org_id=org_id)
    return [Destination(**d) for d in destinations]

class WarehouseCreateRequest(BaseModel):
    code: str
    name: str
    address: str
    city: str
    state: str
    lat: float
    lng: float
    capacity_pallets: int
    cold_storage_capacity: int = 0
    operating_cost_per_pallet: float = 1.25

@router.post("", response_model=Warehouse)
def create_warehouse(
    req: WarehouseCreateRequest,
    current_user: dict = Depends(require_permission(PERM_WAREHOUSES_MANAGE))
):
    wh_id = f"wh_{req.city.lower().replace(' ', '_')}_{req.code.lower()}"
    new_wh = {
        "id": wh_id,
        "org_id": current_user["org_id"],
        "code": req.code,
        "name": req.name,
        "address": req.address,
        "city": req.city,
        "state": req.state,
        "lat": req.lat,
        "lng": req.lng,
        "capacity_pallets": req.capacity_pallets,
        "used_pallets": 0,
        "cold_storage_capacity": req.cold_storage_capacity,
        "is_operational": True,
        "operating_cost_per_pallet": req.operating_cost_per_pallet
    }
    db.set_document("warehouses", wh_id, new_wh)

    AuditService.log_event(
        org_id=current_user["org_id"],
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
        actor_role=current_user["role"],
        action="WAREHOUSE_CREATED",
        target_entity="warehouse",
        entity_id=wh_id,
        details={"name": req.name, "code": req.code}
    )

    return Warehouse(**new_wh)

@router.post("/{warehouse_id}/toggle-operational", response_model=Warehouse)
def toggle_operational_status(
    warehouse_id: str,
    current_user: dict = Depends(require_permission(PERM_WAREHOUSES_MANAGE))
):
    """
    Toggles warehouse operational status to simulate disruptions (e.g. blizzard, power outage, strike).
    Requires 'warehouses.manage' permission.
    """
    wh = db.get_document("warehouses", warehouse_id)
    if not wh or (current_user.get("role") != ROLE_SUPER_ADMIN and wh.get("org_id") != current_user["org_id"]):
        raise HTTPException(status_code=404, detail="Warehouse not found.")

    wh["is_operational"] = not wh.get("is_operational", True)
    db.set_document("warehouses", warehouse_id, wh)

    AuditService.log_event(
        org_id=current_user["org_id"],
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
        actor_role=current_user["role"],
        action="WAREHOUSE_STATUS_TOGGLED",
        target_entity="warehouse",
        entity_id=warehouse_id,
        details={"is_operational": wh["is_operational"]}
    )

    return Warehouse(**wh)
