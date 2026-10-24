from typing import Dict, Any, List, Optional
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from app.core.config import settings
from app.core.database import db
from app.api.deps import get_current_user

router = APIRouter(prefix="/extension", tags=["Chrome Extension Companion"])

@router.get("/summary")
def get_extension_summary(current_user: dict = Depends(get_current_user)) -> Dict[str, Any]:
    """
    Lightweight compact payload tailored for the Chrome Extension popup:
    current user, assigned warehouse summary, critical alerts, pending approvals.
    """
    org_id = current_user["org_id"]
    assigned_wh_id = current_user.get("warehouse_id") or "wh_chicago_01"
    wh = db.get_document("warehouses", assigned_wh_id)

    # Inventory at assigned warehouse
    inv_items = db.query("inventory", filters={"warehouse_id": assigned_wh_id}, org_id=org_id)
    products = {p["id"]: p for p in db.query("products", org_id=org_id)}

    stock_summary = []
    low_stock_count = 0
    for item in inv_items:
        p = products.get(item["product_id"], {})
        is_low = item["available_quantity"] <= item.get("safety_stock", 50)
        if is_low:
            low_stock_count += 1
        stock_summary.append({
            "product_id": item["product_id"],
            "sku": p.get("sku", ""),
            "name": p.get("name", ""),
            "available": item["available_quantity"],
            "safety_stock": item.get("safety_stock", 50),
            "is_low": is_low
        })

    # Critical active alerts
    alerts = db.query("alerts", filters={"acknowledged": False}, org_id=org_id, order_by="timestamp", descending=True, limit=5)

    # Pending transfers requiring approval
    pending_transfers = db.query("transfers", filters={"status": "pending"}, org_id=org_id, limit=5)

    return {
        "user": {
            "name": current_user["full_name"],
            "role": current_user["role"],
            "email": current_user["email"]
        },
        "warehouse": {
            "id": assigned_wh_id,
            "name": wh["name"] if wh else "Central Hub",
            "city": wh.get("city", ""),
            "is_operational": wh.get("is_operational", True) if wh else True
        },
        "low_stock_items": low_stock_count,
        "stock": stock_summary[:10],
        "active_alerts": alerts,
        "pending_transfers": pending_transfers,
        "system_status": "ONLINE"
    }

@router.get("/search")
def extension_quick_search(
    q: str = Query(..., min_length=1),
    current_user: dict = Depends(get_current_user)
) -> List[Dict[str, Any]]:
    """Quick SKU or product search for popup autocomplete."""
    org_id = current_user["org_id"]
    products = db.query("products", org_id=org_id)
    q_lower = q.lower()
    matches = []
    for p in products:
        if q_lower in p["sku"].lower() or q_lower in p["name"].lower():
            # Get stock across warehouses
            invs = db.query("inventory", filters={"product_id": p["id"]}, org_id=org_id)
            total_avail = sum(i["available_quantity"] for i in invs)
            matches.append({
                "product_id": p["id"],
                "sku": p["sku"],
                "name": p["name"],
                "handling": p["handling"],
                "total_available": total_avail,
                "unit": p["unit"]
            })
    return matches
