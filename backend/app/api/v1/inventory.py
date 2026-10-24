from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from app.core.database import db
from app.models.domain import (
    InventoryItem,
    InventoryBatch,
    InventoryMovement,
    ReceiveStockRequest,
    DispatchStockRequest,
    StockAdjustmentRequest,
    DamageReportRequest
)
from app.api.deps import get_current_user
from app.services.inventory_service import InventoryService
from app.services.audit_service import AuditService

router = APIRouter(prefix="/inventory", tags=["Inventory & Ledger Operations"])

@router.get("", response_model=List[Dict[str, Any]])
def get_inventory(
    warehouse_id: Optional[str] = Query(None),
    product_id: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    org_id = current_user["org_id"]
    filters = {}
    if warehouse_id:
        filters["warehouse_id"] = warehouse_id
    if product_id:
        filters["product_id"] = product_id

    items = db.query("inventory", filters=filters, org_id=org_id)
    
    # Enrich with product names and warehouse names
    result = []
    for item in items:
        prd = db.get_document("products", item["product_id"])
        wh = db.get_document("warehouses", item["warehouse_id"])
        result.append({
            **item,
            "product_name": prd["name"] if prd else item["product_id"],
            "product_sku": prd["sku"] if prd else "",
            "handling": prd["handling"] if prd else "ambient",
            "unit": prd["unit"] if prd else "units",
            "warehouse_name": wh["name"] if wh else item["warehouse_id"],
        })
    return result

@router.get("/batches", response_model=List[Dict[str, Any]])
def list_batches(
    warehouse_id: Optional[str] = Query(None),
    product_id: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    org_id = current_user["org_id"]
    filters = {}
    if warehouse_id:
        filters["warehouse_id"] = warehouse_id
    if product_id:
        filters["product_id"] = product_id

    batches = db.query("inventory_batches", filters=filters, org_id=org_id, order_by="expiry_date")
    
    result = []
    for b in batches:
        prd = db.get_document("products", b["product_id"])
        wh = db.get_document("warehouses", b["warehouse_id"])
        result.append({
            **b,
            "product_name": prd["name"] if prd else b["product_id"],
            "product_sku": prd["sku"] if prd else "",
            "handling": prd["handling"] if prd else "ambient",
            "warehouse_name": wh["name"] if wh else b["warehouse_id"],
        })
    return result

@router.get("/movements", response_model=List[Dict[str, Any]])
def list_movements(
    product_id: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
    current_user: dict = Depends(get_current_user)
):
    """
    Returns immutable append-only inventory movement ledger records.
    """
    org_id = current_user["org_id"]
    filters = {}
    if product_id:
        filters["product_id"] = product_id

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
    current_user: dict = Depends(get_current_user)
):
    res = InventoryService.receive_stock(
        req=req,
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
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
        details={"quantity": req.quantity, "batch_number": req.batch_number, "correlation_id": req.correlation_id}
    )
    return res

@router.post("/dispatch")
def dispatch_stock(
    req: DispatchStockRequest,
    current_user: dict = Depends(get_current_user)
):
    res = InventoryService.dispatch_stock(
        req=req,
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
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
        details={"quantity": req.quantity, "destination_id": req.destination_id, "correlation_id": req.correlation_id}
    )
    return res

@router.post("/adjust")
def adjust_stock(
    req: StockAdjustmentRequest,
    current_user: dict = Depends(get_current_user)
):
    res = InventoryService.adjust_stock(
        req=req,
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
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
    current_user: dict = Depends(get_current_user)
):
    res = InventoryService.report_damage(
        req=req,
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
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
