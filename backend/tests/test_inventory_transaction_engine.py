import pytest
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from fastapi import HTTPException
from app.core.database import db
from app.services.seed_data import init_seed_data
from app.services.inventory_service import InventoryService
from app.models.domain import (
    ReceiveStockRequest,
    DispatchStockRequest,
    StockReservationRequest,
    ReleaseReservationRequest,
    CycleCountRequest,
    StockAdjustmentRequest,
    DamageReportRequest,
    DiscrepancyResolutionRequest,
    TransferItem,
    TransferApprovalRequest,
    TransferDispatchRequest,
    TransferReceiveRequest,
    TransferCancelRequest,
    TransferStatus
)

@pytest.fixture(autouse=True)
def setup_test_db():
    init_seed_data()
    yield

# ---------------------------------------------------------------------------
# 1. Negative Stock & Insufficient Stock Prevention
# ---------------------------------------------------------------------------
def test_negative_stock_prevention():
    """Verify that dispatching more stock than available is strictly denied and balance never goes negative"""
    inv = db.get_document("inventory", "inv_wh_chicago_01_prd_vax_01")
    assert inv is not None
    current_avail = inv["available_quantity"]

    excess_quantity = current_avail + 500
    req = DispatchStockRequest(
        correlation_id=f"DISP-NEG-{uuid.uuid4().hex[:8]}",
        warehouse_id="wh_chicago_01",
        product_id="prd_vax_01",
        destination_id="dest_boston_01",
        quantity=excess_quantity,
        reason="Testing negative stock prevention"
    )

    with pytest.raises(HTTPException) as exc_info:
        InventoryService.dispatch_stock(
            req=req,
            actor_id="usr_operator",
            actor_name="James Operator",
            org_id="org_triwiz_01",
            actor_role="operator",
            user_warehouse_id="wh_chicago_01"
        )
    assert exc_info.value.status_code == 400
    assert "Insufficient available stock" in exc_info.value.detail

    # Verify inventory balance remained untouched
    inv_after = db.get_document("inventory", "inv_wh_chicago_01_prd_vax_01")
    assert inv_after["available_quantity"] == current_avail
    assert inv_after["available_quantity"] >= 0

# ---------------------------------------------------------------------------
# 2. Idempotency & Duplicate Request Prevention
# ---------------------------------------------------------------------------
def test_idempotency_duplicate_requests_prevention():
    """Verify that submitting duplicate requests with the same correlation_id is rejected with 409 Conflict"""
    corr_id = f"IDEMP-TEST-{uuid.uuid4().hex[:10]}"
    req = ReceiveStockRequest(
        correlation_id=corr_id,
        warehouse_id="wh_chicago_01",
        product_id="prd_vax_01",
        batch_number=f"LOT-IDEMP-{uuid.uuid4().hex[:4].upper()}",
        supplier_reference="Pfizer Global",
        mfg_date="2026-01-01",
        expiry_date="2026-12-31",
        quantity=250,
        unit_cost=35.0,
        storage_bin="BIN-IDEMP-01"
    )

    # First submission -> succeeds
    res1 = InventoryService.receive_stock(
        req=req,
        actor_id="usr_operator",
        actor_name="James Operator",
        org_id="org_triwiz_01",
        actor_role="operator",
        user_warehouse_id="wh_chicago_01"
    )
    assert res1["success"] is True

    # Immediate duplicate submission with identical correlation_id -> must raise 409 Conflict
    with pytest.raises(HTTPException) as exc_info:
        InventoryService.receive_stock(
            req=req,
            actor_id="usr_operator",
            actor_name="James Operator",
            org_id="org_triwiz_01",
            actor_role="operator",
            user_warehouse_id="wh_chicago_01"
        )
    assert exc_info.value.status_code == 409
    assert "Duplicate submission prevented" in exc_info.value.detail

# ---------------------------------------------------------------------------
# 3. Stock Reservations & Releases
# ---------------------------------------------------------------------------
def test_stock_reservation_and_release_lifecycle():
    """Verify stock reservations decrement available stock without altering total stock, and release restores availability"""
    inv_before = db.get_document("inventory", "inv_wh_chicago_01_prd_vax_01")
    initial_avail = inv_before["available_quantity"]
    initial_total = inv_before["total_quantity"]
    initial_reserved = inv_before.get("reserved_quantity", 0)

    reserve_qty = 80
    reserve_req = StockReservationRequest(
        correlation_id=f"RES-REQ-{uuid.uuid4().hex[:8]}",
        warehouse_id="wh_chicago_01",
        product_id="prd_vax_01",
        quantity=reserve_qty,
        order_id="ord_urgent_hospital_01",
        reason="Holding stock for priority ICU shipment"
    )

    # 1. Reserve stock
    res_reserve = InventoryService.reserve_stock(
        req=reserve_req,
        actor_id="usr_supplychain",
        actor_name="Sarah Chen",
        org_id="org_triwiz_01",
        actor_role="supply_chain_manager"
    )
    assert res_reserve["success"] is True
    inv_res = db.get_document("inventory", "inv_wh_chicago_01_prd_vax_01")
    assert inv_res["available_quantity"] == initial_avail - reserve_qty
    assert inv_res["reserved_quantity"] == initial_reserved + reserve_qty
    assert inv_res["total_quantity"] == initial_total

    # 2. Release reservation
    release_req = ReleaseReservationRequest(
        correlation_id=f"REL-REQ-{uuid.uuid4().hex[:8]}",
        warehouse_id="wh_chicago_01",
        product_id="prd_vax_01",
        quantity=reserve_qty,
        order_id="ord_urgent_hospital_01",
        reason="Order cancelled by clinic"
    )
    res_release = InventoryService.release_reservation(
        req=release_req,
        actor_id="usr_supplychain",
        actor_name="Sarah Chen",
        org_id="org_triwiz_01",
        actor_role="supply_chain_manager"
    )
    assert res_release["success"] is True
    inv_final = db.get_document("inventory", "inv_wh_chicago_01_prd_vax_01")
    assert inv_final["available_quantity"] == initial_avail
    assert inv_final["reserved_quantity"] == initial_reserved

# ---------------------------------------------------------------------------
# 4. Cycle Counting & Discrepancy Resolution
# ---------------------------------------------------------------------------
def test_cycle_counting_discrepancy_and_ledger():
    """Verify cycle counts record physical variance and write an auditable ledger record"""
    batch_id = "bat_vax_chi_01"
    batch = db.get_document("inventory_batches", batch_id)
    assert batch is not None
    original_qty = batch["quantity"]

    new_physical_count = original_qty + 12  # Found 12 unrecorded vials during bin audit
    count_req = CycleCountRequest(
        correlation_id=f"CYCLE-{uuid.uuid4().hex[:8]}",
        warehouse_id="wh_chicago_01",
        product_id="prd_vax_01",
        batch_id=batch_id,
        counted_quantity=new_physical_count,
        storage_bin="BIN-COLD-A-04",
        notes="Q3 routine cold room cycle count"
    )

    res = InventoryService.cycle_count(
        req=count_req,
        actor_id="usr_operator",
        actor_name="James Operator",
        org_id="org_triwiz_01",
        actor_role="operator",
        user_warehouse_id="wh_chicago_01"
    )
    assert res["success"] is True
    assert res["variance"] == 12
    assert res["batch"]["quantity"] == new_physical_count

    # Check movement ledger
    movements = db.query(
        "inventory_movements",
        filters={"correlation_id": count_req.correlation_id},
        org_id="org_triwiz_01"
    )
    assert len(movements) == 1
    m = movements[0]
    assert m["movement_type"] == "cycle_count"
    assert m["quantity_changed"] == 12
    assert m["resulting_status"] == "COMMITTED"

def test_discrepancy_resolution_quarantine_and_write_off():
    """Verify discrepancy resolution workflow allows quarantining damaged lots and writing off lost items"""
    batch_id = "bat_vax_chi_01"
    res_req = DiscrepancyResolutionRequest(
        correlation_id=f"DISCREP-{uuid.uuid4().hex[:8]}",
        warehouse_id="wh_chicago_01",
        product_id="prd_vax_01",
        batch_id=batch_id,
        discrepancy_type="damaged",
        quantity_delta=-5,
        resolution_action="quarantine",
        reason="Broken seal detected on exterior carton"
    )

    res = InventoryService.resolve_discrepancy(
        req=res_req,
        actor_id="usr_whmanager",
        actor_name="Robert Miller",
        org_id="org_triwiz_01",
        actor_role="warehouse_manager",
        user_warehouse_id="wh_chicago_01"
    )
    assert res["success"] is True
    assert res["batch"]["status"] == "quarantined"

# ---------------------------------------------------------------------------
# 5. Inter-Warehouse Transfer Lifecycle & State Machine
# ---------------------------------------------------------------------------
def test_inter_warehouse_transfer_complete_state_machine():
    """
    Test full transfer lifecycle:
    REQUESTED -> APPROVED -> IN_TRANSIT -> RECEIVED.
    Verifies stock reservation on request, deduction into in_transit on dispatch,
    and destination receipt with batch creation.
    """
    transfer_qty = 30
    items = [TransferItem(product_id="prd_vax_01", quantity=transfer_qty, unit_cost=25.0)]

    # 1. Create transfer (REQUESTED)
    trf = InventoryService.create_transfer(
        source_warehouse_id="wh_chicago_01",
        target_warehouse_id="wh_ny_02",
        items=items,
        notes="Replenishment for NY Hub",
        actor_id="usr_supplychain",
        actor_name="Sarah Chen",
        org_id="org_triwiz_01",
        actor_role="supply_chain_manager"
    )
    assert trf["status"] == TransferStatus.REQUESTED.value
    transfer_id = trf["id"]

    # Source available stock should be reserved
    src_inv_1 = db.get_document("inventory", "inv_wh_chicago_01_prd_vax_01")
    assert src_inv_1["reserved_quantity"] >= transfer_qty

    # 2. Approve transfer (REQUESTED -> APPROVED)
    app_res = InventoryService.approve_or_reject_transfer(
        transfer_id=transfer_id,
        approved=True,
        actor_id="usr_supplychain",
        actor_name="Sarah Chen",
        org_id="org_triwiz_01",
        notes="Approved for priority dispatch",
        actor_role="supply_chain_manager"
    )
    assert app_res["status"] == TransferStatus.APPROVED.value

    # 3. Double-approval prevention: Attempting to approve again must fail with 409
    with pytest.raises(HTTPException) as exc_app:
        InventoryService.approve_or_reject_transfer(
            transfer_id=transfer_id,
            approved=True,
            actor_id="usr_supplychain",
            actor_name="Sarah Chen",
            org_id="org_triwiz_01",
            notes="Second approval attempt",
            actor_role="supply_chain_manager"
        )
    assert exc_app.value.status_code == 409
    assert "Double-approval or re-processing forbidden" in exc_app.value.detail

    # 4. Dispatch transfer (APPROVED -> IN_TRANSIT)
    disp_req = TransferDispatchRequest(
        transfer_id=transfer_id,
        carrier_name="FedEx ColdChain Priority",
        tracking_number="TRK-987216-CHI-NY",
        notes="Loaded onto refrigerated trailer 12"
    )
    disp_res = InventoryService.dispatch_transfer(
        req=disp_req,
        actor_id="usr_operator",
        actor_name="James Operator",
        org_id="org_triwiz_01",
        actor_role="operator",
        user_warehouse_id="wh_chicago_01"
    )
    assert disp_res["status"] == TransferStatus.IN_TRANSIT.value
    assert disp_res["carrier_name"] == "FedEx ColdChain Priority"

    # Source inventory should now show in_transit
    src_inv_disp = db.get_document("inventory", "inv_wh_chicago_01_prd_vax_01")
    assert src_inv_disp["in_transit_quantity"] >= transfer_qty

    # 5. Double-dispatch prevention: Attempting to dispatch an in-transit transfer must fail with 409
    with pytest.raises(HTTPException) as exc_disp:
        InventoryService.dispatch_transfer(
            req=disp_req,
            actor_id="usr_operator",
            actor_name="James Operator",
            org_id="org_triwiz_01",
            actor_role="operator",
            user_warehouse_id="wh_chicago_01"
        )
    assert exc_disp.value.status_code == 409
    assert "Cannot dispatch transfer in 'in_transit' state" in exc_disp.value.detail

    # 6. Receive transfer (IN_TRANSIT -> RECEIVED)
    recv_req = TransferReceiveRequest(
        transfer_id=transfer_id,
        condition="intact",
        damaged_quantity=0,
        notes="Inspected and verified intact at NY receiving dock"
    )
    recv_res = InventoryService.receive_transfer(
        req=recv_req,
        actor_id="usr_operator",
        actor_name="NY Operator",
        org_id="org_triwiz_01",
        actor_role="operator",
        user_warehouse_id="wh_ny_02"
    )
    assert recv_res["status"] == TransferStatus.RECEIVED.value

    # Destination inventory must reflect received stock
    dst_inv = db.get_document("inventory", "inv_wh_ny_02_prd_vax_01")
    assert dst_inv is not None
    assert dst_inv["available_quantity"] >= transfer_qty

    # 7. Modify terminal state prevention: Attempting to dispatch or cancel received transfer must fail with 409
    with pytest.raises(HTTPException) as exc_term:
        InventoryService.cancel_transfer(
            req=TransferCancelRequest(transfer_id=transfer_id, reason="Late cancellation"),
            actor_id="usr_supplychain",
            actor_name="Sarah Chen",
            org_id="org_triwiz_01",
            actor_role="supply_chain_manager"
        )
    assert exc_term.value.status_code == 409
    assert "Cannot cancel transfer in 'received' state" in exc_term.value.detail

def test_transfer_cancellation_releases_reserved_stock():
    """Verify that cancelling an approved or requested transfer releases the reserved stock back to available"""
    transfer_qty = 40
    items = [TransferItem(product_id="prd_vax_01", quantity=transfer_qty, unit_cost=25.0)]

    src_inv_before = db.get_document("inventory", "inv_wh_chicago_01_prd_vax_01")
    avail_before = src_inv_before["available_quantity"]

    trf = InventoryService.create_transfer(
        source_warehouse_id="wh_chicago_01",
        target_warehouse_id="wh_dallas_03",
        items=items,
        notes="Test cancellation release",
        actor_id="usr_supplychain",
        actor_name="Sarah Chen",
        org_id="org_triwiz_01",
        actor_role="supply_chain_manager"
    )

    src_inv_reserved = db.get_document("inventory", "inv_wh_chicago_01_prd_vax_01")
    assert src_inv_reserved["available_quantity"] == avail_before - transfer_qty

    # Cancel transfer
    cancel_res = InventoryService.cancel_transfer(
        req=TransferCancelRequest(transfer_id=trf["id"], reason="Truck breakdown, cancellation required"),
        actor_id="usr_supplychain",
        actor_name="Sarah Chen",
        org_id="org_triwiz_01",
        actor_role="supply_chain_manager"
    )
    assert cancel_res["status"] == TransferStatus.CANCELLED.value

    # Stock must be completely restored
    src_inv_after = db.get_document("inventory", "inv_wh_chicago_01_prd_vax_01")
    assert src_inv_after["available_quantity"] == avail_before

# ---------------------------------------------------------------------------
# 6. Warehouse-Level Authorization Failures
# ---------------------------------------------------------------------------
def test_unauthorized_warehouse_operation_rejected():
    """Verify operators cannot perform warehouse mutations outside their assigned facility"""
    # Operator assigned to wh_chicago_01 attempts dispatch at wh_ny_02
    unauth_req = DispatchStockRequest(
        correlation_id=f"UNAUTH-{uuid.uuid4().hex[:8]}",
        warehouse_id="wh_ny_02",  # Different warehouse!
        product_id="prd_vax_01",
        destination_id="dest_boston_01",
        quantity=10,
        reason="Malicious cross-warehouse dispatch"
    )

    with pytest.raises(HTTPException) as exc_info:
        InventoryService.dispatch_stock(
            req=unauth_req,
            actor_id="usr_operator",
            actor_name="James Operator",
            org_id="org_triwiz_01",
            actor_role="operator",
            user_warehouse_id="wh_chicago_01"  # Bound to Chicago
        )
    assert exc_info.value.status_code == 403
    assert "Unauthorized warehouse operation" in exc_info.value.detail

# ---------------------------------------------------------------------------
# 7. ACID Rollback on Transaction Failure
# ---------------------------------------------------------------------------
def test_transactional_rollback_on_failure():
    """Verify that if an atomic transaction raises an error, all partial state changes are rolled back"""
    batch_id = "bat_vax_chi_01"
    batch_before = db.get_document("inventory_batches", batch_id)
    qty_before = batch_before["quantity"]

    def failing_transaction(store):
        # 1. Mutate batch
        b = store.get_document("inventory_batches", batch_id)
        b["quantity"] = 999999
        store.set_document("inventory_batches", batch_id, b)

        # 2. Deliberately raise exception midway
        raise RuntimeError("Simulated mid-transaction hardware or network failure")

    with pytest.raises(RuntimeError):
        db.run_transaction(failing_transaction)

    # Verify rollback: quantity must be exactly qty_before, NOT 999999
    batch_after = db.get_document("inventory_batches", batch_id)
    assert batch_after["quantity"] == qty_before, "Transactional rollback failed to restore pre-transaction state"

# ---------------------------------------------------------------------------
# 8. Concurrent Dispatches & Race Condition Control
# ---------------------------------------------------------------------------
def test_concurrent_dispatches_concurrency_control():
    """
    Test race condition prevention:
    Seed 100 units of a test product.
    Spawn 5 concurrent threads each trying to dispatch 30 units (150 total).
    Exactly 3 dispatches must succeed (90 units deducted), 2 must fail due to insufficient stock.
    Final balance must be exactly 10, never negative.
    """
    test_prod_id = f"prd_race_{uuid.uuid4().hex[:6]}"
    test_wh_id = "wh_chicago_01"
    inv_key = f"inv_{test_wh_id}_{test_prod_id}"
    batch_id = f"bat_{test_wh_id}_{test_prod_id}"

    # Seed product, batch (100 units), and inventory (100 units)
    now_iso = datetime.now(timezone.utc).isoformat()
    db.set_document("products", test_prod_id, {
        "id": test_prod_id,
        "org_id": "org_triwiz_01",
        "sku": f"SKU-{test_prod_id}",
        "name": "Race Condition Test Vials",
        "category": "Vaccines & Biologics",
        "unit": "vials"
    })
    db.set_document("inventory_batches", batch_id, {
        "id": batch_id,
        "org_id": "org_triwiz_01",
        "warehouse_id": test_wh_id,
        "product_id": test_prod_id,
        "batch_number": "LOT-RACE-01",
        "quantity": 100,
        "status": "active",
        "expiry_date": "2026-12-31"
    })
    db.set_document("inventory", inv_key, {
        "id": inv_key,
        "org_id": "org_triwiz_01",
        "warehouse_id": test_wh_id,
        "product_id": test_prod_id,
        "total_quantity": 100,
        "available_quantity": 100,
        "reserved_quantity": 0,
        "damaged_quantity": 0,
        "in_transit_quantity": 0
    })

    def attempt_dispatch(thread_idx: int):
        req = DispatchStockRequest(
            correlation_id=f"DISP-RACE-{thread_idx}-{uuid.uuid4().hex[:6]}",
            warehouse_id=test_wh_id,
            product_id=test_prod_id,
            destination_id="dest_boston_01",
            quantity=30,
            reason=f"Concurrent dispatch thread {thread_idx}"
        )
        return InventoryService.dispatch_stock(
            req=req,
            actor_id="usr_operator",
            actor_name="Concurrency Worker",
            org_id="org_triwiz_01",
            actor_role="operator",
            user_warehouse_id=test_wh_id
        )

    success_count = 0
    failure_count = 0

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(attempt_dispatch, i) for i in range(5)]
        for fut in as_completed(futures):
            try:
                res = fut.result()
                if res.get("success"):
                    success_count += 1
            except HTTPException as e:
                if e.status_code == 400 and "Insufficient available stock" in e.detail:
                    failure_count += 1
                else:
                    raise e

    # Concurrency validation
    assert success_count == 3, f"Expected 3 successful dispatches (90 units), got {success_count}"
    assert failure_count == 2, f"Expected 2 rejected dispatches, got {failure_count}"

    final_inv = db.get_document("inventory", inv_key)
    assert final_inv["available_quantity"] == 10
    assert final_inv["total_quantity"] == 10
    assert final_inv["available_quantity"] >= 0

# ---------------------------------------------------------------------------
# 9. Movement Ledger Auditability & Schema Completeness
# ---------------------------------------------------------------------------
def test_auditable_ledger_schema_completeness():
    """Verify that ledger records contain every required audit field"""
    corr = f"AUDIT-CHECK-{uuid.uuid4().hex[:8]}"
    req = ReceiveStockRequest(
        correlation_id=corr,
        warehouse_id="wh_chicago_01",
        product_id="prd_vax_01",
        batch_number=f"LOT-AUDIT-{uuid.uuid4().hex[:4].upper()}",
        supplier_reference="Audit Pharma Ltd",
        mfg_date="2026-02-01",
        expiry_date="2027-02-01",
        quantity=150,
        unit_cost=42.0,
        storage_bin="BIN-AUDIT-01"
    )
    InventoryService.receive_stock(
        req=req,
        actor_id="usr_operator",
        actor_name="Audit Operator",
        org_id="org_triwiz_01",
        actor_role="operator",
        user_warehouse_id="wh_chicago_01"
    )

    movements = db.query("inventory_movements", filters={"correlation_id": corr}, org_id="org_triwiz_01")
    assert len(movements) == 1
    m = movements[0]

    # Required audit ledger fields
    assert m.get("id") is not None
    assert m.get("org_id") == "org_triwiz_01"
    assert m.get("correlation_id") == corr
    assert m.get("product_id") == "prd_vax_01"
    assert m.get("batch_id") is not None
    assert m.get("destination_id") == "wh_chicago_01"
    assert m.get("quantity_changed") == 150
    assert m.get("unit") in ("vials", "units")
    assert m.get("movement_type") == "receipt"
    assert m.get("actor_id") == "usr_operator"
    assert m.get("actor_name") == "Audit Operator"
    assert m.get("actor_role") == "operator"
    assert m.get("reason") is not None
    assert m.get("timestamp") is not None
    assert m.get("resulting_status") == "COMMITTED"
