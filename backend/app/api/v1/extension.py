from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from app.core.config import settings
from app.core.database import db
from app.api.deps import get_current_user
from app.core.permissions import (
    user_has_permission,
    validate_warehouse_access,
    get_authorized_warehouses,
    PERM_OPTIMIZATION_APPROVE,
    PERM_TRANSFERS_APPROVE,
    PERM_INVENTORY_VIEW,
)

router = APIRouter(prefix="/extension", tags=["Chrome Extension Companion"])

@router.get("/me")
def get_extension_user_profile(current_user: dict = Depends(get_current_user)) -> Dict[str, Any]:
    """Validate current session token and return identity for popup header."""
    return {
        "id": current_user.get("id"),
        "name": current_user.get("full_name", "User"),
        "email": current_user.get("email"),
        "role": current_user.get("role", "operator"),
        "org_id": current_user.get("org_id"),
        "warehouse_id": current_user.get("warehouse_id"),
        "warehouse_ids": current_user.get("warehouse_ids", []),
    }

@router.get("/summary")
def get_extension_summary(
    warehouse_id: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user)
) -> Dict[str, Any]:
    """
    Authoritative compact payload for Chrome Extension popup:
    - Current authenticated user & assigned warehouse
    - Live stock items with safety stock thresholds
    - Stockout warnings & FEFO batch expiry alerts (<= 60 days)
    - Active IoT cold-chain temperature excursion alerts
    - Distribution recommendation run summary & pending transfer approvals
    """
    org_id = current_user["org_id"]
    assigned_wh_id = warehouse_id or current_user.get("warehouse_id")
    if not assigned_wh_id:
        allowed = get_authorized_warehouses(current_user)
        if allowed:
            assigned_wh_id = allowed[0]
        else:
            raise HTTPException(
                status_code=403,
                detail="User account has no assigned warehouse facilities."
            )
    
    # Enforce location scoping:
    validate_warehouse_access(current_user, assigned_wh_id)
    wh = db.get_document("warehouses", assigned_wh_id)
    
    allowed_whs = get_authorized_warehouses(current_user)
    raw_warehouses = db.query("warehouses", org_id=org_id)
    if allowed_whs is not None:
        raw_warehouses = [w for w in raw_warehouses if w["id"] in allowed_whs]

    all_warehouses = [
        {"id": w["id"], "name": w["name"], "city": w.get("city", "")}
        for w in raw_warehouses
    ]

    # Inventory at assigned warehouse
    inv_items = db.query("inventory", filters={"warehouse_id": assigned_wh_id}, org_id=org_id)
    products = {p["id"]: p for p in db.query("products", org_id=org_id)}

    stock_summary = []
    low_stock_count = 0
    stockout_count = 0
    for item in inv_items:
        p = products.get(item["product_id"], {})
        avail = item.get("available_quantity", 0)
        safety = item.get("safety_stock", 50)
        is_low = avail <= safety
        is_stockout = avail <= 0
        if is_low:
            low_stock_count += 1
        if is_stockout:
            stockout_count += 1
        stock_summary.append({
            "product_id": item["product_id"],
            "sku": p.get("sku", ""),
            "name": p.get("name", "Unknown Product"),
            "available": avail,
            "safety_stock": safety,
            "unit": p.get("unit", "units"),
            "handling": p.get("handling", "standard"),
            "is_low": is_low,
            "is_stockout": is_stockout
        })

    # FEFO Batch Expiry tracking
    today = datetime.now(timezone.utc).date()
    batches = db.query("inventory_batches", filters={"warehouse_id": assigned_wh_id}, org_id=org_id)
    expiry_alerts = []
    for b in batches:
        exp_str = b.get("expiry_date", "")
        if exp_str:
            try:
                exp_date = datetime.strptime(exp_str[:10], "%Y-%m-%d").date()
                days_left = (exp_date - today).days
                if days_left <= 60 and b.get("quantity", 0) > 0:
                    prd = products.get(b.get("product_id"), {})
                    expiry_alerts.append({
                        "batch_id": b.get("id"),
                        "batch_number": b.get("batch_number", "Unknown"),
                        "product_name": prd.get("name", "Medical Supply"),
                        "sku": prd.get("sku", ""),
                        "expiry_date": exp_str[:10],
                        "days_remaining": days_left,
                        "quantity": b.get("quantity", 0),
                        "is_critical": days_left <= 30
                    })
            except Exception:
                pass
    expiry_alerts.sort(key=lambda x: x["days_remaining"])

    # IoT Excursion Alerts (scoped by authorized facilities for warehouse managers)
    raw_alerts = db.query("alerts", filters={"acknowledged": False}, org_id=org_id, order_by="timestamp", descending=True, limit=10)
    if allowed_whs is not None:
        alerts = [
            a for a in raw_alerts
            if not a.get("warehouse_id") or a.get("warehouse_id") in allowed_whs
        ]
    else:
        alerts = raw_alerts

    # Pending transfers (scoped by authorized facilities)
    pending_transfers = db.query("transfers", filters={"status": "pending"}, org_id=org_id, limit=10)
    if allowed_whs is not None:
        pending_transfers = [
            t for t in pending_transfers
            if t.get("source_warehouse_id") in allowed_whs or t.get("target_warehouse_id") in allowed_whs
        ]
    formatted_pending = []
    for t in pending_transfers[:5]:
        src = db.get_document("warehouses", t.get("source_warehouse_id", ""))
        dst = db.get_document("warehouses", t.get("target_warehouse_id", ""))
        formatted_pending.append({
            "id": t.get("id"),
            "transfer_number": t.get("transfer_number", t.get("id")),
            "source": src.get("name", t.get("source_warehouse_id")) if src else t.get("source_warehouse_id"),
            "destination": dst.get("name", t.get("target_warehouse_id")) if dst else t.get("target_warehouse_id"),
            "requested_by": t.get("requested_by", "Operations"),
            "items_count": len(t.get("items", [])),
            "status": t.get("status")
        })

    # Optimizer distribution summary (authoritative values only)
    optimizer_runs = db.query("optimization_runs", org_id=org_id, order_by="timestamp", descending=True, limit=1)
    if not optimizer_runs:
        optimizer_runs = db.query("optimization_runs", org_id=org_id, order_by="created_at", descending=True, limit=1)
    
    rec_summary = None
    if optimizer_runs:
        last_run = optimizer_runs[0]
        opt_data = last_run.get("optimized", {})
        savings_pct = last_run.get("savings_percent")
        if savings_pct is None:
            savings_pct = last_run.get("cost_savings_pct")
        rec_summary = {
            "run_id": last_run.get("run_id") or last_run.get("id"),
            "status": last_run.get("status", "completed"),
            "created_at": last_run.get("timestamp") or last_run.get("created_at"),
            "total_allocated": opt_data.get("total_allocated_units") if opt_data.get("total_allocated_units") is not None else last_run.get("total_allocated_units"),
            "total_cost": opt_data.get("total_modeled_cost") if opt_data.get("total_modeled_cost") is not None else last_run.get("total_cost"),
            "cost_savings_pct": round(savings_pct, 1) if savings_pct is not None else None,
            "unmet_demand_units": opt_data.get("stockout_units") if opt_data.get("stockout_units") is not None else last_run.get("unmet_demand_units", 0)
        }
    else:
        rec_summary = None

    return {
        "user": {
            "id": current_user["id"],
            "name": current_user.get("full_name", "Operator"),
            "role": current_user.get("role", "operator"),
            "email": current_user["email"]
        },
        "warehouse": {
            "id": assigned_wh_id,
            "name": wh["name"] if wh else "Central Hub",
            "city": wh.get("city", "Chicago"),
            "is_operational": wh.get("is_operational", True) if wh else True,
            "used_pallets": wh.get("used_pallets", 0) if wh else 0,
            "capacity_pallets": wh.get("capacity_pallets", 10000) if wh else 10000
        },
        "available_warehouses": all_warehouses,
        "low_stock_count": low_stock_count,
        "stockout_count": stockout_count,
        "stock": stock_summary[:12],
        "active_alerts": alerts[:5],
        "expiry_alerts": expiry_alerts[:5],
        "pending_transfers": formatted_pending,
        "recommendations_summary": rec_summary,
        "system_status": "ONLINE"
    }

@router.get("/search")
def extension_quick_search(
    q: str = Query(..., min_length=1),
    current_user: dict = Depends(get_current_user)
) -> List[Dict[str, Any]]:
    """Quick SKU, name, or batch search with cross-warehouse availability."""
    org_id = current_user["org_id"]
    products = db.query("products", org_id=org_id)
    q_lower = q.lower()
    matches = []
    for p in products:
        if q_lower in p["sku"].lower() or q_lower in p["name"].lower():
            invs = db.query("inventory", filters={"product_id": p["id"]}, org_id=org_id)
            total_avail = sum(i.get("available_quantity", 0) for i in invs)
            matches.append({
                "product_id": p["id"],
                "sku": p["sku"],
                "name": p["name"],
                "handling": p.get("handling", "standard"),
                "total_available": total_avail,
                "unit": p.get("unit", "units")
            })
    return matches

@router.post("/approve-transfer/{transfer_id}")
def extension_approve_transfer(
    transfer_id: str,
    current_user: dict = Depends(get_current_user)
) -> Dict[str, Any]:
    """Allow authorized managers to approve transfers directly from the extension."""
    if not (user_has_permission(current_user, PERM_TRANSFERS_APPROVE) or user_has_permission(current_user, PERM_OPTIMIZATION_APPROVE)):
        raise HTTPException(status_code=403, detail="Permission 'transfers.approve' required for transfer approval.")
    
    t = db.get_document("transfers", transfer_id)
    if not t or t.get("org_id") != current_user["org_id"]:
        raise HTTPException(status_code=404, detail="Transfer not found or cross-organization access denied.")

    if current_user.get("role") == "warehouse_manager":
        allowed = get_authorized_warehouses(current_user) or []
        if t.get("source_warehouse_id") not in allowed and t.get("target_warehouse_id") not in allowed:
            raise HTTPException(
                status_code=403,
                detail="Warehouse manager cannot approve transfers outside assigned facility."
            )

    from app.services.inventory_service import InventoryService
    return InventoryService.approve_or_reject_transfer(
        transfer_id=transfer_id,
        approved=True,
        actor_id=current_user["id"],
        actor_name=current_user.get("full_name", "Manager"),
        actor_role=current_user.get("role", "supply_chain_manager"),
        user_warehouse_id=current_user.get("warehouse_id"),
        org_id=current_user["org_id"],
        notes="Approved via Chrome Extension companion"
    )

@router.post("/acknowledge-alert/{alert_id}")
def extension_acknowledge_alert(
    alert_id: str,
    current_user: dict = Depends(get_current_user)
) -> Dict[str, Any]:
    """Allow operators and managers to acknowledge alerts directly from the extension."""
    from app.services.iot_service import IoTTelemetryService
    return IoTTelemetryService.acknowledge_alert(
        alert_id=alert_id,
        actor_id=current_user["id"],
        actor_name=current_user.get("full_name") or current_user.get("email", "Operator"),
        org_id=current_user["org_id"]
    )

