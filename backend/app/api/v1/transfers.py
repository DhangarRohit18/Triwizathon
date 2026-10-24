import uuid
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.core.database import db
from app.models.domain import InterWarehouseTransfer, TransferItem, TransferStatus, TransferApprovalRequest
from app.api.deps import get_current_user, require_roles
from app.services.inventory_service import InventoryService
from app.services.audit_service import AuditService

router = APIRouter(prefix="/transfers", tags=["Inter-Warehouse Transfers"])

@router.get("", response_model=List[Dict[str, Any]])
def list_transfers(current_user: dict = Depends(get_current_user)):
    org_id = current_user["org_id"]
    transfers = db.query("transfers", org_id=org_id, order_by="created_at", descending=True)

    enriched = []
    for t in transfers:
        src = db.get_document("warehouses", t["source_warehouse_id"])
        dst = db.get_document("warehouses", t["target_warehouse_id"])
        
        # Enrich item details
        items_enriched = []
        for itm in t.get("items", []):
            prd = db.get_document("products", itm["product_id"])
            items_enriched.append({
                **itm,
                "product_name": prd["name"] if prd else itm["product_id"],
                "product_sku": prd["sku"] if prd else "",
            })

        enriched.append({
            **t,
            "source_warehouse_name": src["name"] if src else t["source_warehouse_id"],
            "target_warehouse_name": dst["name"] if dst else t["target_warehouse_id"],
            "items": items_enriched
        })
    return enriched

class CreateTransferRequest(BaseModel):
    source_warehouse_id: str
    target_warehouse_id: str
    items: List[TransferItem]
    notes: Optional[str] = ""

@router.post("", response_model=InterWarehouseTransfer)
def create_transfer(
    req: CreateTransferRequest,
    current_user: dict = Depends(get_current_user)
):
    if req.source_warehouse_id == req.target_warehouse_id:
        raise HTTPException(status_code=400, detail="Source and target warehouse cannot be identical.")

    org_id = current_user["org_id"]
    now_iso = datetime.now(timezone.utc).isoformat()
    t_id = f"trf_{uuid.uuid4().hex[:10]}"
    trf_num = f"TRF-{datetime.now().strftime('%Y')}-{uuid.uuid4().hex[:4].upper()}"

    # Calculate estimated freight cost
    src = db.get_document("warehouses", req.source_warehouse_id)
    dst = db.get_document("warehouses", req.target_warehouse_id)
    est_cost = 250.0  # Base freight baseline
    if src and dst:
        from app.services.optimizer_engine import haversine_distance_km
        dist = haversine_distance_km(src["lat"], src["lng"], dst["lat"], dst["lng"])
        total_units = sum(i.quantity for i in req.items)
        est_cost = round(dist * 0.45 + total_units * 0.12, 2)

    trf_doc = {
        "id": t_id,
        "org_id": org_id,
        "transfer_number": trf_num,
        "source_warehouse_id": req.source_warehouse_id,
        "target_warehouse_id": req.target_warehouse_id,
        "items": [i.model_dump() for i in req.items],
        "status": TransferStatus.PENDING.value,
        "requested_by_id": current_user["id"],
        "requested_by_name": current_user["full_name"],
        "approved_by_id": None,
        "approved_by_name": None,
        "estimated_transport_cost": est_cost,
        "notes": req.notes,
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    db.set_document("transfers", t_id, trf_doc)

    AuditService.log_event(
        org_id=org_id,
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
        actor_role=current_user["role"],
        action="TRANSFER_REQUESTED",
        target_entity="transfer",
        entity_id=t_id,
        details={"transfer_number": trf_num, "source": req.source_warehouse_id, "target": req.target_warehouse_id}
    )

    return InterWarehouseTransfer(**trf_doc)

@router.post("/approve")
def approve_or_reject_transfer(
    req: TransferApprovalRequest,
    current_user: dict = Depends(require_roles(["super_admin", "org_admin", "supply_chain_manager", "warehouse_manager"]))
):
    res = InventoryService.approve_or_reject_transfer(
        transfer_id=req.transfer_id,
        approved=req.approved,
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
        org_id=current_user["org_id"],
        notes=req.notes or ""
    )

    AuditService.log_event(
        org_id=current_user["org_id"],
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
        actor_role=current_user["role"],
        action="TRANSFER_STATUS_MODIFIED",
        target_entity="transfer",
        entity_id=req.transfer_id,
        details={"approved": req.approved, "notes": req.notes}
    )

    return {"success": True, "transfer": res}
