from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from app.core.database import db
from app.models.domain import (
    InterWarehouseTransfer,
    TransferItem,
    TransferStatus,
    TransferApprovalRequest,
    TransferDispatchRequest,
    TransferReceiveRequest,
    TransferCancelRequest
)
from app.api.deps import get_current_user, require_permission
from app.core.permissions import (
    PERM_TRANSFERS_VIEW,
    PERM_TRANSFERS_CREATE,
    PERM_TRANSFERS_APPROVE,
    PERM_TRANSFERS_DISPATCH,
    PERM_TRANSFERS_RECEIVE,
    PERM_OPTIMIZATION_APPROVE,
    get_authorized_warehouses,
    validate_warehouse_access,
    normalize_role,
    ROLE_SUPER_ADMIN,
    ROLE_WAREHOUSE_MANAGER,
    ROLE_DISTRIBUTOR
)
from app.services.inventory_service import InventoryService
from app.services.audit_service import AuditService

router = APIRouter(prefix="/transfers", tags=["Inter-Warehouse Transfers"])

@router.get("", response_model=List[Dict[str, Any]])
def list_transfers(current_user: dict = Depends(require_permission(PERM_TRANSFERS_VIEW))):
    org_id = current_user["org_id"]
    transfers = db.query("transfers", org_id=org_id, order_by="created_at", descending=True)

    allowed_warehouses = get_authorized_warehouses(current_user)
    user_role = normalize_role(current_user.get("role"))

    # Location & Assignment Scoping
    scoped_transfers = []
    for t in transfers:
        # Distributor: only view transfers assigned to this distributor
        if user_role == ROLE_DISTRIBUTOR:
            if t.get("assigned_distributor_id") and t.get("assigned_distributor_id") != current_user["id"]:
                continue
            # Also allow if distributor assigned to source or destination warehouse
            if allowed_warehouses and t["source_warehouse_id"] not in allowed_warehouses and t["target_warehouse_id"] not in allowed_warehouses:
                continue

        # Warehouse Manager / Operator: only view transfers originating or ending at their assigned warehouse
        elif allowed_warehouses is not None:
            if t["source_warehouse_id"] not in allowed_warehouses and t["target_warehouse_id"] not in allowed_warehouses:
                continue

        scoped_transfers.append(t)

    enriched = []
    for t in scoped_transfers:
        src = db.get_document("warehouses", t["source_warehouse_id"])
        dst = db.get_document("warehouses", t["target_warehouse_id"])
        
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

@router.get("/{transfer_id}", response_model=Dict[str, Any])
def get_transfer(transfer_id: str, current_user: dict = Depends(require_permission(PERM_TRANSFERS_VIEW))):
    org_id = current_user["org_id"]
    t = db.get_document("transfers", transfer_id)
    if not t or t.get("org_id") != org_id:
        raise HTTPException(status_code=404, detail="Transfer not found.")

    allowed = get_authorized_warehouses(current_user)
    if allowed is not None:
        if t["source_warehouse_id"] not in allowed and t["target_warehouse_id"] not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Location access denied. Transfer is outside your authorized warehouse scope."
            )

    src = db.get_document("warehouses", t["source_warehouse_id"])
    dst = db.get_document("warehouses", t["target_warehouse_id"])
    items_enriched = []
    for itm in t.get("items", []):
        prd = db.get_document("products", itm["product_id"])
        items_enriched.append({
            **itm,
            "product_name": prd["name"] if prd else itm["product_id"],
            "product_sku": prd["sku"] if prd else "",
        })

    return {
        **t,
        "source_warehouse_name": src["name"] if src else t["source_warehouse_id"],
        "target_warehouse_name": dst["name"] if dst else t["target_warehouse_id"],
        "items": items_enriched
    }

class CreateTransferRequest(BaseModel):
    source_warehouse_id: str
    target_warehouse_id: str
    items: List[TransferItem]
    notes: Optional[str] = ""

@router.post("", response_model=InterWarehouseTransfer)
def create_transfer(
    req: CreateTransferRequest,
    current_user: dict = Depends(require_permission(PERM_TRANSFERS_CREATE))
):
    validate_warehouse_access(current_user, req.source_warehouse_id)
    trf_doc = InventoryService.create_transfer(
        source_warehouse_id=req.source_warehouse_id,
        target_warehouse_id=req.target_warehouse_id,
        items=req.items,
        notes=req.notes or "",
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
        actor_role=current_user["role"],
        user_warehouse_id=current_user.get("warehouse_id"),
        org_id=current_user["org_id"]
    )

    AuditService.log_event(
        org_id=current_user["org_id"],
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
        actor_role=current_user["role"],
        action="TRANSFER_REQUESTED",
        target_entity="transfer",
        entity_id=trf_doc["id"],
        details={"transfer_number": trf_doc["transfer_number"], "source": req.source_warehouse_id, "target": req.target_warehouse_id}
    )

    return InterWarehouseTransfer(**trf_doc)

@router.post("/approve")
def approve_or_reject_transfer(
    req: TransferApprovalRequest,
    current_user: dict = Depends(require_permission(PERM_TRANSFERS_APPROVE))
):
    t = db.get_document("transfers", req.transfer_id)
    if not t or (current_user.get("role") != ROLE_SUPER_ADMIN and t.get("org_id") != current_user["org_id"]):
        raise HTTPException(status_code=404, detail="Transfer not found or cross-organization access denied.")

    if current_user.get("role") == ROLE_WAREHOUSE_MANAGER:
        allowed = get_authorized_warehouses(current_user) or []
        if t.get("source_warehouse_id") not in allowed and t.get("target_warehouse_id") not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Warehouse manager cannot approve transfers outside assigned facility."
            )

    res = InventoryService.approve_or_reject_transfer(
        transfer_id=req.transfer_id,
        approved=req.approved,
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
        actor_role=current_user["role"],
        user_warehouse_id=current_user.get("warehouse_id"),
        org_id=current_user["org_id"],
        notes=req.notes or ""
    )

    AuditService.log_event(
        org_id=current_user["org_id"],
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
        actor_role=current_user["role"],
        action="TRANSFER_APPROVED" if req.approved else "TRANSFER_REJECTED",
        target_entity="transfer",
        entity_id=req.transfer_id,
        details={"approved": req.approved, "notes": req.notes}
    )

    return {"success": True, "transfer": res}

@router.post("/dispatch")
def dispatch_transfer(
    req: TransferDispatchRequest,
    current_user: dict = Depends(require_permission(PERM_TRANSFERS_DISPATCH))
):
    t = db.get_document("transfers", req.transfer_id)
    if t:
        validate_warehouse_access(current_user, t.get("source_warehouse_id"))

    res = InventoryService.dispatch_transfer(
        req=req,
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
        actor_role=current_user["role"],
        user_warehouse_id=current_user.get("warehouse_id"),
        org_id=current_user["org_id"]
    )

    AuditService.log_event(
        org_id=current_user["org_id"],
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
        actor_role=current_user["role"],
        action="TRANSFER_DISPATCHED",
        target_entity="transfer",
        entity_id=req.transfer_id,
        details={"carrier": req.carrier_name, "tracking_number": req.tracking_number}
    )

    return {"success": True, "transfer": res}

@router.post("/receive")
def receive_transfer(
    req: TransferReceiveRequest,
    current_user: dict = Depends(require_permission(PERM_TRANSFERS_RECEIVE))
):
    t = db.get_document("transfers", req.transfer_id)
    if t:
        validate_warehouse_access(current_user, t.get("target_warehouse_id"))

    res = InventoryService.receive_transfer(
        req=req,
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
        actor_role=current_user["role"],
        user_warehouse_id=current_user.get("warehouse_id"),
        org_id=current_user["org_id"]
    )

    AuditService.log_event(
        org_id=current_user["org_id"],
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
        actor_role=current_user["role"],
        action="TRANSFER_RECEIVED",
        target_entity="transfer",
        entity_id=req.transfer_id,
        details={"condition": req.condition, "damaged_quantity": req.damaged_quantity}
    )

    return {"success": True, "transfer": res}

@router.post("/cancel")
def cancel_transfer(
    req: TransferCancelRequest,
    current_user: dict = Depends(require_permission(PERM_TRANSFERS_CREATE))
):
    t = db.get_document("transfers", req.transfer_id)
    if t:
        validate_warehouse_access(current_user, t.get("source_warehouse_id"))

    res = InventoryService.cancel_transfer(
        req=req,
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
        actor_role=current_user["role"],
        user_warehouse_id=current_user.get("warehouse_id"),
        org_id=current_user["org_id"]
    )

    AuditService.log_event(
        org_id=current_user["org_id"],
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
        actor_role=current_user["role"],
        action="TRANSFER_CANCELLED",
        target_entity="transfer",
        entity_id=req.transfer_id,
        details={"reason": req.reason}
    )

    return {"success": True, "transfer": res}
