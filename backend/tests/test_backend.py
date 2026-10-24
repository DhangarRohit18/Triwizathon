import pytest
import uuid
from datetime import datetime, timezone
from app.core.database import db
from app.services.seed_data import init_seed_data
from app.services.inventory_service import InventoryService
from app.services.optimizer_engine import DistributionOptimizerEngine
from app.services.iot_service import IoTTelemetryService
from app.services.whatsapp_service import WhatsAppBotService
from app.core.config import settings
from app.models.domain import (
    OptimizationRunRequest,
    ScenarioModifiers,
    ReceiveStockRequest,
    DispatchStockRequest,
    StockAdjustmentRequest,
    DamageReportRequest
)

@pytest.fixture(autouse=True)
def setup_test_db():
    init_seed_data()
    yield

# -------------------------------------------------------------
# 1. Distribution Optimizer & Scenario Tests
# -------------------------------------------------------------
def test_optimizer_baseline_vs_ortools():
    req = OptimizationRunRequest(horizon_days=7)
    res = DistributionOptimizerEngine.run_optimization(req, org_id="org_triwiz_01")
    
    assert res.run_id is not None
    assert res.optimized.solver_status in ("OPTIMAL", "FEASIBLE")
    assert res.optimized.total_allocated_units > 0
    assert len(res.recommendations) > 0
    # Optimization should achieve better or equal total cost compared to naive greedy baseline
    assert res.optimized.total_modeled_cost <= res.baseline_heuristic.total_modeled_cost
    assert res.savings_amount >= 0.0

def test_optimizer_warehouse_disruption_scenario():
    # Base run
    base_req = OptimizationRunRequest(horizon_days=7)
    base_res = DistributionOptimizerEngine.run_optimization(base_req, org_id="org_triwiz_01")

    # Run with Chicago Hub disrupted (e.g. severe blizzard / blizzard outage)
    disrupt_req = OptimizationRunRequest(
        horizon_days=7,
        scenario=ScenarioModifiers(disrupted_warehouse_ids=["wh_chicago_01"])
    )
    disrupt_res = DistributionOptimizerEngine.run_optimization(disrupt_req, org_id="org_triwiz_01")

    # Verify that NO recommendation sources stock from Chicago Hub
    chicago_allocs = [
        r for r in disrupt_res.recommendations
        if r.source_warehouse_id == "wh_chicago_01"
    ]
    assert len(chicago_allocs) == 0, "Disrupted warehouse should have 0 allocations."

    # Other warehouses (NY, Dallas, Reno) should pick up fulfillment
    other_allocs = [
        r for r in disrupt_res.recommendations
        if r.source_warehouse_id in ("wh_ny_02", "wh_dallas_03", "wh_reno_04")
    ]
    assert len(other_allocs) > 0, "Network should reroute allocations to operational warehouses."

# -------------------------------------------------------------
# 2. Inventory Ledger & Concurrency Tests
# -------------------------------------------------------------
def test_receive_and_dispatch_with_idempotency():
    correlation_id = f"TEST-CORR-{datetime.now().timestamp()}"
    
    unique_batch = f"TEST-BN-{uuid.uuid4().hex[:6]}"
    # Receive stock
    rec_req = ReceiveStockRequest(
        correlation_id=correlation_id,
        warehouse_id="wh_chicago_01",
        product_id="prd_vax_01",
        batch_number=unique_batch,
        supplier_reference="Test Supplier",
        mfg_date="2026-01-01",
        expiry_date="2026-12-31",
        quantity=500,
        unit_cost=22.50,
        storage_bin="BIN-TEST-01"
    )
    res_rec = InventoryService.receive_stock(rec_req, "usr_operator", "James Test", "org_triwiz_01")
    assert res_rec["success"] is True
    assert res_rec["batch"]["quantity"] == 500

    # Idempotency duplicate check: same correlation ID must be rejected with 409
    with pytest.raises(Exception):
        InventoryService.receive_stock(rec_req, "usr_operator", "James Test", "org_triwiz_01")

    # Dispatch stock
    disp_corr = f"TEST-DISP-{datetime.now().timestamp()}"
    disp_req = DispatchStockRequest(
        correlation_id=disp_corr,
        warehouse_id="wh_chicago_01",
        product_id="prd_vax_01",
        destination_id="dest_boston_01",
        quantity=200
    )
    res_disp = InventoryService.dispatch_stock(disp_req, "usr_operator", "James Test", "org_triwiz_01")
    assert res_disp["success"] is True

    # Over-dispatch prevention: attempting to dispatch more than available must fail
    fail_corr = f"TEST-OVER-{datetime.now().timestamp()}"
    fail_disp = DispatchStockRequest(
        correlation_id=fail_corr,
        warehouse_id="wh_chicago_01",
        product_id="prd_vax_01",
        destination_id="dest_boston_01",
        quantity=999999
    )
    with pytest.raises(Exception):
        InventoryService.dispatch_stock(fail_disp, "usr_operator", "James Test", "org_triwiz_01")

# -------------------------------------------------------------
# 3. IoT Telemetry Ingestion & Excursion Alerts
# -------------------------------------------------------------
def test_iot_telemetry_excursion_alert():
    # Normal temperature reading (4.5C for cold room)
    res_normal = IoTTelemetryService.ingest_reading(
        payload={
            "device_id": "ESP32-COLD-CHI-01",
            "temperature_c": 4.5,
            "humidity_percent": 50.0,
            "door_open": False
        },
        auth_api_key=settings.IOT_API_KEY,
        expected_api_key=settings.IOT_API_KEY
    )
    assert res_normal["status"] == "ingested"
    assert len(res_normal["alerts_triggered"]) == 0

    # Temperature breach excursion (14.2C breach, threshold is 8.0C)
    res_breach = IoTTelemetryService.ingest_reading(
        payload={
            "device_id": "ESP32-COLD-CHI-01",
            "temperature_c": 14.2,
            "humidity_percent": 75.0,
            "door_open": True
        },
        auth_api_key=settings.IOT_API_KEY,
        expected_api_key=settings.IOT_API_KEY
    )
    assert res_breach["status"] == "ingested"
    assert len(res_breach["alerts_triggered"]) >= 2  # Temp breach + door open + humidity

# -------------------------------------------------------------
# 4. WhatsApp Bot Deterministic Commands & Security
# -------------------------------------------------------------
def test_whatsapp_status_and_stock_command():
    res_status = WhatsAppBotService.process_incoming_message(
        from_number="+13125550103",
        message_text="STATUS",
        org_id="org_triwiz_01"
    )
    assert "System Status" in res_status["reply_text"]
    assert "Warehouses Monitored" in res_status["reply_text"]

    res_stock = WhatsAppBotService.process_incoming_message(
        from_number="+13125550103",
        message_text="STOCK PRD-VAX-01",
        org_id="org_triwiz_01"
    )
    assert "Comirnaty" in res_stock["reply_text"]
    assert "Total Available" in res_stock["reply_text"]
