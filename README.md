# STOCKPILOT AI
### Triwizathon Problem Statement 2: Distribution Intelligence & Inventory Optimization Engine

**STOCKPILOT AI** is an enterprise-grade multi-warehouse distribution intelligence and inventory optimization platform. It algorithmically solves the core supply chain challenge: **recommending what products to distribute, in what quantities, from which warehouses, and to which destinations**, while minimizing total distribution cost, stockouts, unnecessary freight movement, and expiry-related wastage under strict operational constraints.

---

## 🌟 Architectural Highlights

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           STOCKPILOT AI ARCHITECTURE                            │
└─────────────────────────────────────────────────────────────────────────────────┘
              │
              ├──► Web Console (React 19 + TypeScript + Vite + Tailwind CSS v4)
              │    ├── Adaptive Dashboards for 6 Enterprise Roles
              │    ├── OR-Tools Scenario Simulation Studio & Cost Comparison
              │    ├── Recharts Predictive Demand Forecaster (Holdout MAE / RMSE)
              │    ├── Interactive Distribution Network Topography Map (SVG)
              │    ├── IoT Storage Thermal Monitor & Interactive Telemetry Injector
              │    ├── QR & Barcode Scanner with Thermal Pallet Label Generator
              │    └── WhatsApp Business Cloud API Chatbot Simulator
              │
              ├──► Chrome Manifest V3 Extension (extension/)
              │    ├── One-Click SKU Quick Lookup
              │    ├── Assigned Warehouse Inventory Summary
              │    └── Real-time Cold-Chain Excursion Alerts & Transfer Approvals
              │
              ├──► High-Performance Backend (FastAPI + Python 3.12+ / 3.14)
              │    ├── Google OR-Tools SCIP Mixed-Integer Linear Programming (MIP)
              │    ├── Scikit-Learn Demand Forecasting (Ridge Time-Series Model)
              │    ├── Concurrency-Safe Atomic Stock Mutations & Idempotency Engine
              │    ├── Append-Only Immutable Inventory Movement Ledger
              │    ├── Authenticated IoT ESP32 Telemetry Ingestion API (X-IoT-Key)
              │    └── Meta WhatsApp Cloud API Webhook Handler (HMAC-SHA256)
              │
              └──► Persistence & Security Layer (Firebase / Firestore)
                   ├── Multi-Tenant Scoping (org_id = org_triwiz_01)
                   ├── Production firestore.rules with 6-Role Privilege Checks
                   ├── Composite Indexes (firestore.indexes.json)
                   └── Zero-Config JSON Transactional Engine for Instant Dev
```

---

## 👥 6-Tier Role-Based Access Control (RBAC)

The application provides an instant **Role Switcher** in the top navigation bar so judges and evaluators can immediately experience the bespoke workspace for each role:

| Role | Seed Email | Password | Primary Scope & Workflows |
|---|---|---|---|
| **Super Admin** | `superadmin@stockpilot.ai` | `Admin123!` | Multi-tenant governance, system health metrics, global audit ledger, and operational error monitoring. |
| **Organization Admin** | `orgadmin@stockpilot.ai` | `Admin123!` | Product catalog, warehouse creation, operator invitations, safety stock policies, and cross-hub analytics. |
| **Supply Chain Manager** | `supplychain@stockpilot.ai` | `Admin123!` | Network-wide inventory, Google OR-Tools optimization runs, black-swan disruption simulation, and transfer approvals. |
| **Warehouse Manager** | `warehouse.manager@stockpilot.ai` | `Admin123!` | Hub stock levels, incoming/outgoing dispatches, batch FEFO shelf-life control, and IoT cold-chain sensor alerts. |
| **Distributor** | `distributor@stockpilot.ai` | `Admin123!` | Assigned destination hospital orders, dispatch fulfillment tracking, and logistics exception recording. |
| **Warehouse Operator** | `operator@stockpilot.ai` | `Admin123!` | Barcode/QR scanning, stock receipts, pick-and-pack orders, cycle count adjustments, and damage reporting. |

---

## 🧮 Google OR-Tools Distribution Optimization Engine

Unlike static dashboards or simple rule-based chatbots, STOCKPILOT AI executes a true **Mixed-Integer Linear Program (MIP)** using Google OR-Tools (`SCIP` solver):

### Mathematical Formulation
$$\min \sum_{w, d, p} c_{w, d, p} \cdot x_{w, d, p} + \sum_{d, p} P^{\text{short}}_{d, p} \cdot s_{d, p} - \sum_{w, p} \beta^{\text{FEFO}}_{w, p} \cdot x_{w, d, p}$$

### Constraints Enforced:
1. **Available Stock Constraint:** $\sum_d x_{w, d, p} \le \text{Available}_{w, p}$
2. **Throughput Capacity:** Total pallets distributed through warehouse cannot exceed physical dock throughput capacity.
3. **Demand Balance:** $\sum_w x_{w, d, p} + s_{d, p} = \text{Demand}_{d, p}$
4. **FEFO Priority:** Inventory batches with $\le 30$ days remaining shelf-life receive prioritized routing bonuses to eliminate wastage.
5. **Warehouse Disruption Constraints:** When a hub is disrupted (e.g. blizzard, strike), its available capacity is zeroed, forcing OR-Tools to reroute freight dynamically across alternative hubs.

### Transparent Baseline Comparison:
Every optimization run outputs side-by-side metrics against a **Greedy Nearest-Warehouse Baseline Heuristic**:
- **Total Modeled Cost ($)**
- **Demand Fill Rate (%)**
- **Shortage Stockout Units**
- **Estimated Wastage Spoilage (Units)**
- **Verified Algorithm Savings ($ and %)**
- **Solver Execution Time (ms)**

---

## 🚀 Quick Start Guide

### Prerequisites
- **Node.js** v18+ or v20+ (`node -v`)
- **Python** 3.10+ to 3.14 (`python --version`)
- **npm** v9+ (`npm -v`)

---

### Option 1: Local Development (Recommended for Fast Verification)

#### 1. Start the Backend API Server
```powershell
# Navigate to the backend directory
cd backend

# Install dependencies
pip install -r requirements.txt

# Start the FastAPI server on port 8000
python -m uvicorn app.main:app --reload --port 8000
```
- **Interactive Swagger Docs:** [http://localhost:8000/docs](http://localhost:8000/docs)
- **Alternative Redoc:** [http://localhost:8000/redoc](http://localhost:8000/redoc)
- **Health Check:** [http://localhost:8000/health](http://localhost:8000/health)

#### 2. Start the Frontend React Web Application
In a separate terminal:
```powershell
# Navigate to the frontend directory
cd frontend

# Install dependencies (if not already installed)
npm install

# Start Vite development server
npm run dev
```
- Open **[http://localhost:5173](http://localhost:5173)** in your browser.

---

### Option 2: Docker Compose Deployment
```bash
# Build and run backend and frontend containers
docker-compose up --build
```
- Web Application: `http://localhost:5173`
- Backend API: `http://localhost:8000`

---

## 🧪 Running Automated Tests

Run the complete automated Pytest test suite covering the optimization solver, scenario disruptions, atomic inventory transactions, cold-chain IoT excursions, and WhatsApp command routing:

```powershell
cd backend
python -m pytest tests/ -v
```

**Test Coverage Summary:**
- `test_optimizer_baseline_vs_ortools`: Verifies Google OR-Tools SCIP solver produces valid non-negative integer allocations and outperforms the greedy baseline heuristic.
- `test_optimizer_warehouse_disruption_scenario`: Verifies that zeroing Chicago Hub reroutes all hospital demand to New York, Dallas, and Reno hubs.
- `test_receive_and_dispatch_with_idempotency`: Verifies atomic inventory mutations, over-dispatch prevention, and duplicate correlation ID rejection (HTTP 409).
- `test_iot_telemetry_excursion_alert`: Verifies authenticated ingestion via `X-IoT-Key` and cold-chain temperature breach alerts.
- `test_whatsapp_status_and_stock_command`: Verifies deterministic NLP commands (`STATUS`, `STOCK PRD-VAX-01`).

---

## 🧩 Chrome Manifest V3 Extension

A separate browser extension is provided in `extension/` for quick-access inventory inspection and one-click transfer approvals:

1. Open Google Chrome and visit `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the folder:
   `TRIWIZATHON/extension`
4. Click the **StockPilot AI** icon in your toolbar to:
   - Search SKUs instantly
   - Inspect assigned warehouse inventory levels
   - View live cold-chain alerts
   - Deep-link directly into the main web console

---

## 📱 WhatsApp Business Cloud API & Webhook Simulator

### Production Setup
1. Configure a Meta for Developers app with **WhatsApp Business Platform Cloud API**.
2. Set Webhook Callback URL to:
   `https://<your-domain>/api/v1/whatsapp/webhook`
3. Enter Verify Token: `stockpilot_triwiz_verify_2026`.
4. Subscribe to the `messages` event.

### Interactive UI Simulator
Because reviewers may not have active Meta Business credentials during evaluation, STOCKPILOT AI provides a **Live WhatsApp Simulator** under `/whatsapp`:
- Type commands directly (`STATUS`, `STOCK PRD-VAX-01`, `ALERTS`, `TRANSFERS`, `APPROVE trf_001_chi_ny`).
- Test permission checks (only managers can approve transfers!).
- Review logged inbound webhooks and HMAC signatures.

### Admin-Controlled WhatsApp User Registration & Role Assignment
Administrators can securely manage users and assign permissions directly via WhatsApp:

#### Supported Commands Grammar:
1. **General & Identity Commands (Read-only)**:
   - `HELP` / `MENU`: Displays role-scoped available commands (administrators see `USER ...` commands).
   - `WHOAMI`: Displays sender's name, registered phone number, assigned role, organization, warehouse scope, and active status.
   - `MYROLE`: Displays current assigned role and human-readable title.
   - `STATUS`: Displays authorized network inventory summary and monitored warehouse status.

2. **User Management & Role Assignment (Admins only)**:
   - `USER ADD <phone> [role]`: Generates a pending invitation for the target mobile number with a single-use 6-digit numeric challenge code (expires in 24h, max 5 attempts).
   - `USER ROLE <phone> <role>`: Reassigns a user's role across the 6 supported roles (`super_admin`, `org_admin`, `supply_chain_manager`, `warehouse_manager`, `operator`, `distributor`). Enforces role hierarchy (Org Admins cannot assign Super Admin) and protects the organization's final active administrator.
   - `USER WAREHOUSE <phone> <warehouse_id>`: Assigns an authorized warehouse location scope.
   - `USER REMOVE-WAREHOUSE <phone> <warehouse_id>`: Removes an assigned warehouse scope.
   - `USER SHOW <phone>`: Displays the target user's allowed profile details, role, and location scopes.
   - `USER DISABLE <phone>`: Deactivates target user access without deleting audit history.
   - `USER ENABLE <phone>`: Re-enables account access.
   - `USER LIST`: Lists registered users and pending invitations within the administrator's organization scope.

3. **Target User Verification & Activation**:
   - `CONFIRM <code>` or `VERIFY <code>`: The recipient of an invitation verifies their identity using the single-use 6-digit code. Upon confirmation, their WhatsApp number is bound, role permissions activated, and notifications dispatched to both user and administrator.

4. **Secure Initial Administrator Bootstrap**:
   - Initial administrator enrollment requires an independently trusted setup process using `ADMIN_BOOTSTRAP_SECRET`.
   - Via WhatsApp: `BOOTSTRAP <secret_token> [role]`
   - Via REST Endpoint: `POST /api/v1/whatsapp/admin/bootstrap`
   - Via Web Dashboard: `POST /api/v1/whatsapp/admin/bind-phone`
   - Unregistered senders cannot declare themselves administrators. Once bootstrapped, the initial setup is permanently locked.

---

## 🌡️ IoT Cold-Chain Hardware Telemetry

- **Secure Ingestion Endpoint:** `POST /api/v1/iot/telemetry`
- **Authentication Header:** `X-IoT-Key: stockpilot-iot-secure-esp32-auth-token`
- **Supported Sensors:** Temperature, Humidity, Cold Room Door Open Sensor, Battery Health.
- **Interactive Telemetry Injector:** Navigate to `/iot` in the web application to inject simulated temperature spikes (e.g. +14.5°C) and observe cold-chain breach alerts trigger in real time.

---

## 🔒 Firebase Architecture & Security

- **`firebase/firestore.rules`**: Production-ready security rules enforcing organization tenant isolation (`org_id`), role-based read/write access, and immutable append-only ledgers for inventory movements.
- **`firebase/firestore.indexes.json`**: Composite indexes for high-throughput queries.
- **`firebase/SCHEMA.md`**: Complete schema specifications with field types, subcollections, and rolling 30-day retention policies.

---

## 📋 Acceptance Criteria Checklist

- [x] **Role-Specific Dashboards:** All 6 enterprise roles implemented with custom views.
- [x] **User Provisioning:** Organization Admin can invite operators and assign warehouses.
- [x] **Inventory & Transaction Ledger:** Concurrency-safe atomic mutations with append-only ledger and idempotency keys.
- [x] **QR & Barcode Workflow:** Unique QR generation, camera/string scanner resolution, and printable batch tags.
- [x] **Google OR-Tools Optimization Engine:** SCIP MIP solver comparing modeled cost against baseline greedy heuristic.
- [x] **Scenario Simulation:** Interactive toggles for warehouse disruptions, demand surges, and fuel spikes.
- [x] **Demand Forecasting:** Scikit-learn Ridge regression with 14-day holdout validation (MAE, RMSE, R²).
- [x] **IoT Cold-Chain Telemetry:** Authenticated ESP32 ingestion endpoint and live UI simulator.
- [x] **WhatsApp Cloud API Integration:** Verified webhook, HMAC signature checks, deterministic commands, and interactive chat simulator.
- [x] **Chrome Manifest V3 Extension:** Standalone extension with SKU search, stock alerts, and deep links.
- [x] **Automated Tests:** 5/5 Pytest test suites passing.
- [x] **Docker Deployment:** `docker-compose.yml` with multi-stage production Dockerfiles.
