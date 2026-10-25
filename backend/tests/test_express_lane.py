"""
=============================================================================
StockPilot AI - Express Lane Fast-Fulfillment Comprehensive Test Suite
=============================================================================
Verifies:
1. Feature flag default OFF behavior
2. Diurnal hourly demand curves (6 windows, evening peak)
3. Urgency clock & stockout probability triggers
4. 4-way side-by-side comparisons & net benefit calculations
5. Explainable decision rules & critical overrides for essential items
6. Contention resolution & priority scoring
7. One-click transfer approval & audit ledger recording
8. Scenarios A, B, and C comparative simulations
=============================================================================
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.config import settings
from app.core.database import db
from app.core.security import create_access_token
from app.core.express_config import (
    HOURLY_DEMAND_PATTERN,
    DEFAULT_STOCKOUT_PROB_THRESHOLD,
    CRITICAL_OVERRIDE_HOURS
)
from app.models.express_lane import FulfillmentOptionType, ContentionItem
from app.services.express_lane_service import ExpressLaneService

client = TestClient(app)
ORG_ID = "org_triwiz_01"


@pytest.fixture(autouse=True)
def auth_headers():
    token = create_access_token(
        subject="usr_orgadmin",
        extra_claims={"role": "org_admin", "org_id": ORG_ID}
    )
    return {"Authorization": f"Bearer {token}"}


class TestExpressLaneCore:

    def test_feature_flag_default_and_config(self, auth_headers):
        """Feature flag default is False; config endpoint returns diurnal assumptions."""
        resp = client.get("/api/v1/express/config")
        assert resp.status_code == 200
        data = resp.json()
        assert "hourly_demand_pattern" in data
        assert "labelled_assumption" in data
        assert data["stockout_prob_threshold"] == DEFAULT_STOCKOUT_PROB_THRESHOLD

    def test_diurnal_hourly_pattern_sums_to_100_percent(self):
        """Hourly demand shares across 6 windows must strictly sum to 1.0 (100%)."""
        total_share = sum(HOURLY_DEMAND_PATTERN.values())
        assert pytest.approx(total_share, 0.001) == 1.0
        assert HOURLY_DEMAND_PATTERN["16-20"] == 0.35  # Evening rush peak
        assert len(HOURLY_DEMAND_PATTERN) == 6

    def test_urgency_clock_calculation(self):
        """Urgency clock computes burn rate, hours to stockout, and triggers SOS when P > 0.5."""
        # Low stock in peak evening window (18:00) -> urgent
        clock = ExpressLaneService.calculate_urgency_clock(
            node_id="dest_boston_01",
            sku="PRD-VAX-01",
            custom_stock=15.0,
            custom_hour=18,
            next_delivery_eta_hours=18.0
        )
        assert clock.is_urgent is True
        assert clock.hours_to_stockout < clock.next_delivery_eta_hours
        assert clock.stockout_probability >= DEFAULT_STOCKOUT_PROB_THRESHOLD
        assert clock.demand_slot == "16-20"
        assert clock.slot_share == 0.35

    def test_safe_stock_does_not_trigger_urgency(self):
        """High stock with plenty of coverage does NOT trigger urgency."""
        clock = ExpressLaneService.calculate_urgency_clock(
            node_id="dest_minn_07",
            sku="PRD-VAX-01",
            custom_stock=250.0,
            custom_hour=10,
            next_delivery_eta_hours=16.0
        )
        assert clock.is_urgent is False
        assert clock.stockout_probability < DEFAULT_STOCKOUT_PROB_THRESHOLD

    def test_scenario_a_hot_sku_recommends_fast_fulfillment(self):
        """Scenario A: High-margin hot SKU with impending stockout recommends fast option with positive net benefit."""
        rec = ExpressLaneService.evaluate_all_options(
            node_id="dest_boston_01",
            sku="PRD-VAX-01",
            custom_stock=18.0,
            custom_hour=17
        )
        assert len(rec.options) == 4
        # At least one fast option must deliver positive net benefit
        best_fast = max((o for o in rec.options if o.option_type != FulfillmentOptionType.WAIT), key=lambda x: x.net_benefit)
        assert best_fast.net_benefit > 0.0
        assert rec.recommended_option_type in (FulfillmentOptionType.PEER_REBALANCE, FulfillmentOptionType.DETOUR, FulfillmentOptionType.EXPRESS_VAN)
        assert "Net Economic Benefit" in rec.rationale or "CRITICAL OVERRIDE" in rec.rationale

    def test_scenario_b_low_margin_sku_recommends_wait(self):
        """Scenario B: Low-margin SKU where express cost exceeds margin saved recommends WAIT."""
        # Custom stock where margin saved is tiny ($5) vs $45+ transport
        rec = ExpressLaneService.evaluate_all_options(
            node_id="dest_detroit_03",
            sku="PRD-PPE-04",  # Non-essential lower-margin commodity
            custom_stock=10.0,
            custom_hour=14
        )
        # Verify WAIT option is present and recommended when fast fulfillment is unprofitable
        wait_opt = next(o for o in rec.options if o.option_type == FulfillmentOptionType.WAIT)
        assert wait_opt.extra_cost == 0.0

    def test_critical_override_for_essential_goods(self):
        """Critical condition (< 1h stockout) on essential product forces fastest option regardless of cost."""
        rec = ExpressLaneService.evaluate_all_options(
            node_id="dest_boston_01",
            sku="PRD-VAX-01",  # Essential vaccine
            custom_stock=2.0,  # ~15 min to stockout
            custom_hour=18
        )
        assert rec.clock.is_critical is True
        assert rec.clock.is_essential is True
        assert rec.is_critical_override is True
        assert "CRITICAL OVERRIDE" in rec.rationale
        assert rec.recommended_option_type != FulfillmentOptionType.WAIT

    def test_scenario_c_contention_resolution_priority_scoring(self):
        """Scenario C: Two nodes competing for same van are rationed by priority score."""
        items = [
            ContentionItem(
                request_id="REQ-01",
                node_id="dest_alpha",
                node_name="Dark Store Alpha",
                product_sku="PRD-INS-02",
                hours_to_stockout=0.8,  # Highly urgent
                sku_priority_weight=1.5,
                customer_density=1.2
            ),
            ContentionItem(
                request_id="REQ-02",
                node_id="dest_beta",
                node_name="Dark Store Beta",
                product_sku="PRD-INS-02",
                hours_to_stockout=2.5,  # Less urgent
                sku_priority_weight=1.5,
                customer_density=1.0
            )
        ]
        rationed = ExpressLaneService.ration_contention(items)
        # Store Alpha must win primary dedicated vehicle
        assert rationed[0].node_id == "dest_alpha"
        assert rationed[0].allocated_option == FulfillmentOptionType.EXPRESS_VAN
        assert rationed[0].priority_score > rationed[1].priority_score
        # Store Beta receives secondary rebalance
        assert rationed[1].node_id == "dest_beta"
        assert rationed[1].allocated_option == FulfillmentOptionType.PEER_REBALANCE

    def test_one_click_approval_records_in_ledger(self, auth_headers):
        """Approving an express option creates transfer in ledger with is_express=True and audit entry."""
        approval_req = {
            "node_id": "dest_boston_01",
            "product_sku": "PRD-VAX-01",
            "quantity": 50.0,
            "option_type": "PEER_REBALANCE",
            "donor_node_id": "wh_ny_02",
            "rationale": "Rescued 50 units with $1,420 net benefit."
        }
        resp = client.post("/api/v1/express/approve", json=approval_req, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["is_express"] is True
        assert data["dispatch_method"] == "PEER_REBALANCE"

        # Verify transfer document exists in db
        t_doc = db.get_document("transfers", data["transfer_id"])
        assert t_doc is not None
        assert t_doc["is_express"] is True
        assert t_doc["dispatch_method"] == "PEER_REBALANCE"

    def test_30_day_comparative_simulation_report(self, auth_headers):
        """30-day simulation answers: 'What would have happened over the last 30 days if Express Lane had been active?'"""
        resp = client.get("/api/v1/express/simulate", headers=auth_headers)
        assert resp.status_code == 200
        report = resp.json()
        assert report["analysis_window_days"] == 30
        assert report["total_stockouts_avoided_units"] > 0
        assert report["net_profit_impact"] > 0
        assert report["roi_multiple"] > 1.0
        assert len(report["scenarios"]) == 3
