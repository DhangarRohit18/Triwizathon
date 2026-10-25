"""
=============================================================================
StockPilot AI - Express Lane Pydantic Data Models
=============================================================================
Defines schema contracts for Urgency Clocks, 4-Way Fast-Fulfillment Comparisons,
Contention Resolution, and 30-Day Comparative Simulation.
"""

from enum import Enum
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class FulfillmentOptionType(str, Enum):
    WAIT = "WAIT"
    DETOUR = "DETOUR"
    PEER_REBALANCE = "PEER_REBALANCE"
    EXPRESS_VAN = "EXPRESS_VAN"


class UrgencyClock(BaseModel):
    node_id: str
    node_name: str
    product_sku: str
    product_name: str
    current_stock: float
    hourly_burn_rate: float
    hours_to_stockout: float
    next_delivery_eta_hours: float
    stockout_probability: float
    is_urgent: bool
    is_critical: bool
    is_essential: bool
    demand_slot: str
    slot_share: float


class FulfillmentOption(BaseModel):
    option_type: FulfillmentOptionType
    name: str
    tagline: str
    eta_hours: float
    extra_cost: float
    units_delivered: float
    units_saved: float
    expected_lost_units: float
    margin_saved: float
    goodwill_saved: float
    rescue_bonus: float
    expected_waste_cost: float
    net_benefit: float
    is_feasible: bool
    infeasible_reason: Optional[str] = None
    donor_node_id: Optional[str] = None
    donor_node_name: Optional[str] = None
    transit_km: float = 0.0


class ExpressRecommendation(BaseModel):
    node_id: str
    node_name: str
    product_sku: str
    product_name: str
    clock: UrgencyClock
    options: List[FulfillmentOption]
    recommended_option_type: FulfillmentOptionType
    recommended_option: FulfillmentOption
    rationale: str
    is_critical_override: bool
    generated_at: str


class ContentionItem(BaseModel):
    request_id: str
    node_id: str
    node_name: str
    product_sku: str
    hours_to_stockout: float
    sku_priority_weight: float = 1.0
    customer_density: float = 1.0
    priority_score: float = 0.0
    allocated_option: Optional[FulfillmentOptionType] = None
    allocation_status: str = "PENDING"
    notes: Optional[str] = None


class ExpressApprovalRequest(BaseModel):
    node_id: str
    product_sku: str
    quantity: float
    option_type: FulfillmentOptionType
    donor_node_id: Optional[str] = None
    rationale: str


class SimulationScenarioResult(BaseModel):
    scenario_id: str
    name: str
    description: str
    sku: str
    target_node: str
    baseline_stockout_units: float
    express_stockout_units: float
    stockouts_avoided_units: float
    extra_transport_spend: float
    gross_margin_preserved: float
    net_profit_impact: float
    avg_response_time_hours: float
    recommended_decision: str
    audit_notes: str


class ExpressSimulationReport(BaseModel):
    analysis_window_days: int = 30
    total_stockouts_avoided_units: float
    total_extra_spend: float
    gross_margin_preserved: float
    net_profit_impact: float
    roi_multiple: float
    avg_response_time_hours: float
    scenarios: List[SimulationScenarioResult]
    summary_verdict: str
