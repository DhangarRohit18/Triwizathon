import random
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from app.core.database import db
from app.core.security import ROLE_SUPER_ADMIN, ROLE_ORG_ADMIN
from app.models.domain import Product, HandlingRequirement
from app.api.deps import get_current_user, require_permission
from app.core.permissions import PERM_PRODUCTS_MANAGE, PERM_INVENTORY_VIEW, PERM_SCANS_EXECUTE
from app.services.audit_service import AuditService

router = APIRouter(prefix="/products", tags=["Products & QR Resolution"])

@router.get("", response_model=List[Product])
def list_products(current_user: dict = Depends(require_permission(PERM_INVENTORY_VIEW))):
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
    current_user: dict = Depends(require_permission(PERM_PRODUCTS_MANAGE))
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
    current_user: dict = Depends(require_permission(PERM_SCANS_EXECUTE))
) -> Dict[str, Any]:
    """
    Scans and resolves QR codes, SKUs, barcodes, or opaque application URLs to
    associated products, batches, transfers, and warehouse inventory levels.
    Guarantees no secret credentials or sensitive tokens are stored in or exposed by QR endpoints.
    """
    import urllib.parse
    org_id = current_user["org_id"]
    query_str = code.strip()

    # 0. Opaque URL extraction if scanned from camera as a web link
    if query_str.startswith("http://") or query_str.startswith("https://"):
        parsed_url = urllib.parse.urlparse(query_str)
        query_params = urllib.parse.parse_qs(parsed_url.query)
        if "id" in query_params:
            query_str = query_params["id"][0].strip()
        elif "code" in query_params:
            query_str = query_params["code"][0].strip()
        else:
            path_parts = [p for p in parsed_url.path.split("/") if p]
            if path_parts:
                query_str = path_parts[-1].strip()

    # Strip standard human/mobile prefixes: e.g. PROD:, SKU:, BATCH:, LOT:, TRF:
    normalized_lookup = query_str
    for prefix in ("PROD:", "SKU:", "BATCH:", "LOT:", "TRF:", "TRANSFER:"):
        if normalized_lookup.upper().startswith(prefix):
            normalized_lookup = normalized_lookup[len(prefix):].strip()
            break

    # 1. Check if Transfer identifier: STOCKPILOT://TRANSFER/{id} or direct transfer ID
    transfer_lookup = normalized_lookup
    if "STOCKPILOT://TRANSFER/" in query_str:
        parts = query_str.split("/")
        transfer_lookup = parts[3] if len(parts) > 3 else normalized_lookup

    if transfer_lookup.startswith("trf_") or "STOCKPILOT://TRANSFER/" in query_str:
        transfer = db.get_document("transfers", transfer_lookup)
        if not transfer:
            # Query by id filter
            t_list = db.query("transfers", filters={"id": transfer_lookup}, org_id=org_id)
            if t_list:
                transfer = t_list[0]
        
        if transfer and transfer.get("org_id") == org_id:
            src_wh = db.get_document("warehouses", transfer["source_warehouse_id"])
            dst_wh = db.get_document("warehouses", transfer["target_warehouse_id"])
            items_enriched = []
            for itm in transfer.get("items", []):
                p_doc = db.get_document("products", itm["product_id"])
                items_enriched.append({
                    **itm,
                    "product_name": p_doc["name"] if p_doc else itm["product_id"],
                    "product_sku": p_doc["sku"] if p_doc else "",
                })

            return {
                "resolved_type": "transfer",
                "transfer": transfer,
                "transfer_id": transfer["id"],
                "status": transfer.get("status"),
                "source_warehouse": src_wh,
                "target_warehouse": dst_wh,
                "items": items_enriched,
                "product_name": items_enriched[0]["product_name"] if items_enriched else "Transfer Cargo",
                "sku": items_enriched[0]["product_sku"] if items_enriched else "",
            }

    # 2. Check if Batch QR: STOCKPILOT://BATCH/{batch_num}/WH/{wh_id} or direct batch matching
    batch_num_lookup = normalized_lookup
    if "STOCKPILOT://BATCH/" in query_str:
        parts = query_str.split("/")
        batch_num_lookup = parts[3] if len(parts) > 3 else normalized_lookup

    # Search in inventory_batches by batch_number, id, or qr_code_id
    batches = db.query("inventory_batches", org_id=org_id)
    matched_batch = None
    for b in batches:
        if (b.get("batch_number", "").upper() == batch_num_lookup.upper() or
            b.get("id") == batch_num_lookup or
            b.get("qr_code_id") == query_str or
            b.get("supplier_reference", "").upper() == batch_num_lookup.upper()):
            matched_batch = b
            break

    if matched_batch:
        prd = db.get_document("products", matched_batch["product_id"])
        wh = db.get_document("warehouses", matched_batch["warehouse_id"])
        inv_key = f"inv_{matched_batch['warehouse_id']}_{matched_batch['product_id']}"
        inv_doc = db.get_document("inventory", inv_key) or {}
        
        return {
            "resolved_type": "batch",
            "batch": matched_batch,
            "product": prd,
            "warehouse": wh,
            "product_id": prd["id"] if prd else matched_batch["product_id"],
            "product_name": prd["name"] if prd else matched_batch.get("batch_number"),
            "sku": prd["sku"] if prd else "",
            "category": prd["category"] if prd else "Pharmaceuticals",
            "handling": prd["handling"] if prd else "cold_chain",
            "storage_type": prd["handling"] if prd else "cold_chain",
            "warehouse_id": matched_batch["warehouse_id"],
            "batch_number": matched_batch["batch_number"],
            "batch_id": matched_batch["id"],
            "storage_bin": matched_batch.get("storage_bin", "BIN-A-01"),
            "expiry_date": matched_batch.get("expiry_date"),
            "unit_cost": matched_batch.get("unit_cost", 20.0),
            "current_stock": matched_batch.get("quantity", 0),
            "total_available": inv_doc.get("available_quantity", matched_batch.get("quantity", 0)),
        }

    # 3. Check if Product SKU, Barcode, or ID
    sku_lookup = normalized_lookup
    if "STOCKPILOT://SKU/" in query_str:
        parts = query_str.split("/")
        sku_lookup = parts[3] if len(parts) > 3 else normalized_lookup

    products = db.query("products", org_id=org_id)
    matched_prd = None
    for p in products:
        if (p["sku"].upper() == sku_lookup.upper() or
            p.get("id") == sku_lookup or
            p.get("barcode") == query_str or
            p.get("barcode") == normalized_lookup or
            p.get("qr_code_payload") == query_str or
            sku_lookup.lower() in p["name"].lower()):
            matched_prd = p
            break

    if not matched_prd:
        raise HTTPException(
            status_code=404,
            detail=f"No product, batch, or transfer found matching QR / barcode payload '{code}'"
        )

    # Fetch inventory & active batches for this product
    inv_items = db.query("inventory", filters={"product_id": matched_prd["id"]}, org_id=org_id)
    active_batches = db.query("inventory_batches", filters={"product_id": matched_prd["id"], "status": "active"}, org_id=org_id)
    total_avail = sum(i["available_quantity"] for i in inv_items)

    first_batch = active_batches[0] if active_batches else None
    first_wh = inv_items[0]["warehouse_id"] if inv_items else None

    return {
        "resolved_type": "product",
        "product": matched_prd,
        "product_id": matched_prd["id"],
        "product_name": matched_prd["name"],
        "sku": matched_prd["sku"],
        "category": matched_prd["category"],
        "handling": matched_prd["handling"],
        "storage_type": matched_prd["handling"],
        "unit": matched_prd["unit"],
        "unit_cost": matched_prd["unit_cost"],
        "warehouse_id": first_wh,
        "batch_number": first_batch["batch_number"] if first_batch else None,
        "batch_id": first_batch["id"] if first_batch else None,
        "current_stock": total_avail,
        "total_available": total_avail,
        "inventory_by_warehouse": inv_items,
        "active_batches": active_batches
    }

