# StockPilot AI Chrome Extension: Comprehensive System Audit & Companion Plan

**Date**: 2026-10-25  
**Target Directory**: `extension/`  
**Platform**: StockPilot AI (Manifest V3 Chrome Extension, React + Vite Web Console, FastAPI Backend, Transactional In-Memory/Disk Store, ESP32 Smart Warehouse Telemetry)  
**Author**: Antigravity Autonomous Coding Agent (Google DeepMind)

---

## 1. Executive Summary & Architectural Integrity

StockPilot AI is a mission-critical distribution intelligence and inventory optimization platform. Its backend coordinates warehouse ledger operations, OR-Tools logistics network flow optimization, temperature/humidity cold-chain telemetry, automated restocking tasks, and strict multi-tenant Role-Based Access Control (RBAC).

The Chrome Extension (`extension/`) is designed as a **role-authorized, context-aware supply-chain companion**. It enables logistics operators, warehouse managers, distributors, and supply chain managers to access authoritative inventory intelligence and trigger operational workflows without switching away from active workstations.

### Source of Truth Verification
- **The backend database (`TransactionalDataStore` backed by `data/local_db.json`) is the sole authoritative source of truth**.
- The Chrome Extension must never maintain duplicate inventory counts, fabricate optimization metrics, or mutate state locally in `chrome.storage.local`.
- Any operational action (transfer approval, task completion, alert acknowledgment) executed from the extension must be a **real, atomic, validated backend transaction**.

---

## 2. Extension Filesystem & Dependency Audit

| File | Type | Existing State | Identified Gaps / Risks | Action Required |
| :--- | :--- | :--- | :--- | :--- |
| `extension/manifest.json` | Manifest V3 | Declares `storage`, `tabs`, host permissions for `http://localhost:8000/*`, `http://127.0.0.1:8000/*`, `http://localhost:5173/*`. | No scoped content script declared for automatic active-page SKU/batch detection. | Add strictly scoped content script (`extension/content.js`) matching only `localhost:5173`, `127.0.0.1:5173`, `https://*.stockpilot.ai/*`. |
| `extension/popup.html` | HTML5 View | 662 lines, contains `authView`, `dashView`, `configView`, `confirmModal`. | Login form pre-filled passwords in HTML or JS placeholder, tabs overly generic, no dedicated context detection banner, modal needs clear transaction warnings. | Redesign with StockPilot Design System (`#FFFFFF`, `#17324D`, `#0D9488`), clean viewport scroll, remove demo passwords, add detected SKU banner, rich inventory cards. |
| `extension/popup.js` | JS Controller | 956 lines, handles auth, fetch, tabs, search, approvals. | 1. Hits `/extension/tasks` which returned 404. 2. Search is basic name/sku substring without batch/expiry intelligence. 3. No AbortController for debounced stale search requests. 4. Lacked distinction between live ESP32 telemetry vs simulated lab alerts. | Overhaul controller with debounced search + `AbortController`, real tasks endpoint (`/tasks`), FEFO batch breakdowns, live/simulated telemetry tags, role-enforced UI contexts. |
| `extension/content.js` | Content Script | Missing | Cannot detect page context when viewing web console. | Create read-only, non-privileged content script to detect visible SKU (`data-sku` or regex `PRD-[A-Z0-9-]+`) and notify popup via message passing. |

---

## 3. Backend Endpoints, Schemas & Transactional Flows

### A. Authenticated Session Management
- `POST /api/v1/auth/login`
  - **Contract**: Accepts form/JSON credentials (`email`, `password`). Returns JWT `access_token` and `user` payload.
  - **Verification**: Verified working. Requires real registered credentials. Pre-filling or fallback dummy tokens removed.
- `GET /api/v1/extension/me`
  - **Contract**: Returns current user claims (`id`, `email`, `role`, `org_id`, `warehouse_id`, `permissions`).
  - **Security**: Validates JWT on extension startup. Expired or forged tokens fail with `401 Unauthorized` and prompt clean session logout.

### B. Context-Aware Summary & Scoping
- `GET /api/v1/extension/summary`
  - **Contract**: Scoped operational snapshot based on authenticated role and warehouse assignment:
    - `user`: Authenticated operator details.
    - `warehouse`: Assigned facility, capacity, pallet utilization.
    - `available_warehouses`: Multi-facility access for `supply_chain_manager` / `org_admin` / `super_admin`; single assigned facility for `warehouse_manager` / `operator`.
    - `low_stock_count` & `stockout_count`: Authoritative counts.
    - `stock`: Up to 12 top inventory items with available, reserved, reorder thresholds, and stock status.
    - `active_alerts`: Environmental and sensor alerts with severity, reading, threshold, and hardware tag (`ESP32 LIVE` vs `SIMULATED LAB`).
    - `expiry_alerts`: Batches approaching expiry (<30 days and <60 days).
    - `pending_transfers`: Authoritative pending transfers.
    - `recommendations_summary`: Actual OR-Tools optimization run ID, modeled savings %, allocations, and creation timestamp.

### C. Enhanced Multi-Attribute Search (`/api/v1/extension/search`)
- **Query Parameter**: `q` (min length 1, debounced 300ms in client).
- **Backend Search Attributes**:
  - SKU (e.g., `PRD-VAX-01`)
  - Product Name (e.g., `Comirnaty Ultra-Cold Vaccine`)
  - Barcode / EAN (e.g., `8901234567891`)
  - Batch Number (e.g., `BN-VX-2026-B4`)
- **Response Schema Enrichment**:
  - `product_id`, `sku`, `name`, `category`, `unit`, `handling` (`cold_chain` vs `ambient`)
  - `total_available`, `total_reserved`, `min_safety_stock`, `reorder_point`
  - `stock_status`: `CRITICAL_STOCKOUT` (avail = 0), `LOW_STOCK` (avail < reorder_point), `NORMAL`
  - `warehouses`: Breakdown of stock per authorized warehouse.
  - `batches`: FEFO batch list with `batch_number`, `expiry_date`, `days_to_expiry`, `quantity`, `storage_bin`, `is_near_expiry` (<60d).

### D. Authoritative Operational Actions
1. **Transfer Approval**: `POST /api/v1/extension/approve-transfer/{transfer_id}`
   - **Authorization**: Requires `transfers.approve` or `optimization.approve`. Restricted to `super_admin`, `org_admin`, `supply_chain_manager`, and facility-assigned `warehouse_manager`.
   - **Concurrency**: Executed inside `db.run_transaction(txn)` with atomic write lock.
   - **Verified Bug Fix**: Resolved missing `return trf` in `InventoryService.approve_or_reject_transfer` which previously returned `None` causing a FastAPI response validation error.
2. **Alert Acknowledgment**: `POST /api/v1/extension/acknowledge-alert/{alert_id}`
   - **Authorization**: Permitted for active operators and managers within the organization.
   - **Action**: Marks alert `is_acknowledged = True`, records `acknowledged_by` and timestamp, persists to ledger.
3. **Operational Restocking Task Completion**: `POST /api/v1/tasks/{task_id}/complete`
   - **Authorization**: Operators and warehouse managers assigned to the task's warehouse.
   - **Action**: Updates task status to `COMPLETED`, adds operator completion note.

---

## 4. Role-Based Access Control (RBAC) Mapping

The extension recognizes the backend's canonical 6-role hierarchy:

| Role Key | Name | Extension Capabilities & Scoping |
| :--- | :--- | :--- |
| `operator` | Warehouse Operator | Scoped strictly to assigned warehouse (`wh_chicago_01`). Sees assigned tasks, inventory search, sensor alert acknowledgment, bin locations. Transfer approvals strictly forbidden. |
| `distributor` | Logistics / Field Distributor | Scoped to dispatch orders and stock availability. Prohibited from approving network transfers or adjusting inventory counts. |
| `warehouse_manager` | Warehouse Facility Manager | Authorized for assigned facility inventory, batch FEFO expiry alerts, warehouse-level restocking tasks, and transfer approval involving assigned facility only. |
| `supply_chain_manager` | Supply Chain Manager | Network-wide multi-hub inventory intelligence, OR-Tools optimization recommendations, network transfer approval, cross-facility rebalancing. |
| `org_admin` | Organization Administrator | Organization-wide oversight, cross-warehouse audit, high-level policy governance, links to console management. |
| `super_admin` | Platform Super Administrator | Global diagnostic oversight, multi-tenant administrative controls. |

*Security Constraint*: Client-side role selection without backend re-authentication is eliminated. The backend strictly enforces authorization on every single transaction.

---

## 5. Security & Privacy Safeguards

1. **No Sensitive Data Leaks**: Passwords and bearer tokens are never logged to `console.log`.
2. **Safe Credential Storage**: Authentication tokens are stored exclusively in `chrome.storage.local`.
3. **Clean Session Teardown**: Logout clears token, user claims, and cached state immediately.
4. **Scoped Content Script**:
   - Matches ONLY internal development origins (`http://localhost:5173/*`, `http://127.0.0.1:5173/*`) and production domain (`https://*.stockpilot.ai/*`).
   - Does NOT read generic websites, form inputs, passwords, or payment fields.
   - Read-only passive observer for `[data-sku]`, `[data-batch]`, or SKU pattern text.
   - Popup requires explicit operator confirmation before executing a search for detected identifiers.
5. **DOM Injection Protection**: All dynamic text rendering in popup uses `element.textContent` and programmatic DOM nodes. Never uses `innerHTML` for untrusted backend strings.
6. **No Remote Code Execution**: No `eval()`, remote script tags, or dynamic script loading.

---

## 6. Implementation & Verification Plan

- [x] **Audit & Fix Backend Bug**: Fixed missing `return trf` in `InventoryService.approve_or_reject_transfer`. Verified passing via `pytest tests/test_extension_companion.py`.
- [x] **Create Audit Documentation**: `extension/EXTENSION_AUDIT.md`.
- [ ] **Enrich Backend Search**: Update `extension_quick_search` in `backend/app/api/v1/extension.py` with multi-attribute matching (SKU, name, barcode, batch) and batch FEFO expiry intelligence.
- [ ] **Implement Scoped Content Script**: Create `extension/content.js` and register in `extension/manifest.json`.
- [ ] **Modernize Popup UI (`popup.html`)**: Clean StockPilot design system (`#17324D`, `#0D9488`, `#FFFFFF`), role badge, sync indicator, detected SKU context bar, debounced search box, rich inventory cards, live vs simulated alerts.
- [ ] **Modernize Popup Logic (`popup.js`)**: Real auth, session restoration, AbortController search debounce, task completion, transfer approval, alert acknowledgment, safe DOM nodes.
- [ ] **Expand Test Suite**: Add comprehensive tests in `backend/tests/test_extension_companion.py` testing enriched search, batch matching, and role scoping.
- [ ] **Execute Tests & Validate**: Run pytest, verify all tests pass, and report findings.
