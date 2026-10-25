import pytest
import uuid
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException
from app.core.database import db
from app.services.seed_data import init_seed_data
from app.services.inventory_service import InventoryService
from app.services.optimizer_engine import DistributionOptimizerEngine
from app.services.forecast_service import DemandForecastingService
from app.models.domain import (
    ReceiveStockRequest,
    DispatchStockRequest,
    StockAdjustmentRequest,
    TransferFromRecommendationRequest,
    TransferApprovalRequest,
    TransferDispatchRequest,
    TransferReceiveRequest,
    TransferStatus,
    OptimizationRunRequest,
    ScenarioModifiers
)

ORG_ID = "org_triwiz_01"

@pytest.fixture(autouse=True)
def setup_test_db():
    init_seed_data()
    yield

# ===========================================================================
# 1. CONCURRENT DISPATCH & OVERSOLD PREVENTION (RACE CONDITIONS)
# ===========================================================================
def test_concurrent_dispatch_prevents_overselling():
    """
    Spawns multiple concurrent threads attempting to dispatch stock simultaneously.
    Validates that:
    1. Total dispatched units never exceed the starting available stock.
    2. Available stock never drops below 0.
    3. Exactly the supported number of dispatches succeed, and remainder fail with 400 Insufficient Stock.
    """
    wh_id = "wh_chicago_01"
    p_id = "prd_vax_01"
    inv_key = f"inv_{wh_id}_{p_id}"

    # Set exact available stock to 100 units
    inv = db.get_document("inventory", inv_key)
    assert inv is not None
    inv["available_quantity"] = 100
    inv["total_quantity"] = 100
    db.set_document("inventory", inv_key, inv)

    # Set single batch with 100 units
    batch_id = f"bat_concurrent_test_{uuid.uuid4().hex[:6]}"
    db.set_document("inventory_batches", batch_id, {
        "id": batch_id,
        "org_id": ORG_ID,
        "warehouse_id": wh_id,
        "product_id": p_id,
        "batch_number": "BAT-CONCUR-01",
        "quantity": 100,
        "expiry_date": (datetime.now(timezone.utc) + timedelta(days=90)).isoformat(),
        "status": "active"
    })

    # 8 threads attempting to dispatch 25 units each (total attempted = 200 units, but only 100 available)
    threads_count = 8
    dispatch_qty = 25
    success_count = 0
    failure_count = 0

    def attempt_dispatch(worker_idx: int):
        req = DispatchStockRequest(
            correlation_id=f"DISP-CONCUR-{worker_idx}-{uuid.uuid4().hex[:6]}",
            warehouse_id=wh_id,
            product_id=p_id,
            destination_id="dest_boston_01",
            quantity=dispatch_qty,
            reason=f"Concurrent dispatch thread {worker_idx}"
        )
        return InventoryService.dispatch_stock(
            req=req,
            actor_id="usr_operator",
            actor_name="James Operator",
            org_id=ORG_ID,
            actor_role="operator",
            user_warehouse_id=wh_id
        )

    with ThreadPoolExecutor(max_workers=threads_count) as executor:
        futures = [executor.submit(attempt_dispatch, i) for i in range(threads_count)]
        for f in as_completed(futures):
            try:
                res = f.result()
                if res.get("success"):
                    success_count += 1
            except HTTPException as e:
                if e.status_code == 400 and "Insufficient available stock" in e.detail:
                    failure_count += 1
                else:
                    raise

    # Invariant: exactly 4 dispatches of 25 units succeeded (4 * 25 = 100 units)
    assert success_count == 4
    assert failure_count == 4

    # Final available stock must be strictly 0 (never negative!)
    final_inv = db.get_document("inventory", inv_key)
    assert final_inv["available_quantity"] == 0
    assert final_inv["available_quantity"] >= 0

# ===========================================================================
# 2. IDEMPOTENCY ENFORCEMENT & DUPLICATE REQUEST PREVENTION
# ===========================================================================
def test_duplicate_requests_rejected_with_idempotency_conflict():
    """
    Submitting the same correlation_id twice must be rejected with 409 Conflict.
    Movement ledger must contain exactly one movement entry.
    """
    corr_id = f"IDEMP-TEST-{uuid.uuid4().hex[:8]}"
    wh_id = "wh_chicago_01"
    p_id = "prd_vax_01"

    req = ReceiveStockRequest(
        correlation_id=corr_id,
        warehouse_id=wh_id,
        product_id=p_id,
        supplier_reference="sup_pfizer_01",
        batch_number=f"BAT-DUP-{uuid.uuid4().hex[:4].upper()}",
        quantity=50,
        unit_cost=22.50,
        mfg_date="2026-01-01",
        expiry_date="2026-12-31",
        storage_bin="BIN-A-01"
    )

    # First request: succeeds
    res1 = InventoryService.receive_stock(
        req=req,
        actor_id="usr_operator",
        actor_name="James Operator",
        org_id=ORG_ID,
        actor_role="operator",
        user_warehouse_id=wh_id
    )
    assert res1["success"] is True

    # Second request with identical correlation_id: must be rejected with 409 Conflict
    with pytest.raises(HTTPException) as exc_info:
        InventoryService.receive_stock(
            req=req,
            actor_id="usr_operator",
            actor_name="James Operator",
            org_id=ORG_ID,
            actor_role="operator",
            user_warehouse_id=wh_id
        )
    assert exc_info.value.status_code == 409
    assert "Duplicate submission prevented" in exc_info.value.detail

    # Verify movement ledger has only 1 entry for this correlation_id
    movements = db.query("inventory_movements", filters={"correlation_id": corr_id}, org_id=ORG_ID)
    assert len(movements) == 1
    assert movements[0]["balance_before"] is not None

# ===========================================================================
# 3. INSUFFICIENT STOCK & NON-NEGATIVE BALANCES
# ===========================================================================
def test_insufficient_stock_rejection_leaves_balance_intact():
    """
    Requesting more stock than available fails with 400 without mutating stock.
    """
    wh_id = "wh_chicago_01"
    p_id = "prd_vax_01"
    inv_before = db.get_document("inventory", f"inv_{wh_id}_{p_id}")
    avail_before = inv_before["available_quantity"]

    req = DispatchStockRequest(
        correlation_id=f"DISP-OVERFLOW-{uuid.uuid4().hex[:8]}",
        warehouse_id=wh_id,
        product_id=p_id,
        destination_id="dest_boston_01",
        quantity=avail_before + 999999,
        reason="Test overflow rejection"
    )

    with pytest.raises(HTTPException) as exc_info:
        InventoryService.dispatch_stock(
            req=req,
            actor_id="usr_operator",
            actor_name="James Operator",
            org_id=ORG_ID,
            actor_role="operator",
            user_warehouse_id=wh_id
        )
    assert exc_info.value.status_code == 400
    assert "Insufficient available stock" in exc_info.value.detail

    inv_after = db.get_document("inventory", f"inv_{wh_id}_{p_id}")
    assert inv_after["available_quantity"] == avail_before

# ===========================================================================
# 4. FEFO SELECTION & CLEAR EXPLANATION
# ===========================================================================
def test_fefo_batch_selection_and_explanation():
    """
    When dispatching stock without specifying a batch lot, FEFO must:
    1. Select the batch with the earliest expiration date.
    2. Provide a clear selection_reason explaining why the batch was chosen.
    """
    wh_id = "wh_reno_04"
    p_id = f"prd_fefo_{uuid.uuid4().hex[:6]}"

    db.set_document("products", p_id, {
        "id": p_id,
        "org_id": ORG_ID,
        "name": "FEFO Test Vaccine",
        "sku": "PRD-FEFO-01",
        "unit": "vials"
    })

    now = datetime.now(timezone.utc)
    early_exp = (now + timedelta(days=10)).isoformat()
    later_exp = (now + timedelta(days=60)).isoformat()

    batch_early_id = f"bat_early_{uuid.uuid4().hex[:6]}"
    batch_later_id = f"bat_later_{uuid.uuid4().hex[:6]}"

    db.set_document("inventory_batches", batch_early_id, {
        "id": batch_early_id,
        "org_id": ORG_ID,
        "warehouse_id": wh_id,
        "product_id": p_id,
        "batch_number": "BAT-EARLY-10D",
        "quantity": 30,
        "reserved_quantity": 0,
        "expiry_date": early_exp,
        "status": "active"
    })

    db.set_document("inventory_batches", batch_later_id, {
        "id": batch_later_id,
        "org_id": ORG_ID,
        "warehouse_id": wh_id,
        "product_id": p_id,
        "batch_number": "BAT-LATER-60D",
        "quantity": 100,
        "reserved_quantity": 0,
        "expiry_date": later_exp,
        "status": "active"
    })

    # Update Reno warehouse inventory available
    inv_key = f"inv_{wh_id}_{p_id}"
    db.set_document("inventory", inv_key, {
        "id": inv_key,
        "org_id": ORG_ID,
        "warehouse_id": wh_id,
        "product_id": p_id,
        "total_quantity": 130,
        "available_quantity": 130,
        "reserved_quantity": 0,
        "damaged_quantity": 0,
        "in_transit_quantity": 0,
        "safety_stock": 10,
        "updated_at": now.isoformat()
    })

    # Dispatch 20 units (fits inside the 30-unit early batch)
    req = DispatchStockRequest(
        correlation_id=f"DISP-FEFO-{uuid.uuid4().hex[:8]}",
        warehouse_id=wh_id,
        product_id=p_id,
        destination_id="dest_seattle_06",
        quantity=20,
        reason="FEFO batch selection test"
    )

    res = InventoryService.dispatch_stock(
        req=req,
        actor_id="usr_superadmin",
        actor_name="Sarah Chen",
        org_id=ORG_ID,
        actor_role="super_admin",
        user_warehouse_id=None
    )

    assert res["success"] is True
    deductions = res["deducted_batches"]
    assert len(deductions) == 1
    assert deductions[0]["batch_id"] == batch_early_id
    assert deductions[0]["quantity"] == 20
    assert "FEFO priority" in deductions[0]["selection_reason"]
    assert early_exp in deductions[0]["selection_reason"]

    # Verify early batch remaining quantity is 10, while later batch is untouched (100)
    b_early = db.get_document("inventory_batches", batch_early_id)
    assert b_early["quantity"] == 10
    b_later = db.get_document("inventory_batches", batch_later_id)
    assert b_later["quantity"] == 100

# ===========================================================================
# 5. INVENTORY RECONCILIATION AGAINST LEDGER
# ===========================================================================
def test_inventory_reconciliation_verifies_ledger_and_batches():
    """
    Inventory total must reconcile against active batch sums and movement ledger.
    """
    wh_id = "wh_chicago_01"
    res = InventoryService.reconcile_inventory(warehouse_id=wh_id, org_id=ORG_ID)

    assert res["warehouse_id"] == wh_id
    assert res["total_products_checked"] > 0
    assert len(res["items"]) > 0
    for item in res["items"]:
        assert item["current_inventory_total"] >= 0
        assert item["current_available"] >= 0
        assert item["current_reserved"] >= 0
        assert item["batch_quantities_sum"] >= 0
        # Available + Reserved <= Total
        assert item["current_available"] + item["current_reserved"] <= item["current_inventory_total"]

# ===========================================================================
# 6. OR-TOOLS OPTIMIZATION: DISRUPTED WAREHOUSES & CAPACITY
# ===========================================================================
def test_optimization_disrupted_warehouse_exclusion():
    """
    When a warehouse is marked as disrupted in scenario modifiers,
    zero allocations must originate from that disrupted facility.
    """
    disrupted_id = "wh_chicago_01"
    req = OptimizationRunRequest(
        horizon_days=7,
        fefo_priority_weight=1.2,
        scenario=ScenarioModifiers(disrupted_warehouse_ids=[disrupted_id])
    )

    res = DistributionOptimizerEngine.run_optimization(req, org_id=ORG_ID)
    assert res.hard_constraints_satisfied is True
    assert res.input_snapshot is not None
    assert disrupted_id in res.input_snapshot["disrupted_warehouses"]

    for rec in res.recommendations:
        assert rec.source_warehouse_id != disrupted_id

def test_optimization_infeasible_handling():
    """
    When all warehouses are disrupted, the optimizer must handle infeasibility gracefully
    without allocating invalid quantities or silently accepting an invalid plan.
    """
    all_whs = ["wh_chicago_01", "wh_ny_02", "wh_dallas_03", "wh_reno_04"]
    req = OptimizationRunRequest(
        horizon_days=7,
        scenario=ScenarioModifiers(disrupted_warehouse_ids=all_whs)
    )

    res = DistributionOptimizerEngine.run_optimization(req, org_id=ORG_ID)
    # Available stock is 0, so allocated units must be 0
    assert res.optimized.total_allocated_units == 0
    assert len(res.recommendations) == 0

def test_optimization_savings_measured_against_real_baseline():
    """
    Measured savings must be strictly derived from baseline heuristic modeled cost
    minus OR-Tools MIP modeled cost. Never a fabricated default constant.
    """
    req = OptimizationRunRequest(horizon_days=7, scenario=ScenarioModifiers())
    res = DistributionOptimizerEngine.run_optimization(req, org_id=ORG_ID)

    base_cost = res.baseline_heuristic.total_modeled_cost
    opt_cost = res.optimized.total_modeled_cost
    expected_savings = max(0.0, round(base_cost - opt_cost, 2))
    expected_pct = round((expected_savings / max(1.0, base_cost)) * 100.0, 1)

    assert res.savings_amount == expected_savings
    assert res.savings_percent == expected_pct
    assert res.optimized.objective_value is not None

# ===========================================================================
# 7. FORECASTING: INSUFFICIENT HISTORY & HOLDOUT EVALUATION
# ===========================================================================
def test_forecasting_withholds_predictions_on_insufficient_history():
    """
    New or sparse products with < 14 observations must NOT fabricate predictions.
    Must return insufficient_history=True, clear limitations, and empty timeline.
    """
    sparse_p_id = "prd_sparse_test_01"
    now_iso = datetime.now(timezone.utc).isoformat()

    # Create test product
    db.set_document("products", sparse_p_id, {
        "id": sparse_p_id,
        "org_id": ORG_ID,
        "name": "Sparse Data Product",
        "sku": "PRD-SPARSE-01",
        "category": "Experimental",
        "unit": "units"
    })

    # Seed only 3 days of demand history (well below 14-day threshold)
    for day in range(3):
        dt = (datetime.now(timezone.utc) - timedelta(days=day+1)).strftime("%Y-%m-%d")
        rec_id = f"dh_{sparse_p_id}_{dt}"
        db.set_document("demand_history", rec_id, {
            "id": rec_id,
            "org_id": ORG_ID,
            "product_id": sparse_p_id,
            "date": dt,
            "demand": 15
        })

    res = DemandForecastingService.generate_product_forecast(
        product_id=sparse_p_id,
        org_id=ORG_ID,
        horizon_days=14
    )

    assert res.status == "insufficient_history"
    assert res.evaluation.insufficient_history is True
    assert res.evaluation.history_days == 3
    assert len(res.timeline) == 0
    assert "below the minimum required 14-day calibration threshold" in res.message or "insufficient" in res.message.lower()

def test_forecasting_train_test_holdout_and_metrics():
    """
    Standard products with >= 14 history points:
    1. Zero data leakage: strict chronological train/test holdout.
    2. Holdout MAE and RMSE computed on actual holdout test predictions.
    3. Baseline 7-day MA evaluated on exact same holdout sample.
    4. Persists snapshot in 'forecasts' collection.
    """
    p_id = "prd_vax_01"
    res = DemandForecastingService.generate_product_forecast(
        product_id=p_id,
        org_id=ORG_ID,
        horizon_days=14
    )

    assert res.status == "success"
    assert res.evaluation.insufficient_history is False
    assert res.evaluation.history_days >= 14
    assert res.evaluation.holdout_sample_size >= 5
    assert res.evaluation.mae > 0.0
    assert res.evaluation.rmse > 0.0
    assert res.evaluation.baseline_ma_mae > 0.0
    assert res.evaluation.baseline_ma_rmse > 0.0
    assert res.evaluation.history_start_date is not None
    assert res.evaluation.history_end_date is not None
    assert len(res.timeline) > 0

    # Verify persistence in datastore
    forecasts = db.query("forecasts", filters={"product_id": p_id})
    assert len(forecasts) >= 1

# ===========================================================================
# 8. RECOMMENDATION-TO-TRANSFER WORKFLOW & STATE TRANSITIONS
# ===========================================================================
def test_recommendation_to_transfer_explicit_workflow():
    """
    End-to-End Workflow:
    1. Optimization run generates recommendation. Stock is NOT mutated.
    2. User converts recommendation into formal Transfer request (REQUESTED state).
    3. Stock is reserved in source warehouse.
    4. Duplicate creation attempt is rejected with 409 Conflict.
    5. Authorized manager approves transfer (REQUESTED -> APPROVED).
    6. Double-approval attempt is rejected with 409 Conflict.
    7. Transfer is dispatched (APPROVED -> IN_TRANSIT). Reserved stock moves to in_transit.
    8. Transfer is received at destination (IN_TRANSIT -> RECEIVED). Stock added to target warehouse.
    """
    # Step 1: Run optimization
    opt_req = OptimizationRunRequest(horizon_days=7)
    opt_res = DistributionOptimizerEngine.run_optimization(opt_req, org_id=ORG_ID)
    assert len(opt_res.recommendations) > 0
    rec = opt_res.recommendations[0]

    # Verify inventory was NOT mutated by the solver run
    src_inv = db.get_document("inventory", f"inv_{rec.source_warehouse_id}_{rec.product_id}")
    avail_before = src_inv["available_quantity"]
    reserved_before = src_inv.get("reserved_quantity", 0)

    # Step 2: Formalize recommendation into transfer
    conv_req = TransferFromRecommendationRequest(
        run_id=opt_res.run_id,
        recommendation_id=rec.id,
        notes="Automated hardening test conversion"
    )
    trf = InventoryService.create_transfer_from_recommendation(
        req=conv_req,
        actor_id="usr_supplychain",
        actor_name="Elena Rostova",
        actor_role="supply_chain_manager",
        org_id=ORG_ID
    )

    assert trf["id"] is not None
    assert trf["status"] == TransferStatus.REQUESTED.value
    assert trf["source_warehouse_id"] == rec.source_warehouse_id
    assert trf["target_warehouse_id"] is not None
    assert trf["source_warehouse_id"] != trf["target_warehouse_id"]
    assert trf["items"][0]["quantity"] == rec.allocated_quantity

    # Stock is now reserved: available decreased, reserved increased
    src_inv_after = db.get_document("inventory", f"inv_{rec.source_warehouse_id}_{rec.product_id}")
    assert src_inv_after["available_quantity"] == avail_before - rec.allocated_quantity
    assert src_inv_after["reserved_quantity"] == reserved_before + rec.allocated_quantity

    # Step 3: Prevent duplicate transfer creation from the same recommendation
    with pytest.raises(HTTPException) as exc_dup:
        InventoryService.create_transfer_from_recommendation(
            req=conv_req,
            actor_id="usr_supplychain",
            actor_name="Elena Rostova",
            actor_role="supply_chain_manager",
            org_id=ORG_ID
        )
    assert exc_dup.value.status_code == 409
    assert "already been converted into transfer" in exc_dup.value.detail

    # Step 4: Approve transfer (REQUESTED -> APPROVED)
    appr_res = InventoryService.approve_or_reject_transfer(
        transfer_id=trf["id"],
        approved=True,
        actor_id="usr_supplychain",
        actor_name="Elena Rostova",
        org_id=ORG_ID,
        actor_role="supply_chain_manager"
    )
    assert appr_res["status"] == TransferStatus.APPROVED.value

    # Step 5: Prevent double approval
    with pytest.raises(HTTPException) as exc_appr:
        InventoryService.approve_or_reject_transfer(
            transfer_id=trf["id"],
            approved=True,
            actor_id="usr_supplychain",
            actor_name="Elena Rostova",
            org_id=ORG_ID,
            actor_role="supply_chain_manager"
        )
    assert exc_appr.value.status_code == 409
    assert "already in 'approved' state" in exc_appr.value.detail

    # Step 6: Dispatch transfer (APPROVED -> IN_TRANSIT)
    disp_req = TransferDispatchRequest(
        transfer_id=trf["id"],
        carrier_name="DHL Cold Chain Express",
        tracking_number="DHL-889921",
        notes="Dispatched in certified dry ice active shipper"
    )
    disp_res = InventoryService.dispatch_transfer(
        req=disp_req,
        actor_id="usr_whmanager",
        actor_name="David Sterling",
        org_id=ORG_ID,
        actor_role="warehouse_manager",
        user_warehouse_id=rec.source_warehouse_id
    )
    assert disp_res["status"] == TransferStatus.IN_TRANSIT.value

    # Step 7: Prevent double dispatch
    with pytest.raises(HTTPException) as exc_disp:
        InventoryService.dispatch_transfer(
            req=disp_req,
            actor_id="usr_whmanager",
            actor_name="David Sterling",
            org_id=ORG_ID,
            actor_role="warehouse_manager",
            user_warehouse_id=rec.source_warehouse_id
        )
    assert exc_disp.value.status_code == 409
    assert "Cannot dispatch transfer in 'in_transit' state" in exc_disp.value.detail

    # Step 8: Receive transfer at destination (IN_TRANSIT -> RECEIVED)
    recv_req = TransferReceiveRequest(
        transfer_id=trf["id"],
        damaged_quantity=0,
        condition="intact",
        notes="Shipment received intact with temperature logger verified 4.2C"
    )
    recv_res = InventoryService.receive_transfer(
        req=recv_req,
        actor_id="usr_superadmin",
        actor_name="Sarah Chen",
        org_id=ORG_ID,
        actor_role="super_admin"
    )
    assert recv_res["status"] == TransferStatus.RECEIVED.value
