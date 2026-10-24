import random
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from app.core.database import db
from app.core.security import ROLE_SUPER_ADMIN, ROLE_ORG_ADMIN
from app.models.domain import Product, HandlingRequirement
from app.api.deps import get_current_user, require_roles
from app.services.audit_service import AuditService

router = APIRouter(prefix="/products", tags=["Products & QR Resolution"])

@router.get("", response_model=List[Product])
def list_products(current_user: dict = Depends(get_current_user)):
    org_id = current_user["org_id"] if current_user.get("role") != ROLE_SUPER_ADMIN else None
    products = db.query("products", org_id=org_id)
    return [Product(**p) for p in products]

class ProductCreateRequest(BaseModel):
    sku: str
    name: str
    category: str
    description: Optional[str] = ""
    unit: str = "units"
    unit_cost: float
    selling_price: float
    handling: HandlingRequirement = HandlingRequirement.AMBIENT
    min_safety_stock: int = 50
    reorder_point: int = 100
    shelf_life_days: int = 365
    weight_kg: float = 0.5

@router.post("", response_model=Product)
def create_product(
    req: ProductCreateRequest,
    current_user: dict = Depends(require_roles([ROLE_SUPER_ADMIN, ROLE_ORG_ADMIN]))
):
    clean_sku = req.sku.strip().upper()
    existing = db.query("products", filters={"sku": clean_sku}, org_id=current_user["org_id"])
    if existing:
        raise HTTPException(status_code=409, detail=f"Product with SKU '{clean_sku}' already exists.")

    p_id = f"prd_{clean_sku.lower().replace('-', '_')}"
    barcode = f"8901{random.randint(100000000, 999999999)}"
    qr_payload = f"STOCKPILOT://SKU/{clean_sku}/ORG/{current_user['org_id']}"

    new_prod = {
        "id": p_id,
        "org_id": current_user["org_id"],
        "sku": clean_sku,
        "name": req.name,
        "category": req.category,
        "description": req.description,
        "unit": req.unit,
        "unit_cost": req.unit_cost,
        "selling_price": req.selling_price,
        "handling": req.handling.value,
        "min_safety_stock": req.min_safety_stock,
        "reorder_point": req.reorder_point,
        "barcode": barcode,
        "qr_code_payload": qr_payload,
        "shelf_life_days": req.shelf_life_days,
        "weight_kg": req.weight_kg
    }
    db.set_document("products", p_id, new_prod)

    AuditService.log_event(
        org_id=current_user["org_id"],
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
        actor_role=current_user["role"],
        action="PRODUCT_CREATED",
        target_entity="product",
        entity_id=p_id,
        details={"sku": clean_sku, "name": req.name}
    )

    return Product(**new_prod)

@router.get("/resolve-qr")
def resolve_qr_code(
    code: str = Query(..., description="Scanned QR payload string or SKU/Barcode"),
    current_user: dict = Depends(get_current_user)
) -> Dict[str, Any]:
    """
    Scans and resolves QR codes, SKUs, or barcodes to associated products,
    batches, and warehouse inventory levels.
    """
    org_id = current_user["org_id"]
    query_str = code.strip()

    # 1. Check if batch QR: STOCKPILOT://BATCH/{batch_num}/WH/{wh_id}
    if "STOCKPILOT://BATCH/" in query_str:
        parts = query_str.split("/")
        batch_num = parts[3] if len(parts) > 3 else ""
        batches = db.query("inventory_batches", filters={"batch_number": batch_num}, org_id=org_id)
        if batches:
            b = batches[0]
            prd = db.get_document("products", b["product_id"])
            wh = db.get_document("warehouses", b["warehouse_id"])
            return {
                "resolved_type": "batch",
                "batch": b,
                "product": prd,
                "warehouse": wh
            }

    # 2. Check if product SKU or Barcode
    sku_lookup = query_str
    if "STOCKPILOT://SKU/" in query_str:
        parts = query_str.split("/")
        sku_lookup = parts[3] if len(parts) > 3 else query_str

    products = db.query("products", org_id=org_id)
    matched_prd = None
    for p in products:
        if (p["sku"].upper() == sku_lookup.upper() or
            p.get("barcode") == query_str or
            p.get("qr_code_payload") == query_str or
            sku_lookup.lower() in p["name"].lower()):
            matched_prd = p
            break

    if not matched_prd:
        raise HTTPException(
            status_code=404,
            detail=f"No product or batch found matching QR / barcode payload '{query_str}'"
        )

    # Fetch inventory & active batches for this product
    inv_items = db.query("inventory", filters={"product_id": matched_prd["id"]}, org_id=org_id)
    batches = db.query("inventory_batches", filters={"product_id": matched_prd["id"], "status": "active"}, org_id=org_id)

    return {
        "resolved_type": "product",
        "product": matched_prd,
        "total_available": sum(i["available_quantity"] for i in inv_items),
        "inventory_by_warehouse": inv_items,
        "active_batches": batches
    }
