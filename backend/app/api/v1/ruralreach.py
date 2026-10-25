"""
=============================================================================
StockPilot AI — RuralReach Mode: Offline-First Synchronization & Conflict Engine
=============================================================================
Provides lightweight snapshot downloads, batch synchronization of offline-queued
inventory transactions (receiving, dispatch, damage reporting, cycle counts),
strict server-side idempotency, concurrency-safe ACID ledger commits, and
conflict detection (Needs Review) for low-connectivity rural hubs.
"""

import hashlib
import json
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, Header, HTTPException, Query, status

from app.core.database import db
from app.api.deps import get_current_user, require_permission
from app.core.permissions import (
    validate_warehouse_access,
    get_authorized_warehouses,
    PERM_INVENTORY_VIEW,
    PERM_INVENTORY_RECEIVE,
    PERM_INVENTORY_DISPATCH,
    PERM_DAMAGE_REPORT,
    ROLE_SUPER_ADMIN,
)
from app.services.inventory_service import InventoryService
from app.services.audit_service import AuditService
from app.models.domain import (
    ReceiveStockRequest,
    DispatchStockRequest,
    DamageReportRequest,
    CycleCountRequest,
)

router = APIRouter(prefix="/ruralreach", tags=["RuralReach Offline-First Mode"])


# -----------------------------------------------------------------------------
# Request & Response Models
# -----------------------------------------------------------------------------
class OfflineTransactionItem(BaseModel):
    transaction_id: str = Field(..., description="Unique client-generated idempotency key (UUID)")
    action: str = Field(..., description="Action type: RECEIVE, DISPATCH, DAMAGE_REPORT, CYCLE_COUNT, STOCK_ADJUST, DELIVERY_CONFIRM")
    payload: Dict[str, Any] = Field(..., description="Action-specific payload parameters")
    timestamp: str = Field(..., description="Client recorded timestamp (ISO8601)")
    user_id: Optional[str] = None
    device_id: Optional[str] = None
    client_notes: Optional[str] = None


class RuralReachSyncRequest(BaseModel):
    device_id: str = Field(..., description="Client device / browser instance identifier")
    warehouse_id: str = Field(..., description="Target facility for the batch sync")
    client_sync_time: str = Field(..., description="Client synchronization trigger time")
    transactions: List[OfflineTransactionItem] = Field(default_factory=list)


class ConflictResolutionRequest(BaseModel):
    resolution_action: str = Field(..., description="APPROVE_OVERRIDE, DISCARD_DRAFT, or ADJUST_DIFFERENCE")
    notes: Optional[str] = None
    adjusted_quantity: Optional[int] = None


# -----------------------------------------------------------------------------
# 1. Lightweight Low-Bandwidth Snapshot Download
# -----------------------------------------------------------------------------
@router.get("/snapshot", summary="Download lightweight offline snapshot for authorized warehouse")
def get_ruralreach_snapshot(
    warehouse_id: Optional[str] = Query(None),
    if_none_match: Optional[str] = Header(None),
    current_user: dict = Depends(require_permission(PERM_INVENTORY_VIEW))
) -> Dict[str, Any]:
    """
    Returns a consolidated, compressed data bundle for local persistence:
    - Products catalogue (SKU, name, barcode, unit, handling)
    - Authorized warehouse inventory levels & safety thresholds
    - Active batches with FEFO expiry dates
    - Most recently approved distribution recommendations (tagged as cached)
    - SHA256 checksum for low-bandwidth validation
    """
    org_id = current_user["org_id"]
    assigned_wh = warehouse_id or current_user.get("warehouse_id")

    if not assigned_wh or assigned_wh == "all":
        allowed = get_authorized_warehouses(current_user)
        if allowed:
            assigned_wh = allowed[0]
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User account has no assigned warehouse facilities for RuralReach mode."
            )

    validate_warehouse_access(current_user, assigned_wh)
    wh_doc = db.get_document("warehouses", assigned_wh)

    # 1. Products
    products = db.query("products", org_id=org_id)
    catalogue = [
        {
            "id": p["id"],
            "sku": p.get("sku", ""),
            "name": p.get("name", ""),
            "barcode": p.get("barcode", ""),
            "category": p.get("category", "General"),
            "unit": p.get("unit", "units"),
            "handling": p.get("handling", "standard"),
            "min_safety_stock": p.get("min_safety_stock", 50),
            "reorder_point": p.get("reorder_point", 100),
            "unit_cost": p.get("unit_cost", 0.0),
        }
        for p in products
    ]

    # 2. Inventory for target warehouse
    inv_items = db.query("inventory", filters={"warehouse_id": assigned_wh}, org_id=org_id)
    inventory_summary = [
        {
            "id": i["id"],
            "product_id": i["product_id"],
            "warehouse_id": i["warehouse_id"],
            "available_quantity": i.get("available_quantity", 0),
            "reserved_quantity": i.get("reserved_quantity", 0),
            "damaged_quantity": i.get("damaged_quantity", 0),
            "safety_stock": i.get("safety_stock", 50),
            "reorder_point": i.get("reorder_point", 100),
        }
        for i in inv_items
    ]

    # 3. Active batches (FEFO)
    batches = db.query("inventory_batches", filters={"warehouse_id": assigned_wh}, org_id=org_id)
    batches_summary = [
        {
            "id": b["id"],
            "product_id": b["product_id"],
            "batch_number": b.get("batch_number", ""),
            "expiry_date": b.get("expiry_date", "")[:10] if b.get("expiry_date") else "",
            "quantity": b.get("quantity", 0),
            "reserved_quantity": b.get("reserved_quantity", 0),
            "damaged_quantity": b.get("damaged_quantity", 0),
            "storage_bin": b.get("storage_bin", "General"),
            "qr_code_id": b.get("qr_code_id", ""),
            "status": b.get("status", "active"),
            "unit_cost": b.get("unit_cost", 0.0),
        }
        for b in batches if b.get("quantity", 0) > 0
    ]

    # 4. Latest approved AI recommendation run
    opt_runs = db.query("optimization_runs", org_id=org_id, order_by="timestamp", descending=True, limit=1)
    if not opt_runs:
        opt_runs = db.query("optimization_runs", org_id=org_id, order_by="created_at", descending=True, limit=1)

    cached_recommendations = None
    if opt_runs:
        latest = opt_runs[0]
        recs = latest.get("recommendations") or latest.get("optimized", {}).get("recommendations", [])
        wh_recs = [r for r in recs if r.get("source_warehouse_id") == assigned_wh or r.get("destination_id") == assigned_wh]
        cached_recommendations = {
            "run_id": latest.get("run_id") or latest.get("id"),
            "generated_at": latest.get("timestamp") or latest.get("created_at"),
            "is_cached": True,
            "disclaimer": "Authoritative cached plan. Local inventory movements may alter optimal allocations until server recalculation.",
            "recommendations": wh_recs[:10],
            "total_allocated": latest.get("total_allocated_units"),
            "savings_percent": latest.get("savings_percent") or latest.get("cost_savings_pct"),
        }

    # Generate content checksum
    payload_raw = json.dumps({"cat": catalogue, "inv": inventory_summary, "bat": batches_summary}, sort_keys=True)
    checksum = hashlib.sha256(payload_raw.encode("utf-8")).hexdigest()[:16]

    server_time = datetime.now(timezone.utc).isoformat()

    return {
        "warehouse": {
            "id": assigned_wh,
            "name": wh_doc.get("name", assigned_wh) if wh_doc else assigned_wh,
            "city": wh_doc.get("city", "Rural Depot") if wh_doc else "Rural Depot",
        },
        "server_time": server_time,
        "checksum": checksum,
        "products": catalogue,
        "inventory": inventory_summary,
        "batches": batches_summary,
        "recommendations": cached_recommendations,
        "low_stock_count": len([i for i in inventory_summary if i["available_quantity"] <= i["safety_stock"]]),
    }


# -----------------------------------------------------------------------------
# 2. Batch Offline Synchronization & Conflict Detection
# -----------------------------------------------------------------------------
@router.post("/sync", summary="Synchronize batch of queued offline transactions")
def sync_ruralreach_transactions(
    req: RuralReachSyncRequest,
    current_user: dict = Depends(get_current_user)
) -> Dict[str, Any]:
    """
    Processes queued offline transactions with ACID safety and idempotency:
    - Rejects duplicate transaction IDs without re-applying movements
    - Executes mutations sequentially inside authoritative ledger
    - Detects negative stock / stockout conflicts and flags as NEEDS_REVIEW
    - Returns itemized success/conflict outcomes and fresh inventory delta
    """
    org_id = current_user["org_id"]
    validate_warehouse_access(current_user, req.warehouse_id)

    results: List[Dict[str, Any]] = []
    committed_count = 0
    conflict_count = 0
    now_iso = datetime.now(timezone.utc).isoformat()

    for item in req.transactions:
        txn_id = item.transaction_id
        action = item.action.upper()
        p = item.payload

        # 1. Idempotency Check
        existing_key = db.get_document("processed_idempotency_keys", txn_id) or db.get_document("idempotency_keys", txn_id)
        if existing_key:
            results.append({
                "transaction_id": txn_id,
                "status": "ALREADY_COMMITTED",
                "message": "Transaction was already committed to authoritative ledger in an earlier sync.",
                "server_confirmed_at": existing_key.get("timestamp") or existing_key.get("created_at") or now_iso,
            })
            continue

        # 2. Process by Action Type
        try:
            if action == "RECEIVE":
                # Inbound stock receipt
                now_dt = datetime.now(timezone.utc)
                mfg_date_val = p.get("mfg_date") or now_dt.strftime("%Y-%m-%d")
                exp_date_val = p.get("expiry_date") or (now_dt.date() + timedelta(days=365)).strftime("%Y-%m-%d")

                rec_req = ReceiveStockRequest(
                    warehouse_id=req.warehouse_id,
                    product_id=p["product_id"],
                    quantity=int(p["quantity"]),
                    batch_number=p.get("batch_number", f"RURAL-{uuid.uuid4().hex[:6].upper()}"),
                    supplier_reference=p.get("supplier_reference", "Rural Direct Hub"),
                    unit_cost=float(p.get("unit_cost", 10.0)),
                    storage_bin=p.get("storage_bin", "RURAL-STAGING"),
                    mfg_date=mfg_date_val,
                    expiry_date=exp_date_val,
                    correlation_id=txn_id,
                    notes=f"RuralReach Offline Sync: {item.client_notes or 'Local Inbound'}"
                )
                commit_res = InventoryService.receive_stock(
                    req=rec_req,
                    actor_id=current_user["id"],
                    actor_name=current_user.get("full_name", "Rural Operator"),
                    actor_role=current_user.get("role", "operator"),
                    user_warehouse_id=req.warehouse_id,
                    org_id=org_id
                )
                committed_count += 1
                results.append({
                    "transaction_id": txn_id,
                    "status": "COMMITTED",
                    "action": action,
                    "batch_id": commit_res["batch"]["id"],
                    "server_confirmed_at": now_iso,
                    "message": f"Successfully committed receipt of {p['quantity']} units."
                })

            elif action == "DISPATCH":
                # Outbound dispatch / local sale
                # Check authoritative stock availability before mutating
                inv_items = db.query(
                    "inventory",
                    filters={"warehouse_id": req.warehouse_id, "product_id": p["product_id"]},
                    org_id=org_id
                )
                available = inv_items[0].get("available_quantity", 0) if inv_items else 0
                qty_needed = int(p["quantity"])

                if available < qty_needed:
                    # Concurrency Conflict: Offline dispatch exceeds central server stock
                    conflict_doc = {
                        "id": f"CONF-{txn_id[:12]}",
                        "transaction_id": txn_id,
                        "device_id": req.device_id,
                        "warehouse_id": req.warehouse_id,
                        "product_id": p["product_id"],
                        "requested_quantity": qty_needed,
                        "server_available_quantity": available,
                        "action": action,
                        "reason": f"Insufficient server stock ({available} available vs {qty_needed} requested). Another operator or central shipment may have allocated this stock while offline.",
                        "status": "NEEDS_REVIEW",
                        "payload": p,
                        "org_id": org_id,
                        "created_at": now_iso,
                        "updated_at": now_iso,
                    }
                    db.set_document("ruralreach_conflicts", conflict_doc["id"], conflict_doc)
                    conflict_count += 1
                    results.append({
                        "transaction_id": txn_id,
                        "status": "NEEDS_REVIEW",
                        "conflict_id": conflict_doc["id"],
                        "message": conflict_doc["reason"],
                        "server_available": available,
                        "requested": qty_needed
                    })
                else:
                    disp_req = DispatchStockRequest(
                        warehouse_id=req.warehouse_id,
                        product_id=p["product_id"],
                        quantity=qty_needed,
                        destination_id=p.get("destination_id", "RURAL_RETAIL_OUTLET"),
                        correlation_id=txn_id,
                        notes=f"RuralReach Offline Sync: {item.client_notes or 'Local Dispatch'}"
                    )
                    commit_res = InventoryService.dispatch_stock(
                        req=disp_req,
                        actor_id=current_user["id"],
                        actor_name=current_user.get("full_name", "Rural Operator"),
                        actor_role=current_user.get("role", "operator"),
                        user_warehouse_id=req.warehouse_id,
                        org_id=org_id
                    )
                    committed_count += 1
                    results.append({
                        "transaction_id": txn_id,
                        "status": "COMMITTED",
                        "action": action,
                        "movement_id": commit_res["movement"]["id"],
                        "server_confirmed_at": now_iso,
                        "message": f"Successfully committed dispatch of {qty_needed} units."
                    })

            elif action == "DAMAGE_REPORT":
                batch_doc = db.get_document("inventory_batches", p["batch_id"])
                prod_id = p.get("product_id") or (batch_doc.get("product_id") if batch_doc else "")
                dmg_req = DamageReportRequest(
                    correlation_id=txn_id,
                    warehouse_id=req.warehouse_id,
                    product_id=prod_id,
                    batch_id=p["batch_id"],
                    damaged_quantity=int(p["damaged_quantity"]),
                    reason=p.get("reason", "Reported damaged in rural transit/depot"),
                    photo_url=p.get("photo_url")
                )
                commit_res = InventoryService.report_damage(
                    req=dmg_req,
                    actor_id=current_user["id"],
                    actor_name=current_user.get("full_name", "Rural Operator"),
                    actor_role=current_user.get("role", "operator"),
                    user_warehouse_id=req.warehouse_id,
                    org_id=org_id
                )
                committed_count += 1
                results.append({
                    "transaction_id": txn_id,
                    "status": "COMMITTED",
                    "action": action,
                    "server_confirmed_at": now_iso,
                    "message": f"Reported {p['damaged_quantity']} units as damaged/quarantined."
                })

            elif action == "CYCLE_COUNT":
                batch_doc = db.get_document("inventory_batches", p["batch_id"])
                prod_id = p.get("product_id") or (batch_doc.get("product_id") if batch_doc else "")
                storage_bin = p.get("storage_bin") or (batch_doc.get("storage_bin") if batch_doc else "General")
                cnt_req = CycleCountRequest(
                    correlation_id=txn_id,
                    warehouse_id=req.warehouse_id,
                    product_id=prod_id,
                    batch_id=p["batch_id"],
                    counted_quantity=int(p["counted_quantity"]),
                    storage_bin=storage_bin,
                    notes=p.get("notes", "RuralReach physical count")
                )
                commit_res = InventoryService.cycle_count(
                    req=cnt_req,
                    actor_id=current_user["id"],
                    actor_name=current_user.get("full_name", "Rural Operator"),
                    actor_role=current_user.get("role", "operator"),
                    user_warehouse_id=req.warehouse_id,
                    org_id=org_id
                )
                committed_count += 1
                results.append({
                    "transaction_id": txn_id,
                    "status": "COMMITTED",
                    "action": action,
                    "variance": commit_res.get("variance", 0),
                    "server_confirmed_at": now_iso,
                    "message": "Physical cycle count recorded."
                })

            elif action == "DELIVERY_CONFIRM":
                # Confirm delivery or transfer receipt
                transfer_id = p.get("transfer_id")
                if transfer_id:
                    trf = InventoryService.receive_transfer(
                        transfer_id=transfer_id,
                        actor_id=current_user["id"],
                        actor_name=current_user.get("full_name", "Rural Operator"),
                        actor_role=current_user.get("role", "operator"),
                        user_warehouse_id=req.warehouse_id,
                        org_id=org_id,
                        notes="Confirmed delivered via RuralReach Offline Client"
                    )
                    committed_count += 1
                    results.append({
                        "transaction_id": txn_id,
                        "status": "COMMITTED",
                        "action": action,
                        "transfer_id": transfer_id,
                        "server_confirmed_at": now_iso,
                        "message": f"Delivery confirmed for transfer {trf.get('transfer_number')}."
                    })
                else:
                    results.append({
                        "transaction_id": txn_id,
                        "status": "REJECTED",
                        "message": "Missing transfer_id in delivery confirmation payload."
                    })

            else:
                results.append({
                    "transaction_id": txn_id,
                    "status": "REJECTED",
                    "message": f"Unsupported RuralReach action type: '{action}'."
                })

        except HTTPException as he:
            if he.status_code == 409 and ("already executed" in str(he.detail) or "Duplicate submission" in str(he.detail)):
                results.append({
                    "transaction_id": txn_id,
                    "status": "ALREADY_COMMITTED",
                    "message": "Transaction was already committed to authoritative ledger in an earlier sync.",
                    "server_confirmed_at": now_iso,
                })
                continue

            # Domain exception: flag as NEEDS_REVIEW rather than dropping
            conflict_doc = {
                "id": f"CONF-{txn_id[:12]}",
                "transaction_id": txn_id,
                "device_id": req.device_id,
                "warehouse_id": req.warehouse_id,
                "action": action,
                "reason": he.detail,
                "status": "NEEDS_REVIEW",
                "payload": p,
                "org_id": org_id,
                "created_at": now_iso,
                "updated_at": now_iso,
            }
            db.set_document("ruralreach_conflicts", conflict_doc["id"], conflict_doc)
            conflict_count += 1
            results.append({
                "transaction_id": txn_id,
                "status": "NEEDS_REVIEW",
                "conflict_id": conflict_doc["id"],
                "message": he.detail,
            })

        except Exception as e:
            results.append({
                "transaction_id": txn_id,
                "status": "REJECTED",
                "message": f"Internal error executing transaction: {str(e)}"
            })

    # Return refreshed inventory delta for the warehouse
    fresh_inventory = db.query("inventory", filters={"warehouse_id": req.warehouse_id}, org_id=org_id)

    return {
        "success": True,
        "synced_count": committed_count,
        "conflict_count": conflict_count,
        "total_processed": len(req.transactions),
        "results": results,
        "synced_at": now_iso,
        "inventory": [
            {
                "product_id": i["product_id"],
                "available_quantity": i.get("available_quantity", 0),
                "reserved_quantity": i.get("reserved_quantity", 0),
            }
            for i in fresh_inventory
        ]
    }


# -----------------------------------------------------------------------------
# 3. Conflict Review & Resolution Endpoints
# -----------------------------------------------------------------------------
@router.get("/conflicts", summary="List unresolved inventory sync conflicts")
def list_ruralreach_conflicts(
    warehouse_id: Optional[str] = Query(None),
    current_user: dict = Depends(require_permission(PERM_INVENTORY_VIEW))
) -> List[Dict[str, Any]]:
    """List offline synchronization conflicts flagged as 'NEEDS_REVIEW'."""
    org_id = current_user["org_id"]
    assigned_wh = warehouse_id or current_user.get("warehouse_id")

    filters = {"status": "NEEDS_REVIEW"}
    if assigned_wh and assigned_wh != "all":
        validate_warehouse_access(current_user, assigned_wh)
        filters["warehouse_id"] = assigned_wh

    conflicts = db.query("ruralreach_conflicts", filters=filters, org_id=org_id, order_by="created_at", descending=True)
    return conflicts


@router.post("/conflicts/{conflict_id}/resolve", summary="Resolve a flagged sync conflict")
def resolve_ruralreach_conflict(
    conflict_id: str,
    req: ConflictResolutionRequest,
    current_user: dict = Depends(require_permission(PERM_INVENTORY_DISPATCH))
) -> Dict[str, Any]:
    """
    Allows a manager to review and resolve a conflicting offline transaction:
    - DISCARD_DRAFT: Discards the conflicting draft without mutating server ledger.
    - APPROVE_OVERRIDE: Forces inventory adjustment to account for the discrepancy.
    - ADJUST_DIFFERENCE: Adjusts server stock to match local ground reality.
    """
    org_id = current_user["org_id"]
    doc = db.get_document("ruralreach_conflicts", conflict_id)
    if not doc or doc.get("org_id") != org_id:
        raise HTTPException(status_code=404, detail="Conflict record not found.")

    validate_warehouse_access(current_user, doc.get("warehouse_id"))

    now_iso = datetime.now(timezone.utc).isoformat()
    action = req.resolution_action.upper()

    if action == "DISCARD_DRAFT":
        doc["status"] = "DISCARDED"
        doc["resolution_notes"] = req.notes or "Discarded by manager."
        doc["resolved_by"] = current_user["id"]
        doc["resolved_at"] = now_iso
        db.set_document("ruralreach_conflicts", conflict_id, doc)
        return {"status": "DISCARDED", "conflict_id": conflict_id, "message": "Conflict dismissed. Draft discarded."}

    elif action in ("APPROVE_OVERRIDE", "ADJUST_DIFFERENCE"):
        # Adjust server inventory
        product_id = doc.get("product_id")
        wh_id = doc.get("warehouse_id")
        adj_qty = req.adjusted_quantity if req.adjusted_quantity is not None else doc.get("requested_quantity", 0)

        # Record adjustment
        batches = db.query("inventory_batches", filters={"warehouse_id": wh_id, "product_id": product_id}, org_id=org_id)
        if batches:
            target_batch = batches[0]
            from app.models.domain import StockAdjustmentRequest
            adj_req = StockAdjustmentRequest(
                batch_id=target_batch["id"],
                new_quantity=max(0, target_batch.get("quantity", 0) - adj_qty),
                reason=f"RuralReach Conflict Override: {req.notes or 'Manager adjustment'}",
                correlation_id=f"RES-{uuid.uuid4().hex[:8]}"
            )
            InventoryService.adjust_stock(
                req=adj_req,
                actor_id=current_user["id"],
                actor_name=current_user.get("full_name", "Manager"),
                actor_role=current_user.get("role", "warehouse_manager"),
                user_warehouse_id=wh_id,
                org_id=org_id
            )

        doc["status"] = "RESOLVED"
        doc["resolution_notes"] = req.notes or f"Resolved with action: {action}"
        doc["resolved_by"] = current_user["id"]
        doc["resolved_at"] = now_iso
        db.set_document("ruralreach_conflicts", conflict_id, doc)

        return {"status": "RESOLVED", "conflict_id": conflict_id, "message": f"Conflict successfully resolved via {action}."}

    else:
        raise HTTPException(status_code=400, detail=f"Invalid resolution action: '{req.resolution_action}'.")
