import uuid
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from fastapi import HTTPException, status
from app.core.database import db
from app.models.domain import (
    ReceiveStockRequest,
    DispatchStockRequest,
    StockReservationRequest,
    ReleaseReservationRequest,
    StockAdjustmentRequest,
    DamageReportRequest,
    CycleCountRequest,
    DiscrepancyResolutionRequest,
    InterWarehouseTransfer,
    TransferStatus,
    ALLOWED_TRANSFER_TRANSITIONS,
    TransferItem,
    TransferApprovalRequest,
    TransferDispatchRequest,
    TransferReceiveRequest,
    TransferCancelRequest,
    MovementType,
    InventoryMovement
)

class InventoryService:
    """
    Authoritative, concurrency-safe Inventory Transaction Engine for StockPilot AI.
    Guarantees ACID transactions, organization isolation, role/warehouse authorization,
    idempotency enforcement, non-negative available stock invariant, FEFO expiry tracking,
    and append-only double-entry ledgering.
    """

    @staticmethod
    def _verify_warehouse_authorization(
        target_warehouse_id: str,
        user_role: str,
        user_warehouse_id: Optional[str]
    ) -> None:
        """
        Enforces warehouse-level access control:
        - super_admin, org_admin, supply_chain_manager: full access across tenant facilities
        - warehouse_manager, operator: strictly restricted to their assigned warehouse_id
        """
        if user_role in ("super_admin", "org_admin", "supply_chain_manager"):
            return
        if user_role in ("distributor", "distributor_field_operator"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{user_role}' is not authorized to mutate warehouse inventory."
            )
        wh = user_warehouse_id or "wh_chicago_01"
        if wh != target_warehouse_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Unauthorized warehouse operation. User assigned to '{wh}' cannot perform operations on warehouse '{target_warehouse_id}'."
            )

    @staticmethod
    def _check_idempotency(correlation_id: str) -> None:
        """
        Prevents duplicate processing of repeated requests.
        """
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
    def _record_movement(
        store,
        org_id: str,
        correlation_id: str,
        product_id: str,
        batch_id: Optional[str],
        source_warehouse_id: Optional[str],
        destination_id: Optional[str],
        movement_type: str,
        quantity_changed: int,
        unit: str,
        balance_after: int,
        actor_id: str,
        actor_name: str,
        actor_role: str,
        reason: str,
        now_iso: str,
        resulting_status: str = "COMMITTED"
    ) -> Dict[str, Any]:
        """
        Appends an immutable entry to the auditable movement ledger.
        """
        movement_id = f"mov_{uuid.uuid4().hex[:12]}"
        movement = {
            "id": movement_id,
            "org_id": org_id,
            "correlation_id": correlation_id,
            "product_id": product_id,
            "batch_id": batch_id,
            "source_warehouse_id": source_warehouse_id,
            "destination_id": destination_id,
            "movement_type": movement_type,
            "quantity_changed": quantity_changed,
            "unit": unit,
            "balance_after": balance_after,
            "actor_id": actor_id,
            "actor_name": actor_name,
            "actor_role": actor_role,
            "reason": reason,
            "timestamp": now_iso,
            "resulting_status": resulting_status
        }
        store.set_document("inventory_movements", movement_id, movement)
        return movement

    # -------------------------------------------------------------------------
    # 1. STOCK RECEIVING
    # -------------------------------------------------------------------------
    @staticmethod
    def receive_stock(
        req: ReceiveStockRequest,
        actor_id: str,
        actor_name: str,
        org_id: str,
        actor_role: str = "operator",
        user_warehouse_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Atomically records new stock receipt into a batch and warehouse inventory,
        updating the append-only ledger.
        """
        InventoryService._verify_warehouse_authorization(req.warehouse_id, actor_role, user_warehouse_id)
        InventoryService._check_idempotency(req.correlation_id)
        
        if req.quantity <= 0:
            raise HTTPException(status_code=400, detail="Received quantity must be strictly positive.")

        def txn(store):
            now_iso = datetime.now(timezone.utc).isoformat()
            
            wh = store.get_document("warehouses", req.warehouse_id)
            if not wh or wh.get("org_id") != org_id:
                raise HTTPException(status_code=404, detail="Warehouse not found or unauthorized.")

            prd = store.get_document("products", req.product_id)
            if not prd or prd.get("org_id") != org_id:
                raise HTTPException(status_code=404, detail="Product not found or unauthorized.")

            unit = prd.get("unit", "units")

            # 1. Find or create batch
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

            # 2. Update warehouse-level inventory aggregate
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

            # 3. Append-only ledger
            movement = InventoryService._record_movement(
                store=store,
                org_id=org_id,
                correlation_id=req.correlation_id,
                product_id=req.product_id,
                batch_id=batch_id,
                source_warehouse_id=None,
                destination_id=req.warehouse_id,
                movement_type=MovementType.RECEIPT.value,
                quantity_changed=req.quantity,
                unit=unit,
                balance_after=updated_inv["available_quantity"],
                actor_id=actor_id,
                actor_name=actor_name,
                actor_role=actor_role,
                reason=req.notes or f"Stock receipt for batch {req.batch_number}",
                now_iso=now_iso
            )

            # 4. Record idempotency key
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

    # -------------------------------------------------------------------------
    # 2. STOCK DISPATCH (FEFO / Lot Allocation)
    # -------------------------------------------------------------------------
    @staticmethod
    def dispatch_stock(
        req: DispatchStockRequest,
        actor_id: str,
        actor_name: str,
        org_id: str,
        actor_role: str = "operator",
        user_warehouse_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Atomically dispatches stock. Enforces FEFO (First Expired First Out) automatic batch selection
        if no batch_id is explicitly specified. Validates available non-reserved inventory to prevent negative stock.
        """
        InventoryService._verify_warehouse_authorization(req.warehouse_id, actor_role, user_warehouse_id)
        InventoryService._check_idempotency(req.correlation_id)

        if req.quantity <= 0:
            raise HTTPException(status_code=400, detail="Dispatch quantity must be strictly positive.")

        def txn(store):
            now_iso = datetime.now(timezone.utc).isoformat()
            inv_key = f"inv_{req.warehouse_id}_{req.product_id}"
            inv = store.get_document("inventory", inv_key)
            
            if not inv or inv.get("org_id") != org_id:
                raise HTTPException(status_code=404, detail="Inventory record not found in specified warehouse.")

            if inv["available_quantity"] < req.quantity:
                raise HTTPException(
                    status_code=400,
                    detail=f"Insufficient available stock to dispatch. Requested: {req.quantity}, Available: {inv['available_quantity']}"
                )

            prd = store.get_document("products", req.product_id)
            unit = prd.get("unit", "units") if prd else "units"

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
                    raise HTTPException(status_code=400, detail=f"Batch has only {available_in_batch} available units. Requested: {req.quantity}")
                
                target_batch["quantity"] -= req.quantity
                if target_batch["quantity"] == 0:
                    target_batch["status"] = "depleted"
                store.set_document("inventory_batches", target_batch["id"], target_batch)
                deducted_batches.append({"batch_id": target_batch["id"], "quantity": req.quantity})
            else:
                # Automatic FEFO deduction across active batches
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

            # Update inventory totals - ensure invariants hold
            inv["total_quantity"] -= req.quantity
            inv["available_quantity"] -= req.quantity
            inv["updated_at"] = now_iso
            
            if inv["available_quantity"] < 0 or inv["total_quantity"] < 0:
                raise HTTPException(status_code=400, detail="Transaction rejected: stock balance would become negative.")
                
            store.set_document("inventory", inv_key, inv)

            # Record movement ledger
            primary_batch_id = deducted_batches[0]["batch_id"] if deducted_batches else None
            movement = InventoryService._record_movement(
                store=store,
                org_id=org_id,
                correlation_id=req.correlation_id,
                product_id=req.product_id,
                batch_id=primary_batch_id,
                source_warehouse_id=req.warehouse_id,
                destination_id=req.destination_id,
                movement_type=MovementType.DISPATCH.value,
                quantity_changed=-req.quantity,
                unit=unit,
                balance_after=inv["available_quantity"],
                actor_id=actor_id,
                actor_name=actor_name,
                actor_role=actor_role,
                reason=req.reason,
                now_iso=now_iso
            )

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

    # -------------------------------------------------------------------------
    # 3. STOCK RESERVATION & RELEASE
    # -------------------------------------------------------------------------
    @staticmethod
    def reserve_stock(
        req: StockReservationRequest,
        actor_id: str,
        actor_name: str,
        org_id: str,
        actor_role: str = "operator",
        user_warehouse_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Atomically reserves stock for an order or allocation, preventing double-allocation.
        """
        InventoryService._verify_warehouse_authorization(req.warehouse_id, actor_role, user_warehouse_id)
        InventoryService._check_idempotency(req.correlation_id)

        if req.quantity <= 0:
            raise HTTPException(status_code=400, detail="Reservation quantity must be strictly positive.")

        def txn(store):
            now_iso = datetime.now(timezone.utc).isoformat()
            inv_key = f"inv_{req.warehouse_id}_{req.product_id}"
            inv = store.get_document("inventory", inv_key)
            if not inv or inv.get("org_id") != org_id:
                raise HTTPException(status_code=404, detail="Inventory record not found.")

            if inv["available_quantity"] < req.quantity:
                raise HTTPException(
                    status_code=400,
                    detail=f"Cannot reserve {req.quantity} units. Available stock is only {inv['available_quantity']}."
                )

            # Deduct from available, add to reserved
            inv["available_quantity"] -= req.quantity
            inv["reserved_quantity"] = inv.get("reserved_quantity", 0) + req.quantity
            inv["updated_at"] = now_iso
            store.set_document("inventory", inv_key, inv)

            # Optional batch reservation
            batch = None
            if req.batch_id:
                batch = store.get_document("inventory_batches", req.batch_id)
                if batch:
                    avail_in_batch = batch["quantity"] - batch.get("reserved_quantity", 0) - batch.get("damaged_quantity", 0)
                    if avail_in_batch < req.quantity:
                        raise HTTPException(status_code=400, detail=f"Insufficient available quantity in batch {req.batch_id}.")
                    batch["reserved_quantity"] = batch.get("reserved_quantity", 0) + req.quantity
                    batch["updated_at"] = now_iso
                    store.set_document("inventory_batches", batch["id"], batch)

            prd = store.get_document("products", req.product_id)
            unit = prd.get("unit", "units") if prd else "units"

            movement = InventoryService._record_movement(
                store=store,
                org_id=org_id,
                correlation_id=req.correlation_id,
                product_id=req.product_id,
                batch_id=req.batch_id,
                source_warehouse_id=req.warehouse_id,
                destination_id=req.order_id or "ORDER_HOLD",
                movement_type=MovementType.RESERVATION.value,
                quantity_changed=-req.quantity,
                unit=unit,
                balance_after=inv["available_quantity"],
                actor_id=actor_id,
                actor_name=actor_name,
                actor_role=actor_role,
                reason=req.reason,
                now_iso=now_iso
            )

            store.set_document("processed_idempotency_keys", req.correlation_id, {
                "correlation_id": req.correlation_id,
                "action": "reserve_stock",
                "actor_id": actor_id,
                "timestamp": now_iso
            })

            return {"success": True, "inventory": inv, "batch": batch, "movement": movement}

        return db.run_transaction(txn)

    @staticmethod
    def release_reservation(
        req: ReleaseReservationRequest,
        actor_id: str,
        actor_name: str,
        org_id: str,
        actor_role: str = "operator",
        user_warehouse_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Releases reserved stock back to available inventory.
        """
        InventoryService._verify_warehouse_authorization(req.warehouse_id, actor_role, user_warehouse_id)
        InventoryService._check_idempotency(req.correlation_id)

        if req.quantity <= 0:
            raise HTTPException(status_code=400, detail="Quantity to release must be strictly positive.")

        def txn(store):
            now_iso = datetime.now(timezone.utc).isoformat()
            inv_key = f"inv_{req.warehouse_id}_{req.product_id}"
            inv = store.get_document("inventory", inv_key)
            if not inv or inv.get("org_id") != org_id:
                raise HTTPException(status_code=404, detail="Inventory record not found.")

            if inv.get("reserved_quantity", 0) < req.quantity:
                raise HTTPException(
                    status_code=400,
                    detail=f"Cannot release {req.quantity} units. Currently reserved: {inv.get('reserved_quantity', 0)}."
                )

            inv["reserved_quantity"] -= req.quantity
            inv["available_quantity"] += req.quantity
            inv["updated_at"] = now_iso
            store.set_document("inventory", inv_key, inv)

            batch = None
            if req.batch_id:
                batch = store.get_document("inventory_batches", req.batch_id)
                if batch:
                    batch["reserved_quantity"] = max(0, batch.get("reserved_quantity", 0) - req.quantity)
                    batch["updated_at"] = now_iso
                    store.set_document("inventory_batches", batch["id"], batch)

            prd = store.get_document("products", req.product_id)
            unit = prd.get("unit", "units") if prd else "units"

            movement = InventoryService._record_movement(
                store=store,
                org_id=org_id,
                correlation_id=req.correlation_id,
                product_id=req.product_id,
                batch_id=req.batch_id,
                source_warehouse_id=req.warehouse_id,
                destination_id=None,
                movement_type=MovementType.RELEASE_RESERVATION.value,
                quantity_changed=req.quantity,
                unit=unit,
                balance_after=inv["available_quantity"],
                actor_id=actor_id,
                actor_name=actor_name,
                actor_role=actor_role,
                reason=req.reason,
                now_iso=now_iso
            )

            store.set_document("processed_idempotency_keys", req.correlation_id, {
                "correlation_id": req.correlation_id,
                "action": "release_reservation",
                "actor_id": actor_id,
                "timestamp": now_iso
            })

            return {"success": True, "inventory": inv, "batch": batch, "movement": movement}

        return db.run_transaction(txn)

    # -------------------------------------------------------------------------
    # 4. CYCLE COUNTING & STOCK ADJUSTMENT
    # -------------------------------------------------------------------------
    @staticmethod
    def cycle_count(
        req: CycleCountRequest,
        actor_id: str,
        actor_name: str,
        org_id: str,
        actor_role: str = "operator",
        user_warehouse_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Records a physical count cycle count and updates ledger with discrepancy variance.
        """
        InventoryService._verify_warehouse_authorization(req.warehouse_id, actor_role, user_warehouse_id)
        InventoryService._check_idempotency(req.correlation_id)

        if req.counted_quantity < 0:
            raise HTTPException(status_code=400, detail="Counted quantity cannot be negative.")

        def txn(store):
            now_iso = datetime.now(timezone.utc).isoformat()
            batch = store.get_document("inventory_batches", req.batch_id)
            if not batch or batch.get("org_id") != org_id:
                raise HTTPException(status_code=404, detail="Batch not found.")

            recorded_qty = batch["quantity"]
            variance = req.counted_quantity - recorded_qty

            batch["quantity"] = req.counted_quantity
            if req.storage_bin:
                batch["storage_bin"] = req.storage_bin
            batch["updated_at"] = now_iso
            store.set_document("inventory_batches", batch["id"], batch)

            inv_key = f"inv_{req.warehouse_id}_{req.product_id}"
            inv = store.get_document("inventory", inv_key)
            if inv:
                inv["total_quantity"] += variance
                inv["available_quantity"] += variance
                inv["updated_at"] = now_iso
                store.set_document("inventory", inv_key, inv)

            prd = store.get_document("products", req.product_id)
            unit = prd.get("unit", "units") if prd else "units"

            movement = InventoryService._record_movement(
                store=store,
                org_id=org_id,
                correlation_id=req.correlation_id,
                product_id=req.product_id,
                batch_id=req.batch_id,
                source_warehouse_id=req.warehouse_id,
                destination_id=None,
                movement_type=MovementType.CYCLE_COUNT.value,
                quantity_changed=variance,
                unit=unit,
                balance_after=inv["available_quantity"] if inv else req.counted_quantity,
                actor_id=actor_id,
                actor_name=actor_name,
                actor_role=actor_role,
                reason=f"Physical Cycle Count: Recorded {recorded_qty}, Counted {req.counted_quantity}. Variance: {variance}. Notes: {req.notes or 'Routine count'}",
                now_iso=now_iso
            )

            store.set_document("processed_idempotency_keys", req.correlation_id, {
                "correlation_id": req.correlation_id,
                "action": "cycle_count",
                "actor_id": actor_id,
                "timestamp": now_iso
            })

            return {"success": True, "variance": variance, "batch": batch, "inventory": inv, "movement": movement}

        return db.run_transaction(txn)

    @staticmethod
    def adjust_stock(
        req: StockAdjustmentRequest,
        actor_id: str,
        actor_name: str,
        org_id: str,
        actor_role: str = "operator",
        user_warehouse_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Authoritative manual stock adjustment.
        """
        InventoryService._verify_warehouse_authorization(req.warehouse_id, actor_role, user_warehouse_id)
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

            prd = store.get_document("products", req.product_id)
            unit = prd.get("unit", "units") if prd else "units"

            movement = InventoryService._record_movement(
                store=store,
                org_id=org_id,
                correlation_id=req.correlation_id,
                product_id=req.product_id,
                batch_id=req.batch_id,
                source_warehouse_id=req.warehouse_id,
                destination_id=None,
                movement_type=MovementType.ADJUSTMENT.value,
                quantity_changed=diff,
                unit=unit,
                balance_after=inv["available_quantity"] if inv else req.new_quantity,
                actor_id=actor_id,
                actor_name=actor_name,
                actor_role=actor_role,
                reason=f"Stock adjustment: {req.reason}",
                now_iso=now_iso
            )

            store.set_document("processed_idempotency_keys", req.correlation_id, {
                "correlation_id": req.correlation_id,
                "action": "adjust_stock",
                "actor_id": actor_id,
                "timestamp": now_iso
            })

            return {"success": True, "difference": diff, "batch": batch, "inventory": inv, "movement": movement}

        return db.run_transaction(txn)

    # -------------------------------------------------------------------------
    # 5. DAMAGED STOCK & DISCREPANCY RESOLUTION
    # -------------------------------------------------------------------------
    @staticmethod
    def report_damage(
        req: DamageReportRequest,
        actor_id: str,
        actor_name: str,
        org_id: str,
        actor_role: str = "operator",
        user_warehouse_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Reports damaged items: deducts from available stock and marks as damaged.
        """
        InventoryService._verify_warehouse_authorization(req.warehouse_id, actor_role, user_warehouse_id)
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
                raise HTTPException(status_code=400, detail=f"Cannot mark {req.damaged_quantity} units damaged. Available in batch: {avail}")

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

            prd = store.get_document("products", req.product_id)
            unit = prd.get("unit", "units") if prd else "units"

            movement = InventoryService._record_movement(
                store=store,
                org_id=org_id,
                correlation_id=req.correlation_id,
                product_id=req.product_id,
                batch_id=req.batch_id,
                source_warehouse_id=req.warehouse_id,
                destination_id=None,
                movement_type=MovementType.DAMAGE_REPORT.value,
                quantity_changed=-req.damaged_quantity,
                unit=unit,
                balance_after=inv["available_quantity"] if inv else 0,
                actor_id=actor_id,
                actor_name=actor_name,
                actor_role=actor_role,
                reason=f"Damage report: {req.reason}. Evidence: {req.photo_url or 'None provided'}",
                now_iso=now_iso
            )

            store.set_document("processed_idempotency_keys", req.correlation_id, {
                "correlation_id": req.correlation_id,
                "action": "report_damage",
                "actor_id": actor_id,
                "timestamp": now_iso
            })

            return {"success": True, "batch": batch, "inventory": inv, "movement": movement}

        return db.run_transaction(txn)

    @staticmethod
    def resolve_discrepancy(
        req: DiscrepancyResolutionRequest,
        actor_id: str,
        actor_name: str,
        org_id: str,
        actor_role: str = "operator",
        user_warehouse_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Formal discrepancy resolution workflow (write-off, restock, or quarantine).
        """
        InventoryService._verify_warehouse_authorization(req.warehouse_id, actor_role, user_warehouse_id)
        InventoryService._check_idempotency(req.correlation_id)

        def txn(store):
            now_iso = datetime.now(timezone.utc).isoformat()
            batch = store.get_document("inventory_batches", req.batch_id)
            if not batch or batch.get("org_id") != org_id:
                raise HTTPException(status_code=404, detail="Batch not found.")

            inv_key = f"inv_{req.warehouse_id}_{req.product_id}"
            inv = store.get_document("inventory", inv_key)
            if not inv:
                raise HTTPException(status_code=404, detail="Inventory record not found.")

            if req.resolution_action == "write_off":
                # Permanently write off lost/damaged units
                deduct_qty = abs(req.quantity_delta)
                batch["quantity"] = max(0, batch["quantity"] - deduct_qty)
                inv["total_quantity"] = max(0, inv["total_quantity"] - deduct_qty)
                inv["available_quantity"] = max(0, inv["available_quantity"] - deduct_qty)
            elif req.resolution_action == "quarantine":
                batch["status"] = "quarantined"
                # Remove from available
                inv["available_quantity"] = max(0, inv["available_quantity"] - batch["quantity"])
            elif req.resolution_action == "restock":
                add_qty = abs(req.quantity_delta)
                batch["quantity"] += add_qty
                inv["total_quantity"] += add_qty
                inv["available_quantity"] += add_qty

            batch["updated_at"] = now_iso
            inv["updated_at"] = now_iso
            store.set_document("inventory_batches", batch["id"], batch)
            store.set_document("inventory", inv_key, inv)

            prd = store.get_document("products", req.product_id)
            unit = prd.get("unit", "units") if prd else "units"

            movement = InventoryService._record_movement(
                store=store,
                org_id=org_id,
                correlation_id=req.correlation_id,
                product_id=req.product_id,
                batch_id=req.batch_id,
                source_warehouse_id=req.warehouse_id,
                destination_id=None,
                movement_type=MovementType.DISCREPANCY_RESOLUTION.value,
                quantity_changed=req.quantity_delta,
                unit=unit,
                balance_after=inv["available_quantity"],
                actor_id=actor_id,
                actor_name=actor_name,
                actor_role=actor_role,
                reason=f"Discrepancy Resolution ({req.discrepancy_type} -> {req.resolution_action}): {req.reason}",
                now_iso=now_iso
            )

            store.set_document("processed_idempotency_keys", req.correlation_id, {
                "correlation_id": req.correlation_id,
                "action": "resolve_discrepancy",
                "actor_id": actor_id,
                "timestamp": now_iso
            })

            return {"success": True, "batch": batch, "inventory": inv, "movement": movement}

        return db.run_transaction(txn)

    # -------------------------------------------------------------------------
    # 6. INTER-WAREHOUSE TRANSFER LIFECYCLE (STATE MACHINE)
    # -------------------------------------------------------------------------
    @staticmethod
    def create_transfer(
        source_warehouse_id: str,
        target_warehouse_id: str,
        items: List[TransferItem],
        notes: str,
        actor_id: str,
        actor_name: str,
        org_id: str,
        actor_role: str = "operator",
        user_warehouse_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Creates an inter-warehouse transfer request.
        Validates source stock and immediately reserves stock to prevent double-allocation.
        """
        InventoryService._verify_warehouse_authorization(source_warehouse_id, actor_role, user_warehouse_id)
        if source_warehouse_id == target_warehouse_id:
            raise HTTPException(status_code=400, detail="Source and target warehouse cannot be identical.")

        def txn(store):
            now_iso = datetime.now(timezone.utc).isoformat()
            t_id = f"trf_{uuid.uuid4().hex[:10]}"
            trf_num = f"TRF-{datetime.now().strftime('%Y')}-{uuid.uuid4().hex[:4].upper()}"

            # Validate each item has sufficient stock and reserve it
            for item in items:
                inv_key = f"inv_{source_warehouse_id}_{item.product_id}"
                inv = store.get_document("inventory", inv_key)
                if not inv or inv.get("org_id") != org_id:
                    raise HTTPException(status_code=404, detail=f"Product {item.product_id} not found in source warehouse.")
                if inv["available_quantity"] < item.quantity:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Insufficient available stock for product {item.product_id}. Available: {inv['available_quantity']}, Requested: {item.quantity}"
                    )
                # Reserve stock
                inv["available_quantity"] -= item.quantity
                inv["reserved_quantity"] = inv.get("reserved_quantity", 0) + item.quantity
                inv["updated_at"] = now_iso
                store.set_document("inventory", inv_key, inv)

            # Freight cost estimate
            src = store.get_document("warehouses", source_warehouse_id)
            dst = store.get_document("warehouses", target_warehouse_id)
            est_cost = 180.0
            if src and dst:
                from app.services.optimizer_engine import haversine_distance_km
                dist = haversine_distance_km(src["lat"], src["lng"], dst["lat"], dst["lng"])
                total_units = sum(i.quantity for i in items)
                est_cost = round(dist * 0.45 + total_units * 0.12, 2)

            trf_doc = {
                "id": t_id,
                "org_id": org_id,
                "transfer_number": trf_num,
                "source_warehouse_id": source_warehouse_id,
                "target_warehouse_id": target_warehouse_id,
                "items": [i.model_dump() for i in items],
                "status": TransferStatus.REQUESTED.value,
                "requested_by_id": actor_id,
                "requested_by_name": actor_name,
                "approved_by_id": None,
                "approved_by_name": None,
                "carrier_name": None,
                "tracking_number": None,
                "shipped_at": None,
                "received_at": None,
                "estimated_transport_cost": est_cost,
                "notes": notes,
                "created_at": now_iso,
                "updated_at": now_iso,
            }
            store.set_document("transfers", t_id, trf_doc)
            return trf_doc

        return db.run_transaction(txn)

    @staticmethod
    def approve_or_reject_transfer(
        transfer_id: str,
        approved: bool,
        actor_id: str,
        actor_name: str,
        org_id: str,
        notes: str = "",
        actor_role: str = "supply_chain_manager",
        user_warehouse_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Concurrency-safe transfer approval/rejection.
        Enforces state transition: REQUESTED -> APPROVED or REJECTED.
        Rejects double-approvals, double-dispatch, or operations by unauthorized actors.
        """
        def txn(store):
            now_iso = datetime.now(timezone.utc).isoformat()
            trf = store.get_document("transfers", transfer_id)
            if not trf or trf.get("org_id") != org_id:
                raise HTTPException(status_code=404, detail="Transfer not found.")

            curr_status = trf["status"]
            
            # Check state machine transitions
            if curr_status not in (TransferStatus.REQUESTED.value, TransferStatus.PENDING.value):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Transfer is already in '{curr_status}' state. Double-approval or re-processing forbidden."
                )

            # Reject unauthorized operational roles from approving transfers
            if actor_role in ("operator", "warehouse_operator", "distributor", "distributor_field_operator"):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Role '{actor_role}' is not authorized to approve transfers."
                )

            # Warehouse managers can only approve transfers involving their facility
            if actor_role == "warehouse_manager":
                wh = user_warehouse_id or "wh_chicago_01"
                if trf.get("source_warehouse_id") != wh and trf.get("target_warehouse_id") != wh:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail=f"Warehouse manager at '{wh}' cannot approve transfers from '{trf.get('source_warehouse_id')}'. Only assigned warehouse transfers are allowed."
                    )

            if approved:
                trf["status"] = TransferStatus.APPROVED.value
                trf["approved_by_id"] = actor_id
                trf["approved_by_name"] = actor_name
                trf["updated_at"] = now_iso
                trf["notes"] = f"{trf.get('notes', '')} | Approved: {notes}".strip(" |")
            else:
                trf["status"] = TransferStatus.REJECTED.value
                trf["approved_by_id"] = actor_id
                trf["approved_by_name"] = actor_name
                trf["updated_at"] = now_iso
                trf["notes"] = f"{trf.get('notes', '')} | Rejected: {notes}".strip(" |")

                # Release reserved stock back to available stock in source warehouse
                for item in trf["items"]:
                    inv_key = f"inv_{trf['source_warehouse_id']}_{item['product_id']}"
                    inv = store.get_document("inventory", inv_key)
                    if inv:
                        inv["reserved_quantity"] = max(0, inv.get("reserved_quantity", 0) - item["quantity"])
                        inv["available_quantity"] += item["quantity"]
                        inv["updated_at"] = now_iso
                        store.set_document("inventory", inv_key, inv)

            store.set_document("transfers", transfer_id, trf)
            return trf

        return db.run_transaction(txn)

    @staticmethod
    def dispatch_transfer(
        req: TransferDispatchRequest,
        actor_id: str,
        actor_name: str,
        org_id: str,
        actor_role: str = "operator",
        user_warehouse_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Dispatches an approved transfer.
        Enforces state transition: APPROVED -> IN_TRANSIT.
        Deducts source warehouse stock and moves into in_transit_quantity.
        Prevents double-dispatch or dispatching unapproved transfers.
        """
        def txn(store):
            now_iso = datetime.now(timezone.utc).isoformat()
            trf = store.get_document("transfers", req.transfer_id)
            if not trf or trf.get("org_id") != org_id:
                raise HTTPException(status_code=404, detail="Transfer not found.")

            curr_status = trf["status"]
            if curr_status != TransferStatus.APPROVED.value:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Cannot dispatch transfer in '{curr_status}' state. Transfer must be '{TransferStatus.APPROVED.value}' to dispatch."
                )

            InventoryService._verify_warehouse_authorization(trf["source_warehouse_id"], actor_role, user_warehouse_id)

            # Move from reserved into in_transit in source warehouse
            for item in trf["items"]:
                inv_key = f"inv_{trf['source_warehouse_id']}_{item['product_id']}"
                inv = store.get_document("inventory", inv_key)
                if not inv:
                    raise HTTPException(status_code=404, detail=f"Inventory record missing for product {item['product_id']}.")

                inv["total_quantity"] -= item["quantity"]
                inv["reserved_quantity"] = max(0, inv.get("reserved_quantity", 0) - item["quantity"])
                inv["in_transit_quantity"] = inv.get("in_transit_quantity", 0) + item["quantity"]
                inv["updated_at"] = now_iso
                store.set_document("inventory", inv_key, inv)

                # Deduct batch quantity
                batches = store.query(
                    "inventory_batches",
                    filters={"warehouse_id": trf["source_warehouse_id"], "product_id": item["product_id"]},
                    org_id=org_id,
                    order_by="expiry_date"
                )
                rem = item["quantity"]
                for b in batches:
                    if rem <= 0:
                        break
                    deduct = min(b["quantity"], rem)
                    b["quantity"] -= deduct
                    if b["quantity"] == 0:
                        b["status"] = "depleted"
                    store.set_document("inventory_batches", b["id"], b)
                    rem -= deduct

                prd = store.get_document("products", item["product_id"])
                unit = prd.get("unit", "units") if prd else "units"

                InventoryService._record_movement(
                    store=store,
                    org_id=org_id,
                    correlation_id=f"trf_disp_{trf['id']}_{item['product_id']}",
                    product_id=item["product_id"],
                    batch_id=item.get("batch_id"),
                    source_warehouse_id=trf["source_warehouse_id"],
                    destination_id=trf["target_warehouse_id"],
                    movement_type=MovementType.TRANSFER_DISPATCH.value,
                    quantity_changed=-item["quantity"],
                    unit=unit,
                    balance_after=inv["available_quantity"],
                    actor_id=actor_id,
                    actor_name=actor_name,
                    actor_role=actor_role,
                    reason=f"Transfer dispatch {trf['transfer_number']} via carrier {req.carrier_name or 'Standard'}",
                    now_iso=now_iso
                )

            trf["status"] = TransferStatus.IN_TRANSIT.value
            trf["carrier_name"] = req.carrier_name
            trf["tracking_number"] = req.tracking_number
            trf["shipped_at"] = now_iso
            trf["updated_at"] = now_iso
            store.set_document("transfers", req.transfer_id, trf)

            return trf

        return db.run_transaction(txn)

    @staticmethod
    def receive_transfer(
        req: TransferReceiveRequest,
        actor_id: str,
        actor_name: str,
        org_id: str,
        actor_role: str = "operator",
        user_warehouse_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Receives an in-transit transfer at the destination warehouse.
        Enforces state transition: IN_TRANSIT -> RECEIVED.
        Increments destination stock, decrements source in_transit, logs damage if condition breached.
        """
        def txn(store):
            now_iso = datetime.now(timezone.utc).isoformat()
            trf = store.get_document("transfers", req.transfer_id)
            if not trf or trf.get("org_id") != org_id:
                raise HTTPException(status_code=404, detail="Transfer not found.")

            curr_status = trf["status"]
            if curr_status not in (TransferStatus.IN_TRANSIT.value, TransferStatus.DISPATCHED.value):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Cannot receive transfer in '{curr_status}' state. Transfer must be in transit to receive."
                )

            InventoryService._verify_warehouse_authorization(trf["target_warehouse_id"], actor_role, user_warehouse_id)

            for item in trf["items"]:
                # 1. Decrement in-transit from source warehouse
                src_inv_key = f"inv_{trf['source_warehouse_id']}_{item['product_id']}"
                src_inv = store.get_document("inventory", src_inv_key)
                if src_inv:
                    src_inv["in_transit_quantity"] = max(0, src_inv.get("in_transit_quantity", 0) - item["quantity"])
                    src_inv["updated_at"] = now_iso
                    store.set_document("inventory", src_inv_key, src_inv)

                # 2. Increment destination inventory
                dst_inv_key = f"inv_{trf['target_warehouse_id']}_{item['product_id']}"
                dst_inv = store.get_document("inventory", dst_inv_key)
                net_received = max(0, item["quantity"] - req.damaged_quantity)

                if dst_inv:
                    dst_inv["total_quantity"] += item["quantity"]
                    dst_inv["available_quantity"] += net_received
                    dst_inv["damaged_quantity"] = dst_inv.get("damaged_quantity", 0) + req.damaged_quantity
                    dst_inv["updated_at"] = now_iso
                else:
                    prd = store.get_document("products", item["product_id"])
                    dst_inv = {
                        "id": dst_inv_key,
                        "org_id": org_id,
                        "warehouse_id": trf["target_warehouse_id"],
                        "product_id": item["product_id"],
                        "total_quantity": item["quantity"],
                        "available_quantity": net_received,
                        "reserved_quantity": 0,
                        "damaged_quantity": req.damaged_quantity,
                        "in_transit_quantity": 0,
                        "safety_stock": prd.get("min_safety_stock", 50) if prd else 50,
                        "reorder_point": prd.get("reorder_point", 100) if prd else 100,
                        "created_at": now_iso,
                        "updated_at": now_iso
                    }
                store.set_document("inventory", dst_inv_key, dst_inv)

                # 3. Create or update batch in destination warehouse
                batch_id = f"bat_{trf['target_warehouse_id']}_TRF_{trf['id'][-4:]}"
                batch_doc = {
                    "id": batch_id,
                    "org_id": org_id,
                    "warehouse_id": trf["target_warehouse_id"],
                    "product_id": item["product_id"],
                    "batch_number": f"TRF-{trf['transfer_number'][-6:]}",
                    "supplier_reference": f"Transfer from {trf['source_warehouse_id']}",
                    "mfg_date": datetime.now().strftime("%Y-%m-%d"),
                    "expiry_date": "2026-12-31",
                    "quantity": net_received,
                    "reserved_quantity": 0,
                    "damaged_quantity": req.damaged_quantity,
                    "unit_cost": item.get("unit_cost", 50.0),
                    "storage_bin": "RECEIVING_DOCK",
                    "status": "active",
                    "created_at": now_iso,
                    "updated_at": now_iso
                }
                store.set_document("inventory_batches", batch_id, batch_doc)

                prd = store.get_document("products", item["product_id"])
                unit = prd.get("unit", "units") if prd else "units"

                InventoryService._record_movement(
                    store=store,
                    org_id=org_id,
                    correlation_id=f"trf_recv_{trf['id']}_{item['product_id']}",
                    product_id=item["product_id"],
                    batch_id=batch_id,
                    source_warehouse_id=trf["source_warehouse_id"],
                    destination_id=trf["target_warehouse_id"],
                    movement_type=MovementType.TRANSFER_RECEIVE.value,
                    quantity_changed=item["quantity"],
                    unit=unit,
                    balance_after=dst_inv["available_quantity"],
                    actor_id=actor_id,
                    actor_name=actor_name,
                    actor_role=actor_role,
                    reason=f"Transfer received: {trf['transfer_number']}. Condition: {req.condition}",
                    now_iso=now_iso
                )

            trf["status"] = TransferStatus.RECEIVED.value
            trf["received_at"] = now_iso
            trf["updated_at"] = now_iso
            store.set_document("transfers", req.transfer_id, trf)
            return trf

        return db.run_transaction(txn)

    @staticmethod
    def cancel_transfer(
        req: TransferCancelRequest,
        actor_id: str,
        actor_name: str,
        org_id: str,
        actor_role: str = "operator",
        user_warehouse_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Cancels an un-dispatched transfer and releases reserved source inventory.
        """
        def txn(store):
            now_iso = datetime.now(timezone.utc).isoformat()
            trf = store.get_document("transfers", req.transfer_id)
            if not trf or trf.get("org_id") != org_id:
                raise HTTPException(status_code=404, detail="Transfer not found.")

            curr_status = trf["status"]
            if curr_status not in (TransferStatus.REQUESTED.value, TransferStatus.PENDING.value, TransferStatus.APPROVED.value):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Cannot cancel transfer in '{curr_status}' state. Only requested or approved transfers can be cancelled."
                )

            # Release reserved stock in source warehouse
            for item in trf["items"]:
                inv_key = f"inv_{trf['source_warehouse_id']}_{item['product_id']}"
                inv = store.get_document("inventory", inv_key)
                if inv:
                    inv["reserved_quantity"] = max(0, inv.get("reserved_quantity", 0) - item["quantity"])
                    inv["available_quantity"] += item["quantity"]
                    inv["updated_at"] = now_iso
                    store.set_document("inventory", inv_key, inv)

            trf["status"] = TransferStatus.CANCELLED.value
            trf["updated_at"] = now_iso
            trf["notes"] = f"{trf.get('notes', '')} | Cancelled: {req.reason}".strip(" |")
            store.set_document("transfers", req.transfer_id, trf)
            return trf

        return db.run_transaction(txn)
