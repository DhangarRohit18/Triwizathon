# StockPilot AI — Distribution Intelligence & Demand Forecasting Engine

## 1. Executive Summary

StockPilot AI implements a production-grade, server-authoritative **Demand Forecasting and Distribution Optimization Engine** designed for multi-warehouse healthcare and life-science supply chain networks.

The engine algorithmically determines:
- **Which products** must be distributed,
- **From which warehouses**,
- **To which destinations** (hospitals, clinics, regional distribution centers),
- **In what exact integer quantities**, and
- **Along which freight routes**,

while simultaneously:
1. Minimizing total linehaul transportation cost,
2. Eliminating unmet demand through critical clinical service-level penalties,
3. Minimizing wastage of perishable/cold-chain medical supplies via First-Expired, First-Out (FEFO) prioritization, and
4. Strictly respecting hard operational constraints (available stock ceiling, reservations, safety stock buffers, warehouse throughput capacity, and temperature-controlled cold-chain dock limits).

All optimization decisions are server-authoritative and executed via **Google OR-Tools Mixed-Integer Linear Programming (MIP)** using the SCIP solver. Web and Flutter mobile applications consume this API directly without implementing competing or divergent solvers.

---

## 2. Mathematical Formulation

### 2.1 Sets and Indices
- $w \in W$: Set of operational warehouses / fulfillment hubs (e.g., Central Hub Chicago, East DC New York, South DC Dallas, West DC Reno).
- $d \in D$: Set of delivery destinations (e.g., Boston Medical Center, Atlanta Regional Clinic, Detroit Metropolitan Hospital, Denver Health Hub, Phoenix Southwest Medical, Seattle Clinical Care, Minneapolis Health Center, Houston Apex Pharmacy DC).
- $p \in P$: Set of pharmaceutical, biologic, and medical products (e.g., Comirnaty Vaccine, Humalog Insulin, Amoxicillin, Keytruda, Surgical Gloves, Atorvastatin).

---

### 2.2 Decision Variables
| Variable | Domain | Unit | Description |
| :--- | :--- | :--- | :--- |
| $x_{w,d,p}$ | $\mathbb{Z}_{\ge 0}$ | units | Recommended quantity of product $p$ dispatched from warehouse $w$ to destination $d$. |
| $s_{d,p}$ | $\mathbb{Z}_{\ge 0}$ | units | Unmet demand (shortage) of product $p$ at destination $d$. |
| $z_{w,p}$ | $\mathbb{Z}_{\ge 0}$ | units | Estimated remaining unallocated near-expiry stock of product $p$ at warehouse $w$. |

---

### 2.3 Model Parameters and Documented Units

| Parameter | Unit | Description | Formula / Value |
| :--- | :--- | :--- | :--- |
| $\text{dist}_{w,d}$ | km | Great-circle Haversine distance between warehouse $w$ and destination $d$. | $\text{haversine\_distance\_km}(\text{lat}_w, \text{lng}_w, \text{lat}_d, \text{lng}_d)$ |
| $C_{w,d,p}$ | USD/unit | Base linehaul freight transport cost per unit. | $\max\left(1.50, \left(0.0022 \cdot \text{dist} \cdot \max(0.5, \text{wt}_p) + 0.15 \cdot \frac{\text{dist}}{100}\right) \cdot \mu_{\text{cold}} \cdot \mu_{\text{fuel}}\right)$ |
| $\mu_{\text{cold}}$ | scalar | Cold-chain refrigeration multiplier. | $1.45$ if product handling $\in \{\text{"cold\_chain"}, \text{"deep\_freeze"}\}$, else $1.00$. |
| $\mu_{\text{fuel}}$ | scalar | Fuel and transport cost multiplier. | $1.00$ baseline (configurable up to $3.00$ in scenario tests). |
| $\text{Demand}_{d,p}$ | units | Forecasted demand requirements at destination $d$. | Calibrated baseline demand based on hospital priority level ($1, 2, 3$) $\times (1 + \text{surge}\%)$. |
| $\text{Avail}_{w,p}$ | units | Net available inventory at warehouse $w$. | $\text{TotalQuantity} - \text{ReservedQuantity} - \text{DamagedQuantity}$. |
| $\text{Safety}_{w,p}$ | units | Protected safety-stock requirement at warehouse $w$. | Calibrated product safety threshold (e.g., $40$ to $500$ units). |
| $\text{Allocable}_{w,p}$ | units | Maximum dispatchable stock obeying safety buffer. | $\max(0, \text{Avail}_{w,p} - \text{Safety}_{w,p})$; equals $0$ if warehouse $w$ is disrupted. |
| $\text{NearExp}_{w,p}$ | units | Active inventory expiring within $\le 30$ days. | Sum of active unreserved batch quantities expiring $\le 30$ days from now. |
| $\text{RiskScore}_{w,p}$ | scalar $[0, 1]$ | Expiry risk fraction of warehouse stock. | $\text{NearExp}_{w,p} / \max(1, \text{Avail}_{w,p})$. |
| $P_p^{\text{shortage}}$ | USD/unit | Unmet demand clinical disruption penalty. | $2.50 \times \text{SellingPrice}_p$ (models emergency procurement & SLA breach). |
| $P_p^{\text{wastage}}$ | USD/unit | Spoilage / disposal wastage penalty weight. | $1.20 \times \text{UnitCost}_p \times \mu_{\text{expiry\_scenario}}$. |
| $\text{CapShip}_w$ | units | Maximum daily shipping dock throughput capacity. | $7,500$ to $14,000$ units per warehouse per dispatch cycle. |
| $\text{CapCold}_w$ | units | Refrigerated cold-chain dispatch staging capacity. | $2,500$ to $5,000$ units per warehouse per dispatch cycle. |

---

### 2.4 Explicit Objective Function

The objective function minimizes total modeled system cost across freight logistics, unmet demand penalties, and unmitigated expiry wastage:

$$\min Z = \sum_{w \in W} \sum_{d \in D} \sum_{p \in P} C'_{w,d,p} \cdot x_{w,d,p} + \sum_{d \in D} \sum_{p \in P} P_p^{\text{shortage}} \cdot s_{d,p} + \sum_{w \in W} \sum_{p \in P} P_p^{\text{wastage}} \cdot z_{w,p}$$

where:
$$C'_{w,d,p} = \max\left(0.10, \; C_{w,d,p} - \left(\text{RiskScore}_{w,p} \cdot 0.85 \cdot \mu_{\text{expiry\_scenario}}\right)\right)$$

The negative discount term $-(\text{RiskScore}_{w,p} \cdot 0.85)$ acts as an operational incentive: when multiple warehouses hold stock of the same SKU, the optimizer will proactively draw down inventory from the facility facing near-term batch expiration, preventing clinical product loss.

---

### 2.5 Hard Constraints

1. **Available Inventory Ceiling (No Phantom Stock / Non-Negative Allocations)**:
   $$\sum_{d \in D} x_{w,d,p} \le \text{Allocable}_{w,p} \quad \forall w \in W, \; \forall p \in P$$
   *Guarantee*: Never allocates unavailable stock, reserved stock, or stock held in disrupted facilities.

2. **Demand Fulfillment & Non-Negative Shortage Conservation**:
   $$\sum_{w \in W} x_{w,d,p} + s_{d,p} = \text{Demand}_{d,p} \quad \forall d \in D, \; \forall p \in P$$
   $$0 \le \sum_{w \in W} x_{w,d,p} \le \text{Demand}_{d,p}, \quad s_{d,p} \ge 0$$
   *Guarantee*: Destinations never receive more than their demand requirements. Unmet demand is explicitly captured in $s_{d,p}$.

3. **Warehouse Shipping Throughput Capacity Limit**:
   $$\sum_{d \in D} \sum_{p \in P} x_{w,d,p} \le \text{CapShip}_w \quad \forall w \in W$$
   *Guarantee*: Physical loading dock, material handling equipment, and staff throughput limits are respected.

4. **Warehouse Cold-Chain Staging Capacity Limit**:
   $$\sum_{d \in D} \sum_{p \in P_{\text{cold}}} x_{w,d,p} \le \text{CapCold}_w \quad \forall w \in W$$
   where $P_{\text{cold}} = \{p \in P \mid \text{handling}_p \in (\text{"cold\_chain"}, \text{"deep\_freeze"})\}$.
   *Guarantee*: Temperature-controlled docks are never overwhelmed.

5. **Linearized Wastage Tracking**:
   $$z_{w,p} \ge \text{NearExp}_{w,p} - \sum_{d \in D} x_{w,d,p} \quad \forall w \in W, \; \forall p \in P$$
   $$z_{w,p} \ge 0$$
   *Guarantee*: Unshipped near-expiry stock directly incurs the documented wastage penalty $P_p^{\text{wastage}}$.

6. **Integrity and Non-Negativity**:
   $$x_{w,d,p} \in \mathbb{Z}_{\ge 0}, \quad s_{d,p} \in \mathbb{Z}_{\ge 0}, \quad z_{w,p} \in \mathbb{Z}_{\ge 0}$$

---

### 2.6 Infeasibility Detection & Guarantees
If solver parameters or constraints cannot be simultaneously satisfied (e.g. zero inventory across network while non-zero demand cannot accept shortages, or conflicting manual overrides):
- The solver **never** outputs a corrupted or invented allocation plan.
- The engine marks `hard_constraints_satisfied = False`, sets `solver_status = "INFEASIBLE"`, populates `diagnostic_messages` detailing the infeasibility source, and returns 0 units allocated with 100% unmet demand reported.

---

## 3. Transparent Baseline Heuristic (Greedy Nearest-Warehouse)

To evaluate the mathematical value added by Google OR-Tools MIP, the engine runs an independent **Greedy Nearest-Warehouse Heuristic** alongside every optimization run:

1. For each destination $d$ and product $p$:
   - Sort all operational warehouses in ascending order of geographic Haversine distance: $\text{dist}_{w,d}$.
   - Progressively allocate allocable stock from the nearest warehouse until destination demand is fulfilled or warehouse stock is exhausted.
2. The greedy heuristic does not optimize global multi-commodity network flow, ignores warehouse dock congestion, and does not evaluate FEFO expiry risks.
3. Total modeled costs, freight charges, shortage penalties, and unmitigated wastage costs are calculated for both approaches and compared side-by-side:
   $$\text{Savings Amount} = \max\left(0, \; \text{Cost}_{\text{Baseline}} - \text{Cost}_{\text{MIP}}\right)$$
   $$\text{Savings Percent} = \frac{\text{Savings Amount}}{\max(1, \text{Cost}_{\text{Baseline}})} \times 100\%$$

---

## 4. Demand Forecasting Engine

### 4.1 Methodology
The Demand Forecasting Engine combines two methodologies:
1. **Baseline 7-Day Moving Average**: Rolling mean over the previous 7 days of historical demand.
2. **Machine Learning Ridge Time-Series Regression**: Scikit-Learn Ridge linear model regularized with $\alpha = 1.0$.

### 4.2 Feature Engineering
The ML model trains on calibrated historical daily demand series with:
- **Linear Trend**: Time index $t \in [0, N-1]$ capturing structural demand growth.
- **Weekly Cyclical Seasonality**: $\sin\left(\frac{2\pi \cdot \text{day\_of\_week}}{7}\right)$ and $\cos\left(\frac{2\pi \cdot \text{day\_of\_week}}{7}\right)$ capturing day-of-week clinical order cycles.
- **Calendar Day of Month**: Captures monthly replenishment surges.

### 4.3 Chronological Holdout Evaluation & Metrics
The model strictly adheres to temporal validation to prevent data leakage:
- **Historical Series**: 90 days.
- **Training Sample**: First 76 days ($t = 0 \dots 75$).
- **Validation Holdout Sample**: Final 14 days ($t = 76 \dots 89$).

Reported Evaluation Metrics:
- **Mean Absolute Error (MAE)**:
  $$\text{MAE} = \frac{1}{H} \sum_{i=1}^H |y_i - \hat{y}_i|$$
- **Root Mean Squared Error (RMSE)**:
  $$\text{RMSE} = \sqrt{\frac{1}{H} \sum_{i=1}^H (y_i - \hat{y}_i)^2}$$
- **Coefficient of Determination ($R^2$)**:
  $$R^2 = 1 - \frac{\sum_{i=1}^H (y_i - \hat{y}_i)^2}{\sum_{i=1}^H (y_i - \bar{y})^2}$$
- **Mean Absolute Percentage Error (MAPE)**:
  $$\text{MAPE} = \frac{100\%}{H} \sum_{i=1}^H \left| \frac{y_i - \hat{y}_i}{\max(1, y_i)} \right|$$

Baseline 7-Day Moving Average MAE and RMSE are computed on the **exact same holdout window** for fair chronological comparison.

### 4.4 Confidence Intervals
Projected future demand points include 95% confidence intervals based on the holdout standard error $\text{RMSE}$:
$$\hat{y}_t \pm 1.96 \cdot \text{RMSE}$$

### 4.5 Data Provenance & Ethics
All historical benchmark series are explicitly labeled with `data_provenance = "calibrated_synthetic_historical_series"`. No patient health information (PHI) or proprietary customer transaction data was fabricated.

---

## 5. Scenario Simulation Framework

The engine natively supports four real-world stress-test scenarios:

| Scenario | Parameter | Operational Impact | Verified Engine Behavior |
| :--- | :--- | :--- | :--- |
| **Demand Surge** | `demand_surge_percent = +50%` | Regional epidemic, emergency hospital surge. | Demand scales $\times 1.50$, allocations increase, shortage penalties trigger if capacity is exceeded. |
| **Warehouse Outage** | `disrupted_warehouse_ids = ["wh_chicago_01"]` | Severe weather, dock strike, power outage. | 0 units dispatched from Chicago ($\sum_{d,p} x_{\text{chi},d,p} = 0$). Demand reroutes to Dallas & NY. |
| **Fuel Freight Spike** | `fuel_transport_cost_multiplier = 1.8x` | Diesel fuel price surge, geopolitical disruption. | Unit freight costs increase; solver favors shorter linehauls. |
| **Approaching Expiry** | `expiring_soon_penalty_multiplier = 2.5x` | Batches within 30 days of shelf life limit. | Solver prioritizes shipping near-expiry lots (e.g. NY Insulin expiring in 18 days) to eliminate wastage. |

---

## 6. Verified Deterministic Test Suite

The test suite in [test_optimization_and_forecasting.py](file:///c:/Users/user/OneDrive/Desktop/Competition/TRIWIZATHON/backend/tests/test_optimization_and_forecasting.py) verifies all mathematical and operational requirements:

1. `test_haversine_distance_calculation`: Verifies great-circle distances match geographic benchmarks (~1145 km Chicago to Newark).
2. `test_optimization_feasibility_and_non_negative_allocations`: Confirms integer non-negative solutions ($x \ge 0, C \ge 0$).
3. `test_inventory_ceiling_and_safety_stock_hard_constraint`: Proves allocated stock never exceeds available stock minus safety buffer.
4. `test_warehouse_shipping_dock_capacity_limit`: Proves warehouse dock throughput limits are strictly obeyed.
5. `test_insufficient_inventory_and_demand_shortage_detection`: Proves engine never invents phantom stock when inventory is depleted.
6. `test_disruption_warehouse_outage_scenario`: Proves 0 units leave disrupted hubs; network reroutes to operational sites.
7. `test_demand_spike_scenario`: Proves demand and modeled cost scale predictably under +50% demand spikes.
8. `test_transport_fuel_cost_increase_scenario`: Proves transportation costs increase under fuel surcharges.
9. `test_approaching_expiry_fefo_prioritization`: Proves near-expiry batches receive priority routing.
10. `test_baseline_heuristic_comparison`: Proves OR-Tools MIP achieves $\le$ cost compared to Greedy Nearest-Warehouse.
11. `test_product_forecast_generation_and_provenance`: Confirms provenance labeling and version metadata.
12. `test_chronological_evaluation_metrics`: Verifies chronological holdout evaluation and metric bounds ($RMSE \ge MAE$).
13. `test_timeline_structure_and_confidence_bounds`: Confirms 95% confidence intervals and timeline format.

---

## 7. Client Integration (Web Dashboard & Flutter Mobile)

```
┌────────────────────────────────────────────────────────┐
│           StockPilot AI Client Applications            │
│  - Web Dashboard (React + TypeScript + Recharts)      │
│  - Mobile Application (Flutter Android + Riverpod)     │
└───────────────────────────┬────────────────────────────┘
                            │ (HTTP GET/POST)
                            ▼
┌────────────────────────────────────────────────────────┐
│               FastAPI Authoritative API                │
│  - POST /api/v1/optimization/run                       │
│  - GET  /api/v1/optimization/runs                      │
│  - GET  /api/v1/optimization/run/{run_id}              │
│  - GET  /api/v1/forecast/product/{product_id}          │
│  - GET  /api/v1/forecast/evaluation/{product_id}       │
└───────────────────────────┬────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
┌───────────────────────────┐ ┌───────────────────────────┐
│  Google OR-Tools SCIP MIP │ │ Scikit-Learn Ridge ML     │
│  Constrained Optimization │ │ Demand Forecasting        │
│  - Multi-commodity flow   │ │ - Cyclical calendar       │
│  - FEFO expiry bonus      │ │ - Chronological holdout   │
│  - Safety stock buffer    │ │ - MAE, RMSE, R², MAPE     │
│  - Warehouse throughput   │ │ - 95% confidence bounds   │
└───────────────────────────┘ └───────────────────────────┘
```

Clients are strictly presentation layers and do not run competing optimization algorithms.
- **Web App**: Allows supply chain managers to simulate disruptions, adjust fuel/expiry sliders, view the Recharts cost comparison, and inspect per-route allocation recommendations.
- **Flutter App**: Supply chain mobile users view the authoritative allocation recommendations directly on the mobile dashboard and transfers tabs via `OptimizationRepository`.
