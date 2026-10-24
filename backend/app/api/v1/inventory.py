from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, status
from app.core.database import db
from app.models.domain import (
    InventoryItem,
    InventoryBatch,
    InventoryMovement,
    ReceiveStockRequest,
    DispatchStockRequest,
    StockReservationRequest,
    ReleaseReservationRequest,
    StockAdjustmentRequest,
    DamageReportRequest,
    CycleCountRequest,
    DiscrepancyResolutionRequest
)
from app.api.deps import (
    get_current_user,
    require_permission,
    get_scoped_warehouse_filter
)
from app.core.permissions import (
    PERM_INVENTORY_VIEW,
    PERM_INVENTORY_RECEIVE,
    PERM_INVENTORY_DISPATCH,
    PERM_INVENTORY_ADJUST,
    PERM_DAMAGE_REPORT,
    validate_warehouse_access,
    get_authorized_warehouses
)
from app.services.inventory_service import InventoryService
from app.services.audit_service import AuditService

router = APIRouter(prefix="/inventory", tags=["Inventory & Ledger Operations"])

@router.get("", response_model=List[Dict[str, Any]])
def get_inventory(
    warehouse_id: Optional[str] = Query(None),
    product_id: Optional[str] = Query(None),
    current_user: dict = Depends(require_permission(PERM_INVENTORY_VIEW))
):
    org_id = current_user["org_id"]
    scoped_wid = get_scoped_warehouse_filter(current_user, warehouse_id)

    filters = {}
    if scoped_wid:
        filters["warehouse_id"] = scoped_wid
    if product_id:
        filters["product_id"] = product_id

    items = db.query("inventory", filters=filters, org_id=org_id)
    
    result = []
    for item in items:
        prd = db.get_document("products", item["product_id"]) if item.get("product_id") else None
        wh = db.get_document("warehouses", item["warehouse_id"]) if item.get("warehouse_id") else None
        result.append({
            **item,
            "product_name": prd.get("name", item.get("product_id", "")) if prd else item.get("product_id", ""),
            "product_sku": prd.get("sku", "") if prd else "",
            "handling": prd.get("handling", "ambient") if prd else "ambient",
            "unit": prd.get("unit", "units") if prd else "units",
            "warehouse_name": wh.get("name", item.get("warehouse_id", "")) if wh else item.get("warehouse_id", ""),
        })
    return result

@router.get("/batches", response_model=List[Dict[str, Any]])
def list_batches(
    warehouse_id: Optional[str] = Query(None),
    product_id: Optional[str] = Query(None),
    current_user: dict = Depends(require_permission(PERM_INVENTORY_VIEW))
):
    org_id = current_user["org_id"]
    scoped_wid = get_scoped_warehouse_filter(current_user, warehouse_id)

    filters = {}
    if scoped_wid:
        filters["warehouse_id"] = scoped_wid
    if product_id:
        filters["product_id"] = product_id

    batches = db.query("batches", filters=filters, org_id=org_id, order_by="expiration_date", descending=False)
    
    result = []
    for b in batches:
        prd = db.get_document("products", b["product_id"]) if b.get("product_id") else None
        wh = db.get_document("warehouses", b["warehouse_id"]) if b.get("warehouse_id") else None
        result.append({
            **b,
            "product_name": prd.get("name", b.get("product_id", "")) if prd else b.get("product_id", ""),
            "product_sku": prd.get("sku", "") if prd else "",
            "handling": prd.get("handling", "ambient") if prd else "ambient",
            "warehouse_name": wh.get("name", b.get("warehouse_id", "")) if wh else b.get("warehouse_id", ""),
        })
    return result

@router.get("/movements", response_model=List[Dict[str, Any]])
def list_movements(
    product_id: Optional[str] = Query(None),
    warehouse_id: Optional[str] = Query(None),
    movement_type: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
    current_user: dict = Depends(require_permission(PERM_INVENTORY_VIEW))
):
    """
    Returns immutable append-only inventory movement ledger records with location scoping.
    """
    org_id = current_user["org_id"]
    scoped_wid = get_scoped_warehouse_filter(current_user, warehouse_id)

    filters = {}
    if product_id:
        filters["product_id"] = product_id
    if scoped_wid:
        filters["source_warehouse_id"] = scoped_wid
    if movement_type:
        filters["movement_type"] = movement_type

    movements = db.query(
        "inventory_movements",
        filters=filters,
        org_id=org_id,
        order_by="timestamp",
        descending=True,
        limit=limit
    )

    enriched = []
    for m in movements:
        prd = db.get_document("products", m["product_id"])
        src_wh = db.get_document("warehouses", m.get("source_warehouse_id")) if m.get("source_warehouse_id") else None
        dst_wh = db.get_document("warehouses", m.get("destination_id")) if m.get("destination_id") else None
        
        enriched.append({
            **m,
            "product_name": prd["name"] if prd else m["product_id"],
            "product_sku": prd["sku"] if prd else "",
            "source_name": src_wh["name"] if src_wh else m.get("source_warehouse_id", "External"),
            "destination_name": dst_wh["name"] if dst_wh else m.get("destination_id", "Customer / Destination"),
        })
    return enriched

@router.post("/receive")
def receive_stock(
    req: ReceiveStockRequest,
    current_user: dict = Depends(require_permission(PERM_INVENTORY_RECEIVE))
):
    validate_warehouse_access(current_user, req.warehouse_id)
    res = InventoryService.receive_stock(
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
        action="STOCK_RECEIVED",
        target_entity="inventory_batch",
        entity_id=res["batch"]["id"],
        details={"quantity": req.quantity, "batch_number": req.batch_number, "warehouse_id": req.warehouse_id, "correlation_id": req.correlation_id}
    )
    return res

@router.post("/dispatch")
def dispatch_stock(
    req: DispatchStockRequest,
    current_user: dict = Depends(require_permission(PERM_INVENTORY_DISPATCH))
):
    validate_warehouse_access(current_user, req.warehouse_id)
    res = InventoryService.dispatch_stock(
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
        action="STOCK_DISPATCHED",
        target_entity="inventory",
        entity_id=req.product_id,
        details={"quantity": req.quantity, "warehouse_id": req.warehouse_id, "destination_id": req.destination_id, "correlation_id": req.correlation_id}
    )
    return res

@router.post("/reserve")
def reserve_stock(
    req: StockReservationRequest,
    current_user: dict = Depends(require_permission(PERM_INVENTORY_DISPATCH))
):
    validate_warehouse_access(current_user, req.warehouse_id)
    res = InventoryService.reserve_stock(
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
        action="STOCK_RESERVED",
        target_entity="inventory",
        entity_id=req.product_id,
        details={"quantity": req.quantity, "warehouse_id": req.warehouse_id, "order_id": req.order_id}
    )
    return res

@router.post("/reserve/release")
def release_reservation(
    req: ReleaseReservationRequest,
    current_user: dict = Depends(require_permission(PERM_INVENTORY_DISPATCH))
):
    validate_warehouse_access(current_user, req.warehouse_id)
    res = InventoryService.release_reservation(
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
        action="STOCK_RESERVATION_RELEASED",
        target_entity="inventory",
        entity_id=req.product_id,
        details={"quantity": req.quantity, "warehouse_id": req.warehouse_id, "order_id": req.order_id}
    )
    return res

@router.post("/cycle-count")
def cycle_count(
    req: CycleCountRequest,
    current_user: dict = Depends(require_permission(PERM_INVENTORY_VIEW))
):
    batch = db.get_document("batches", req.batch_id)
    if batch:
        validate_warehouse_access(current_user, batch.get("warehouse_id"))
    res = InventoryService.cycle_count(
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
        action="CYCLE_COUNT_RECORDED",
        target_entity="inventory_batch",
        entity_id=req.batch_id,
        details={"counted_quantity": req.counted_quantity, "variance": res["variance"], "correlation_id": req.correlation_id}
    )
    return res

@router.post("/adjust")
def adjust_stock(
    req: StockAdjustmentRequest,
    current_user: dict = Depends(require_permission(PERM_INVENTORY_ADJUST))
):
    batch = db.get_document("batches", req.batch_id)
    if batch:
        validate_warehouse_access(current_user, batch.get("warehouse_id"))
    res = InventoryService.adjust_stock(
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
        action="STOCK_ADJUSTED",
        target_entity="inventory_batch",
        entity_id=req.batch_id,
        details={"new_quantity": req.new_quantity, "reason": req.reason, "correlation_id": req.correlation_id}
    )
    return res

@router.post("/damage")
def report_damage(
    req: DamageReportRequest,
    current_user: dict = Depends(require_permission(PERM_DAMAGE_REPORT))
):
    batch = db.get_document("batches", req.batch_id)
    if batch:
        validate_warehouse_access(current_user, batch.get("warehouse_id"))
    res = InventoryService.report_damage(
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
        action="DAMAGE_REPORTED",
        target_entity="inventory_batch",
        entity_id=req.batch_id,
        details={"damaged_quantity": req.damaged_quantity, "reason": req.reason, "correlation_id": req.correlation_id}
    )
    return res

@router.post("/discrepancy/resolve")
def resolve_discrepancy(
    req: DiscrepancyResolutionRequest,
    current_user: dict = Depends(require_permission(PERM_INVENTORY_ADJUST))
):
    batch = db.get_document("batches", req.batch_id)
    if batch:
        validate_warehouse_access(current_user, batch.get("warehouse_id"))
    res = InventoryService.resolve_discrepancy(
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
        action="DISCREPANCY_RESOLVED",
        target_entity="inventory_batch",
        entity_id=req.batch_id,
        details={"action": req.resolution_action, "type": req.discrepancy_type, "delta": req.quantity_delta}
    )
    return res
