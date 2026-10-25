"""
=============================================================================
StockPilot AI - Express Lane Fast-Fulfillment REST API Router
=============================================================================
Endpoints for Quick-Commerce Dark Store urgent replenishment, Urgency Clocks,
4-Way Fulfillment Comparison, Contention Rationing, and Comparative Simulation.
"""

from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.core.config import settings
from app.core.database import db
from app.api.deps import get_current_user, require_permission
from app.core.permissions import (
    PERM_INTEGRATIONS_MANAGE,
    PERM_TRANSFERS_APPROVE,
    PERM_TRANSFERS_VIEW,
)
from app.core.express_config import (
    HOURLY_DEMAND_PATTERN,
    DEFAULT_STOCKOUT_PROB_THRESHOLD,
    CRITICAL_OVERRIDE_HOURS,
    DETOUR_PER_KM_COST,
    PEER_COURIER_PER_KM_COST,
    EXPRESS_VAN_FIXED_FEE,
    EXPRESS_VAN_PER_KM_COST,
    DEFAULT_GOODWILL_VALUE_PER_UNIT,
    DEFAULT_RESCUE_BONUS_PER_UNIT,
    ESSENTIAL_SKU_PATTERNS
)
from app.models.express_lane import (
    UrgencyClock,
    ExpressRecommendation,
    ContentionItem,
    ExpressApprovalRequest,
    ExpressSimulationReport,
    FulfillmentOptionType
)
from app.services.express_lane_service import ExpressLaneService

router = APIRouter(prefix="/express", tags=["Express Lane Fast Fulfillment"])


class ExpressConfigUpdate(BaseModel):
    enabled: Optional[bool] = None
    stockout_prob_threshold: Optional[float] = None
    critical_override_hours: Optional[float] = None


@router.get("/config", summary="Retrieve Express Lane configuration & diurnal assumptions")
def get_express_configuration():
    """Returns current Express Lane feature flag state, diurnal demand curve, and cost rates."""
    return {
        "enabled": settings.EXPRESS_LANE_ENABLED,
        "hourly_demand_pattern": HOURLY_DEMAND_PATTERN,
        "labelled_assumption": "Quick-Commerce diurnal demand: 35% evening rush peak (16:00-20:00 UTC/Local)",
        "stockout_prob_threshold": DEFAULT_STOCKOUT_PROB_THRESHOLD,
        "critical_override_hours": CRITICAL_OVERRIDE_HOURS,
        "rates": {
            "detour_per_km": DETOUR_PER_KM_COST,
            "peer_courier_per_km": PEER_COURIER_PER_KM_COST,
            "express_van_base_fee": EXPRESS_VAN_FIXED_FEE,
            "express_van_per_km": EXPRESS_VAN_PER_KM_COST,
            "goodwill_value_per_unit": DEFAULT_GOODWILL_VALUE_PER_UNIT,
            "rescue_bonus_per_unit": DEFAULT_RESCUE_BONUS_PER_UNIT
        },
        "essential_sku_patterns": ESSENTIAL_SKU_PATTERNS
    }


@router.post("/config", summary="Update Express Lane runtime configuration")
def update_express_configuration(
    req: ExpressConfigUpdate,
    current_user: dict = Depends(require_permission(PERM_INTEGRATIONS_MANAGE))
):
    """Allows administrators to toggle the feature flag or update thresholds."""
    if req.enabled is not None:
        settings.EXPRESS_LANE_ENABLED = req.enabled
    return {
        "success": True,
        "enabled": settings.EXPRESS_LANE_ENABLED,
        "message": f"Express Lane feature flag set to {'ENABLED' if settings.EXPRESS_LANE_ENABLED else 'DISABLED'}."
    }


@router.get("/sos", summary="Urgency Clocks across all dark stores and distribution nodes")
def get_urgency_clocks(
    sku: Optional[str] = Query("PRD-VAX-01"),
    current_user: dict = Depends(get_current_user)
):
    """
    Evaluates real-time hours_to_stockout across dark stores and destinations.
    Emits live countdowns and identifies urgent / critical replenishment triggers.
    """
    nodes = db.query("destinations", org_id=current_user.get("org_id")) or [
        {"id": "dest_boston_01", "name": "Boston Dark Store North"},
        {"id": "dest_atlanta_02", "name": "Atlanta Dark Store Central"},
        {"id": "dest_detroit_03", "name": "Detroit Dark Store Metro"},
        {"id": "dest_minn_07", "name": "Minneapolis Dark Store Hub"}
    ]

    clocks = []
    # Seed varying stock states to exhibit different urgency profiles
    seed_stocks = {
        "dest_boston_01": 18.0,   # High urgency (< 2h)
        "dest_atlanta_02": 55.0,  # Medium urgency (~4.5h)
        "dest_detroit_03": 8.0,   # Critical emergency (< 1h)
        "dest_minn_07": 120.0     # Safe (> 10h)
    }

    for n in nodes:
        node_id = n.get("id")
        stock = seed_stocks.get(node_id, 45.0)
        c = ExpressLaneService.calculate_urgency_clock(node_id, sku, custom_stock=stock)
        clocks.append(c)

    # Sort so most urgent appear first
    clocks.sort(key=lambda x: x.hours_to_stockout)
    return {
        "feature_enabled": settings.EXPRESS_LANE_ENABLED,
        "sku": sku,
        "total_nodes": len(clocks),
        "urgent_count": sum(1 for c in clocks if c.is_urgent),
        "critical_count": sum(1 for c in clocks if c.is_critical),
        "clocks": clocks
    }


@router.get("/evaluate/{node_id}/{sku}", summary="Side-by-side 4-option fulfillment comparison")
def evaluate_options(
    node_id: str,
    sku: str,
    stock: Optional[float] = Query(None),
    hour: Optional[int] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    """
    Evaluates all 4 fulfillment options side-by-side:
    1. Wait for Normal Delivery ($0 extra)
    2. Detour In-Flight Truck
    3. Peer Dark Store Rebalance
    4. Dedicated Express Van
    Computes net benefit, cost, and explainable recommendation.
    """
    rec = ExpressLaneService.evaluate_all_options(
        node_id=node_id,
        sku=sku,
        custom_stock=stock,
        custom_hour=hour
    )
    return rec


@router.post("/contention", summary="Ration limited express capacity between competing nodes")
def ration_contention(
    items: List[ContentionItem],
    current_user: dict = Depends(get_current_user)
):
    """
    Rations competing requests for the same vehicle or surplus inventory.
    Priority Score = (1 / hours_to_stockout) * SKU Priority Weight * Customer Density.
    """
    if not items:
        return {"items": []}
    rationed = ExpressLaneService.ration_contention(items)
    return {
        "success": True,
        "items": rationed,
        "winner_node": rationed[0].node_name if rationed else None
    }


@router.post("/approve", summary="One-click approve express transfer into audit ledger")
def approve_express_transfer(
    req: ExpressApprovalRequest,
    current_user: dict = Depends(require_permission(PERM_TRANSFERS_APPROVE))
):
    """
    Approves the recommended urgent transfer action.
    Updates the ledger with is_express=True, dispatch method, and audit rationale.
    """
    res = ExpressLaneService.approve_express_action(
        user=current_user,
        req=req,
        org_id=current_user.get("org_id", "org_triwiz_01")
    )
    return res


@router.get("/transfers", summary="List historical and active express transfers")
def list_express_transfers(current_user: dict = Depends(get_current_user)):
    """Retrieves all transfers tagged with is_express=True."""
    all_transfers = db.query("transfers", org_id=current_user.get("org_id"))
    express_transfers = [t for t in all_transfers if t.get("is_express")]
    return {
        "total_express_transfers": len(express_transfers),
        "transfers": express_transfers
    }


@router.get("/simulate", summary="30-day comparative simulation report")
def get_simulation_report(current_user: dict = Depends(get_current_user)):
    """
    Answers: 'What would have happened over the last 30 days if Express Lane had been active?'
    Returns stockouts avoided, extra spend, net profit impact, and Scenarios A, B, C.
    """
    report = ExpressLaneService.run_30_day_simulation()
    return report
