"""
=============================================================================
StockPilot AI - Express Lane Fast-Fulfillment Core Configuration & Assumptions
=============================================================================
Defines labelled assumptions, transport unit economics, and urgency thresholds
for quick-commerce / dark-store fast replenishment (Blinkit / Zepto model).
"""

from typing import Dict, Any

# -----------------------------------------------------------------------------
# 1. Labelled Assumption: Diurnal Hourly Demand Distribution
# -----------------------------------------------------------------------------
# Quick-commerce dark stores exhibit pronounced evening order spikes.
# Daily demand is allocated across 6 four-hour windows summing to 1.00 (100%).
HOURLY_DEMAND_PATTERN: Dict[str, float] = {
    "00-04": 0.05,  # Late Night / Early Dawn: 5% of daily volume
    "04-08": 0.10,  # Early Morning Rush: 10%
    "08-12": 0.20,  # Noon / Lunch Peak: 20%
    "12-16": 0.20,  # Afternoon Operations: 20%
    "16-20": 0.35,  # Evening Quick-Commerce Peak (Labelled Assumption): 35%
    "20-24": 0.10,  # Night Wind-down: 10%
}

# -----------------------------------------------------------------------------
# 2. Urgency Clock & SOS Trigger Thresholds
# -----------------------------------------------------------------------------
# Automatically triggered when Probability(stockout before next delivery) > threshold
DEFAULT_STOCKOUT_PROB_THRESHOLD: float = 0.50

# Critical emergency override threshold (hours to stockout)
CRITICAL_OVERRIDE_HOURS: float = 1.0

# -----------------------------------------------------------------------------
# 3. Unit Economics & Transport Cost Models
# -----------------------------------------------------------------------------
# Option A: Wait for Scheduled Freight
WAIT_EXTRA_COST: float = 0.0

# Option B: Truck In-Flight Detour
DETOUR_PER_KM_COST: float = 1.50     # Extra diesel + driver detour rate ($/km)
DETOUR_SPEED_KMH: float = 60.0       # Average highway truck speed (km/h)

# Option C: Peer Dark Store Rebalance (Courier / Mini-Van)
PEER_COURIER_PER_KM_COST: float = 0.85  # Local point-to-point courier rate ($/km)
PEER_SPEED_KMH: float = 45.0            # Urban courier travel speed (km/h)
PEER_P90_SAFETY_BUFFER_RATIO: float = 1.28  # Multiplier on lead-time demand to preserve P90 buffer

# Option D: Dedicated Express Van Dispatch (From Regional DC)
EXPRESS_VAN_FIXED_FEE: float = 45.00    # Base call-out and loading fee ($)
EXPRESS_VAN_PER_KM_COST: float = 1.20   # Express mileage surcharge ($/km)
EXPRESS_VAN_SPEED_KMH: float = 75.0     # Express arterial highway transit speed (km/h)

# -----------------------------------------------------------------------------
# 4. Valuation & Decision Parameters
# -----------------------------------------------------------------------------
DEFAULT_GOODWILL_VALUE_PER_UNIT: float = 5.00  # Customer lifetime retention / loyalty value
DEFAULT_RESCUE_BONUS_PER_UNIT: float = 2.50    # Benefit for preventing impending FEFO waste at donor
DEFAULT_GROSS_MARGIN_RATIO: float = 0.35       # Default product margin when not specified

# Essential products list requiring strict critical override protection
ESSENTIAL_SKU_PATTERNS = ["PRD-VAX", "PRD-INS", "PRD-BIO", "VAX", "INSULIN"]
