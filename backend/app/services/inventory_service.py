import uuid
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from fastapi import HTTPException, status
from app.core.database import db
from app.models.domain import (
    ReceiveStockRequest,
    DispatchStockRequest,
    StockAdjustmentRequest,
    DamageReportRequest,
    InterWarehouseTransfer,
    TransferStatus,
    TransferItem
)

class InventoryService:
    @staticmethod
    def _check_idempotency(correlation_id: str) -> None:
        if not correlation_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A unique correlation_id is required for inventory mutations to guarantee idempotency."
            )
        existing = db.get_document("processed_idempotency_keys", correlation_id)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Operation with correlation_id '{correlation_id}' was already executed at {existing.get('timestamp')}. Duplicate submission prevented."
            )

    @staticmethod
    def receive_stock(req: ReceiveStockRequest, actor_id: str, actor_name: str, org_id: str) -> Dict[str, Any]:
        """
        Atomically records new stock receipt into a batch and warehouse inventory,
        updating the append-only ledger.
        """
        InventoryService._check_idempotency(req.correlation_id)
        
        if req.quantity <= 0:
            raise HTTPException(status_code=400, detail="Received quantity must be strictly positive.")

        def txn(store):
            now_iso = datetime.now(timezone.utc).isoformat()
            
            # 1. Verify warehouse and product exist and belong to org
            wh = store.get_document("warehouses", req.warehouse_id)
            if not wh or wh.get("org_id") != org_id:
                raise HTTPException(status_code=404, detail="Warehouse not found or unauthorized.")

            prd = store.get_document("products", req.product_id)
            if not prd or prd.get("org_id") != org_id:
                raise HTTPException(status_code=404, detail="Product not found or unauthorized.")

            # 2. Find or create batch
            batch_id = f"bat_{req.warehouse_id}_{req.batch_number.replace(' ', '_')}"
            existing_batch = store.get_document("inventory_batches", batch_id)
            
            if existing_batch:
                new_batch_qty = existing_batch["quantity"] + req.quantity
                updated_batch = {
                    **existing_batch,
                    "quantity": new_batch_qty,
                    "updated_at": now_iso
                }
            else:
                updated_batch = {
                    "id": batch_id,
                    "org_id": org_id,
                    "warehouse_id": req.warehouse_id,
                    "product_id": req.product_id,
                    "batch_number": req.batch_number,
                    "supplier_reference": req.supplier_reference,
                    "mfg_date": req.mfg_date,
                    "expiry_date": req.expiry_date,
                    "quantity": req.quantity,
                    "reserved_quantity": 0,
                    "damaged_quantity": 0,
                    "unit_cost": req.unit_cost,
                    "storage_bin": req.storage_bin,
                    "qr_code_id": f"STOCKPILOT://BATCH/{req.batch_number}/WH/{req.warehouse_id}",
                    "status": "active",
                    "created_at": now_iso,
                    "updated_at": now_iso
                }
            store.set_document("inventory_batches", batch_id, updated_batch)

            # 3. Update warehouse-level inventory aggregate
            inv_key = f"inv_{req.warehouse_id}_{req.product_id}"
            existing_inv = store.get_document("inventory", inv_key)
            if existing_inv:
                total_qty = existing_inv["total_quantity"] + req.quantity
                avail_qty = existing_inv["available_quantity"] + req.quantity
                updated_inv = {
                    **existing_inv,
                    "total_quantity": total_qty,
                    "available_quantity": avail_qty,
                    "updated_at": now_iso
                }
            else:
                updated_inv = {
                    "id": inv_key,
                    "org_id": org_id,
                    "warehouse_id": req.warehouse_id,
                    "product_id": req.product_id,
                    "total_quantity": req.quantity,
                    "reserved_quantity": 0,
                    "available_quantity": req.quantity,
                    "damaged_quantity": 0,
                    "in_transit_quantity": 0,
                    "safety_stock": prd.get("min_safety_stock", 50),
                    "reorder_point": prd.get("reorder_point", 100),
                    "created_at": now_iso,
                    "updated_at": now_iso
                }
            store.set_document("inventory", inv_key, updated_inv)

            # 4. Record in immutable movement ledger
            movement_id = f"mov_{uuid.uuid4().hex[:12]}"
            movement = {
                "id": movement_id,
                "org_id": org_id,
                "correlation_id": req.correlation_id,
                "product_id": req.product_id,
                "batch_id": batch_id,
                "source_warehouse_id": None,
                "destination_id": req.warehouse_id,
                "movement_type": "receipt",
                "quantity_changed": req.quantity,
                "balance_after": updated_inv["available_quantity"],
                "actor_id": actor_id,
                "actor_name": actor_name,
                "reason": req.notes or f"Stock receipt for batch {req.batch_number}",
                "timestamp": now_iso
            }
            store.set_document("inventory_movements", movement_id, movement)

            # 5. Record idempotency key
            store.set_document("processed_idempotency_keys", req.correlation_id, {
                "correlation_id": req.correlation_id,
                "action": "receive_stock",
                "actor_id": actor_id,
                "timestamp": now_iso
            })

            return {
                "success": True,
                "batch": updated_batch,
                "inventory": updated_inv,
                "movement": movement
            }

        return db.run_transaction(txn)

    @staticmethod
    def dispatch_stock(req: DispatchStockRequest, actor_id: str, actor_name: str, org_id: str) -> Dict[str, Any]:
        """
        Atomically dispatches stock. Supports FEFO (First Expired First Out) automatic batch selection
        if no batch_id is explicitly specified. Validates available non-reserved inventory.
        """
        InventoryService._check_idempotency(req.correlation_id)

        if req.quantity <= 0:
            raise HTTPException(status_code=400, detail="Dispatch quantity must be strictly positive.")

        def txn(store):
            now_iso = datetime.now(timezone.utc).isoformat()
            inv_key = f"inv_{req.warehouse_id}_{req.product_id}"
            inv = store.get_document("inventory", inv_key)
            
            if not inv or inv.get("org_id") != org_id:
                raise HTTPException(status_code=404, detail="Inventory record not found.")

            if inv["available_quantity"] < req.quantity:
                raise HTTPException(
                    status_code=400,
                    detail=f"Insufficient available stock. Requested: {req.quantity}, Available: {inv['available_quantity']}"
                )

            # Batch deduction
            batches = store.query(
                "inventory_batches",
                filters={"warehouse_id": req.warehouse_id, "product_id": req.product_id, "status": "active"},
                org_id=org_id,
                order_by="expiry_date",
                descending=False # FEFO: earliest expiry first
            )

            if not batches:
                raise HTTPException(status_code=400, detail="No active batches found for this product in warehouse.")

            remaining_to_deduct = req.quantity
            deducted_batches = []

            if req.batch_id:
                target_batch = store.get_document("inventory_batches", req.batch_id)
                if not target_batch or target_batch["warehouse_id"] != req.warehouse_id:
                    raise HTTPException(status_code=404, detail="Specified batch not found in this warehouse.")
                available_in_batch = target_batch["quantity"] - target_batch.get("reserved_quantity", 0) - target_batch.get("damaged_quantity", 0)
                if available_in_batch < req.quantity:
                    raise HTTPException(status_code=400, detail=f"Batch has only {available_in_batch} available units.")
                
                target_batch["quantity"] -= req.quantity
                if target_batch["quantity"] == 0:
                    target_batch["status"] = "depleted"
                store.set_document("inventory_batches", target_batch["id"], target_batch)
                deducted_batches.append({"batch_id": target_batch["id"], "quantity": req.quantity})
            else:
                # Automatic FEFO deduction across batches
                for b in batches:
                    if remaining_to_deduct <= 0:
                        break
                    avail = b["quantity"] - b.get("reserved_quantity", 0) - b.get("damaged_quantity", 0)
                    if avail <= 0:
                        continue
                    deduct = min(avail, remaining_to_deduct)
                    b["quantity"] -= deduct
                    if b["quantity"] == 0:
                        b["status"] = "depleted"
                    store.set_document("inventory_batches", b["id"], b)
                    deducted_batches.append({"batch_id": b["id"], "quantity": deduct, "expiry_date": b["expiry_date"]})
                    remaining_to_deduct -= deduct

                if remaining_to_deduct > 0:
                    raise HTTPException(status_code=400, detail="Unable to satisfy entire quantity across available active batches.")

            # Update inventory totals
            inv["total_quantity"] -= req.quantity
            inv["available_quantity"] -= req.quantity
            inv["updated_at"] = now_iso
            store.set_document("inventory", inv_key, inv)

            # Record movement ledger
            movement_id = f"mov_{uuid.uuid4().hex[:12]}"
            movement = {
                "id": movement_id,
                "org_id": org_id,
                "correlation_id": req.correlation_id,
                "product_id": req.product_id,
                "batch_id": deducted_batches[0]["batch_id"] if deducted_batches else None,
                "source_warehouse_id": req.warehouse_id,
                "destination_id": req.destination_id,
                "movement_type": "dispatch",
                "quantity_changed": -req.quantity,
                "balance_after": inv["available_quantity"],
                "actor_id": actor_id,
                "actor_name": actor_name,
                "reason": req.reason,
                "timestamp": now_iso
            }
            store.set_document("inventory_movements", movement_id, movement)

            # Record idempotency
            store.set_document("processed_idempotency_keys", req.correlation_id, {
                "correlation_id": req.correlation_id,
                "action": "dispatch_stock",
                "actor_id": actor_id,
                "timestamp": now_iso
            })

            return {
                "success": True,
                "deducted_batches": deducted_batches,
                "inventory": inv,
                "movement": movement
            }

        return db.run_transaction(txn)

    @staticmethod
    def adjust_stock(req: StockAdjustmentRequest, actor_id: str, actor_name: str, org_id: str) -> Dict[str, Any]:
        """
        Cycle count / adjustment: updates batch and inventory quantities and logs discrepancy.
        """
        InventoryService._check_idempotency(req.correlation_id)
        if req.new_quantity < 0:
            raise HTTPException(status_code=400, detail="New quantity cannot be negative.")

        def txn(store):
            now_iso = datetime.now(timezone.utc).isoformat()
            batch = store.get_document("inventory_batches", req.batch_id)
            if not batch or batch.get("org_id") != org_id:
                raise HTTPException(status_code=404, detail="Batch not found.")

            diff = req.new_quantity - batch["quantity"]
            batch["quantity"] = req.new_quantity
            batch["updated_at"] = now_iso
            store.set_document("inventory_batches", batch["id"], batch)

            inv_key = f"inv_{req.warehouse_id}_{req.product_id}"
            inv = store.get_document("inventory", inv_key)
            if inv:
                inv["total_quantity"] += diff
                inv["available_quantity"] += diff
                inv["updated_at"] = now_iso
                store.set_document("inventory", inv_key, inv)

            # Append to ledger
            movement_id = f"mov_{uuid.uuid4().hex[:12]}"
            movement = {
                "id": movement_id,
                "org_id": org_id,
                "correlation_id": req.correlation_id,
                "product_id": req.product_id,
                "batch_id": req.batch_id,
                "source_warehouse_id": req.warehouse_id,
                "destination_id": None,
                "movement_type": "adjustment",
                "quantity_changed": diff,
                "balance_after": inv["available_quantity"] if inv else req.new_quantity,
                "actor_id": actor_id,
                "actor_name": actor_name,
                "reason": f"Inventory cycle count adjustment: {req.reason}",
                "timestamp": now_iso
            }
            store.set_document("inventory_movements", movement_id, movement)

            store.set_document("processed_idempotency_keys", req.correlation_id, {
                "correlation_id": req.correlation_id,
                "action": "adjust_stock",
                "actor_id": actor_id,
                "timestamp": now_iso
            })

            return {"success": True, "difference": diff, "batch": batch, "inventory": inv, "movement": movement}

        return db.run_transaction(txn)

    @staticmethod
    def report_damage(req: DamageReportRequest, actor_id: str, actor_name: str, org_id: str) -> Dict[str, Any]:
        """
        Reports damaged items: deducts from available stock and marks as damaged.
        """
        InventoryService._check_idempotency(req.correlation_id)
        if req.damaged_quantity <= 0:
            raise HTTPException(status_code=400, detail="Damaged quantity must be greater than zero.")

        def txn(store):
            now_iso = datetime.now(timezone.utc).isoformat()
            batch = store.get_document("inventory_batches", req.batch_id)
            if not batch or batch.get("org_id") != org_id:
                raise HTTPException(status_code=404, detail="Batch not found.")

            avail = batch["quantity"] - batch.get("reserved_quantity", 0) - batch.get("damaged_quantity", 0)
            if req.damaged_quantity > avail:
                raise HTTPException(status_code=400, detail=f"Cannot mark {req.damaged_quantity} damaged. Available in batch: {avail}")

            batch["damaged_quantity"] = batch.get("damaged_quantity", 0) + req.damaged_quantity
            batch["updated_at"] = now_iso
            store.set_document("inventory_batches", batch["id"], batch)

            inv_key = f"inv_{req.warehouse_id}_{req.product_id}"
            inv = store.get_document("inventory", inv_key)
            if inv:
                inv["available_quantity"] -= req.damaged_quantity
                inv["damaged_quantity"] = inv.get("damaged_quantity", 0) + req.damaged_quantity
                inv["updated_at"] = now_iso
                store.set_document("inventory", inv_key, inv)

            movement_id = f"mov_{uuid.uuid4().hex[:12]}"
            movement = {
                "id": movement_id,
                "org_id": org_id,
                "correlation_id": req.correlation_id,
                "product_id": req.product_id,
                "batch_id": req.batch_id,
                "source_warehouse_id": req.warehouse_id,
                "destination_id": None,
                "movement_type": "damage_report",
                "quantity_changed": -req.damaged_quantity,
                "balance_after": inv["available_quantity"] if inv else 0,
                "actor_id": actor_id,
                "actor_name": actor_name,
                "reason": f"Damage report: {req.reason}",
                "timestamp": now_iso
            }
            store.set_document("inventory_movements", movement_id, movement)

            store.set_document("processed_idempotency_keys", req.correlation_id, {
                "correlation_id": req.correlation_id,
                "action": "report_damage",
                "actor_id": actor_id,
                "timestamp": now_iso
            })

            return {"success": True, "batch": batch, "inventory": inv, "movement": movement}

        return db.run_transaction(txn)

    @staticmethod
    def approve_or_reject_transfer(
        transfer_id: str,
        approved: bool,
        actor_id: str,
        actor_name: str,
        org_id: str,
        notes: str = ""
    ) -> Dict[str, Any]:
        """
        Concurrency-safe transfer approval/rejection. Prevents double-approvals or double-dispatch.
        """
        def txn(store):
            now_iso = datetime.now(timezone.utc).isoformat()
            trf = store.get_document("transfers", transfer_id)
            if not trf or trf.get("org_id") != org_id:
                raise HTTPException(status_code=404, detail="Transfer not found.")

            if trf["status"] != TransferStatus.PENDING:
                raise HTTPException(
                    status_code=400,
                    detail=f"Transfer is already '{trf['status']}'. It cannot be approved or rejected again."
                )

            if approved:
                trf["status"] = TransferStatus.IN_TRANSIT
                trf["approved_by_id"] = actor_id
                trf["approved_by_name"] = actor_name
                trf["updated_at"] = now_iso
                trf["notes"] = f"{trf.get('notes', '')} | Approved: {notes}".strip(" |")

                # Move source stock from available to reserved / in-transit
                for item in trf["items"]:
                    inv_key = f"inv_{trf['source_warehouse_id']}_{item['product_id']}"
                    inv = store.get_document("inventory", inv_key)
                    if inv:
                        inv["available_quantity"] -= item["quantity"]
                        inv["in_transit_quantity"] = inv.get("in_transit_quantity", 0) + item["quantity"]
                        store.set_document("inventory", inv_key, inv)
            else:
                trf["status"] = TransferStatus.REJECTED
                trf["approved_by_id"] = actor_id
                trf["approved_by_name"] = actor_name
                trf["updated_at"] = now_iso
                trf["notes"] = f"{trf.get('notes', '')} | Rejected: {notes}".strip(" |")

            store.set_document("transfers", transfer_id, trf)
            return trf

        return db.run_transaction(txn)
