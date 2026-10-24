import pytest
from datetime import datetime, timezone
from app.core.database import db
from app.services.seed_data import init_seed_data
from app.models.domain import OptimizationRunRequest, ScenarioModifiers
from app.services.optimizer_engine import DistributionOptimizerEngine, haversine_distance_km
from app.services.forecast_service import DemandForecastingService

ORG_ID = "org_triwiz_01"

@pytest.fixture(autouse=True)
def setup_test_environment():
    """Ensure clean seeded environment before each test."""
    init_seed_data()
    yield

class TestDistributionOptimizationEngine:
    """
    Deterministic tests verifying feasibility, capacity limits, insufficient inventory,
    demand shortages, scenario modifiers, FEFO expiry prioritization, and baseline comparison.
    """

    def test_haversine_distance_calculation(self):
        # Chicago (41.8781, -87.6298) to New York (40.7128, -74.0060) is ~1145 km
        dist = haversine_distance_km(41.8781, -87.6298, 40.7128, -74.0060)
        assert 1100.0 < dist < 1200.0
        # Same point distance is 0.0 km
        assert haversine_distance_km(40.0, -75.0, 40.0, -75.0) == 0.0

    def test_optimization_feasibility_and_non_negative_allocations(self):
        req = OptimizationRunRequest(
            horizon_days=7,
            fefo_priority_weight=1.2,
            scenario=ScenarioModifiers()
        )
        res = DistributionOptimizerEngine.run_optimization(req, org_id=ORG_ID)

        assert res.hard_constraints_satisfied is True
        assert res.optimized.solver_status in ("OPTIMAL", "FEASIBLE")
        assert res.optimized.total_allocated_units > 0
        assert res.optimized.total_demand_units > 0
        assert res.optimized.fill_rate_percent >= 50.0
        assert res.optimized.transportation_cost > 0.0
        assert res.model_version == "ortools-scip-v2.1"
        assert res.data_version == "seed-triwiz-2026"

        # Check recommendations fields
        for rec in res.recommendations:
            assert rec.allocated_quantity > 0
            assert rec.requested_demand >= rec.allocated_quantity
            assert rec.unit_transport_cost > 0.0
            assert rec.total_transport_cost >= rec.unit_transport_cost
            assert rec.estimated_delivery_hours > 0.0
            assert rec.constraint_status in ("OPTIMAL", "FEASIBLE")
            assert len(rec.rationale) > 0
            assert rec.model_version == "ortools-scip-v2.1"
            assert rec.data_version == "seed-triwiz-2026"

    def test_inventory_ceiling_and_safety_stock_hard_constraint(self):
        """
        Hard Constraint: For every warehouse w and product p,
        Allocated stock <= available_quantity - safety_stock.
        Never allocate unavailable or reserved inventory.
        """
        req = OptimizationRunRequest(horizon_days=7)
        res = DistributionOptimizerEngine.run_optimization(req, org_id=ORG_ID)

        # Aggregate total allocations per (warehouse, product)
        allocations_by_wh_prod = {}
        for rec in res.recommendations:
            key = (rec.source_warehouse_id, rec.product_id)
            allocations_by_wh_prod[key] = allocations_by_wh_prod.get(key, 0) + rec.allocated_quantity

        # Verify against database inventory
        for (wh_id, p_id), allocated in allocations_by_wh_prod.items():
            inv = db.get_document("inventory", f"inv_{wh_id}_{p_id}")
            assert inv is not None
            avail = inv.get("available_quantity", 0)
            safety = inv.get("safety_stock", 50)
            allocable = max(0, avail - safety)
            # HARD CONSTRAINT CHECK: allocated must NOT exceed allocable
            assert allocated <= allocable, (
                f"Violation for warehouse {wh_id}, product {p_id}: allocated {allocated} > allocable {allocable} (avail: {avail}, safety: {safety})"
            )

    def test_warehouse_shipping_dock_capacity_limit(self):
        """
        Hard Constraint: Total units dispatched from warehouse w across all products
        and destinations cannot exceed shipping_capacity_units.
        """
        # Constrain Chicago's dock capacity to a strict 500 units
        wh_chi = db.get_document("warehouses", "wh_chicago_01")
        orig_cap = wh_chi.get("shipping_capacity_units", 15000)
        try:
            wh_chi["shipping_capacity_units"] = 500
            db.set_document("warehouses", "wh_chicago_01", wh_chi)

            req = OptimizationRunRequest(horizon_days=7)
            res = DistributionOptimizerEngine.run_optimization(req, org_id=ORG_ID)

            chicago_total_allocated = sum(
                rec.allocated_quantity for rec in res.recommendations if rec.source_warehouse_id == "wh_chicago_01"
            )
            assert chicago_total_allocated <= 500, f"Exceeded dock capacity: {chicago_total_allocated} > 500"
        finally:
            wh_chi["shipping_capacity_units"] = orig_cap
            db.set_document("warehouses", "wh_chicago_01", wh_chi)

    def test_insufficient_inventory_and_demand_shortage_detection(self):
        """
        When inventory is artificially depleted to near-zero, the solver must
        NOT invent phantom inventory. It must allocate what is available,
        detect shortages, and apply documented shortage penalties.
        """
        # Drain oncology product (prd_bio_04) available stock
        warehouses = db.query("warehouses", org_id=ORG_ID)
        for wh in warehouses:
            inv_key = f"inv_{wh['id']}_prd_bio_04"
            inv = db.get_document("inventory", inv_key)
            if inv:
                inv["available_quantity"] = 5
                inv["safety_stock"] = 0
                db.set_document("inventory", inv_key, inv)

        req = OptimizationRunRequest(product_ids=["prd_bio_04"], horizon_days=7)
        res = DistributionOptimizerEngine.run_optimization(req, org_id=ORG_ID)

        # Total allocated of prd_bio_04 across all destinations cannot exceed available (4 warehouses * 5 = 20)
        total_bio_allocated = sum(rec.allocated_quantity for rec in res.recommendations if rec.product_id == "prd_bio_04")
        assert total_bio_allocated <= 20
        # Shortages must be detected
        assert res.optimized.stockout_units > 0
        assert res.optimized.shortage_penalty_cost > 0.0

    def test_disruption_warehouse_outage_scenario(self):
        """
        Scenario Test: Disrupted warehouse must have exactly 0 allocations,
        and demand must be fulfilled by surviving operational hubs.
        """
        outage_wh = "wh_chicago_01"
        req = OptimizationRunRequest(
            horizon_days=7,
            scenario=ScenarioModifiers(disrupted_warehouse_ids=[outage_wh])
        )
        res = DistributionOptimizerEngine.run_optimization(req, org_id=ORG_ID)

        # Outage hub must have zero allocations
        outage_allocations = [
            rec for rec in res.recommendations if rec.source_warehouse_id == outage_wh
        ]
        assert len(outage_allocations) == 0, f"Expected 0 shipments from outage hub {outage_wh}"

        # Other hubs must step in
        other_allocations = [
            rec for rec in res.recommendations if rec.source_warehouse_id != outage_wh
        ]
        assert len(other_allocations) > 0

    def test_demand_spike_scenario(self):
        """
        Scenario Test: +50% demand surge increases total requested demand
        and results in higher modeled cost.
        """
        req_normal = OptimizationRunRequest(
            horizon_days=7,
            scenario=ScenarioModifiers(demand_surge_percent=0.0)
        )
        res_normal = DistributionOptimizerEngine.run_optimization(req_normal, org_id=ORG_ID)

        req_surge = OptimizationRunRequest(
            horizon_days=7,
            scenario=ScenarioModifiers(demand_surge_percent=50.0)
        )
        res_surge = DistributionOptimizerEngine.run_optimization(req_surge, org_id=ORG_ID)

        # Surged demand should be ~1.5x normal demand
        assert res_surge.optimized.total_demand_units > res_normal.optimized.total_demand_units
        ratio = res_surge.optimized.total_demand_units / res_normal.optimized.total_demand_units
        assert 1.45 <= ratio <= 1.55
        # Total cost should increase
        assert res_surge.optimized.total_modeled_cost > res_normal.optimized.total_modeled_cost

    def test_transport_fuel_cost_increase_scenario(self):
        """
        Scenario Test: Fuel transport multiplier 1.8x scales unit and total transport cost.
        """
        req_normal = OptimizationRunRequest(
            horizon_days=7,
            scenario=ScenarioModifiers(fuel_transport_cost_multiplier=1.0)
        )
        res_normal = DistributionOptimizerEngine.run_optimization(req_normal, org_id=ORG_ID)

        req_fuel = OptimizationRunRequest(
            horizon_days=7,
            scenario=ScenarioModifiers(fuel_transport_cost_multiplier=1.8)
        )
        res_fuel = DistributionOptimizerEngine.run_optimization(req_fuel, org_id=ORG_ID)

        # Modeled transportation cost must be strictly higher under elevated fuel prices
        assert res_fuel.optimized.transportation_cost > res_normal.optimized.transportation_cost

    def test_approaching_expiry_fefo_prioritization(self):
        """
        Scenario Test: Warehouses with near-expiry stock (<30 days) receive FEFO discount
        and are prioritized for fulfillment to eliminate spoilage.
        """
        req = OptimizationRunRequest(
            product_ids=["prd_ins_02"],
            horizon_days=7,
            scenario=ScenarioModifiers(expiring_soon_penalty_multiplier=2.5)
        )
        res = DistributionOptimizerEngine.run_optimization(req, org_id=ORG_ID)

        # In seed data, NY DC has insulin batch bat_ins_ny_01 expiring in 18 days
        ny_recs = [
            rec for rec in res.recommendations
            if rec.source_warehouse_id == "wh_ny_02" and rec.product_id == "prd_ins_02"
        ]
        assert len(ny_recs) > 0, "Expected FEFO allocation from New York warehouse for near-expiry insulin"
        assert any(r.expiry_risk_score > 0 for r in ny_recs)
        assert any("FEFO priority" in r.rationale for r in ny_recs)

    def test_baseline_heuristic_comparison(self):
        """
        Verifies that the OR-Tools SCIP MIP achieves total modeled cost <= transparent
        Greedy Nearest-Warehouse heuristic, confirming algorithmic superiority.
        """
        req = OptimizationRunRequest(horizon_days=7)
        res = DistributionOptimizerEngine.run_optimization(req, org_id=ORG_ID)

        # MIP should achieve cost <= baseline greedy
        assert res.optimized.total_modeled_cost <= res.baseline_heuristic.total_modeled_cost
        assert res.savings_amount >= 0.0
        assert res.savings_percent >= 0.0


class TestDemandForecastingEngine:
    """
    Deterministic tests verifying baseline 7-day moving average, ML Ridge time-series regression,
    chronological holdout evaluation, metrics calculation (MAE, RMSE, R2, MAPE), and synthetic data provenance.
    """

    def test_product_forecast_generation_and_provenance(self):
        res = DemandForecastingService.generate_product_forecast(
            product_id="prd_vax_01",
            org_id=ORG_ID,
            horizon_days=14
        )

        assert res.product_id == "prd_vax_01"
        assert res.product_name != ""
        assert res.model_version == "scikit-ridge-v1.2"
        assert res.data_version == "seed-triwiz-2026"
        assert res.evaluation.data_provenance == "calibrated_synthetic_historical_series"
        assert res.evaluation.horizon_days == 14
        assert res.evaluation.holdout_sample_size == 14

    def test_chronological_evaluation_metrics(self):
        """
        Verifies chronological evaluation on the 14-day holdout validation split:
        MAE, RMSE, R2 score, and comparison against 7-day Moving Average baseline.
        """
        res = DemandForecastingService.generate_product_forecast(
            product_id="prd_ins_02",
            org_id=ORG_ID,
            horizon_days=14
        )

        eval_m = res.evaluation
        # Metrics must be non-negative and finite
        assert eval_m.mae > 0.0
        assert eval_m.rmse > 0.0
        assert eval_m.rmse >= eval_m.mae  # Mathematical property of RMSE >= MAE
        assert 0.0 <= eval_m.r2_score <= 1.0
        assert eval_m.mape_percent is not None and eval_m.mape_percent > 0.0

        # Baseline MA metrics must also be computed on holdout sample
        assert eval_m.baseline_ma_mae is not None and eval_m.baseline_ma_mae > 0.0
        assert eval_m.baseline_ma_rmse is not None and eval_m.baseline_ma_rmse > 0.0

    def test_timeline_structure_and_confidence_bounds(self):
        """
        Timeline should have historical actuals for the validation window
        followed by future ML predictions with 95% confidence intervals (upper/lower bounds).
        """
        res = DemandForecastingService.generate_product_forecast(
            product_id="prd_bio_04",
            org_id=ORG_ID,
            horizon_days=14
        )

        # Timeline has 14 historical points + 14 future points = 28 points
        assert len(res.timeline) == 28

        # First 14 points are historical actuals
        for pt in res.timeline[:14]:
            assert pt.historical_actual is not None
            assert pt.ml_forecast is None

        # Next 14 points are future forecasts
        for pt in res.timeline[14:]:
            assert pt.historical_actual is None
            assert pt.ml_forecast is not None
            assert pt.upper_bound is not None
            assert pt.lower_bound is not None
            assert pt.upper_bound >= pt.ml_forecast
            assert pt.lower_bound <= pt.ml_forecast
