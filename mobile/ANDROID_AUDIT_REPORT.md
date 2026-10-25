# StockPilot AI Android Mobile App: Comprehensive Source Audit & Hardening Report

**Date**: 2026-10-25  
**Target**: `mobile/` (Flutter / Dart, Riverpod, GoRouter, Dio, SharedPreferences, MobileScanner)  
**Platform**: Android Enterprise Warehouse & Distribution Operations Companion  
**Author**: Antigravity Autonomous Coding Agent (Google DeepMind)

---

## 1. Executive Summary & Architecture Overview

The StockPilot AI Android application (`mobile/`) is designed as a mission-critical mobile client for warehouse floor operations, multi-hub inventory audits, batch FEFO monitoring, transfer management, and barcode/QR scanning. It interfaces with the same FastAPI backend (`http://localhost:8000/api/v1` or Android emulator host `http://10.0.2.2:8000/api/v1`) and data layer as the web dashboard and Chrome Extension.

### Architectural Structure:
- **Presentation Layer**: Flutter widgets and screens organized by feature in `lib/features/` (`auth`, `dashboard`, `inventory`, `iot`, `scanning`, `tasks`, `transfers`).
- **State Management & Routing**: `flutter_riverpod` (v2.6.1) StateNotifiers and FutureProviders; `go_router` (v14.8.1) declarative navigation with role-based routing guards.
- **Networking**: `dio` (v5.8.0+1) with request interceptor injecting JWT bearer tokens and error mapping to typed `AppException` subclasses (`AuthException`, `PermissionDeniedException`, `ValidationException`, `NetworkException`, `ServerException`).
- **Persistence**: `shared_preferences` (v2.5.2) for token, role, facility assignment, custom base URL, and offline pending queue.

---

## 2. Feature Implementation Status Matrix

| Feature / Domain | UI Screen / Entry | Riverpod Provider | Repository / Client | Backend Endpoint | Status / Audit Finding |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Authentication & Session** | `login_screen.dart` | `authNotifierProvider` | `AuthRepository` | `POST /auth/login`, `GET /auth/me` | **Risk**: Hardcoded pre-filled credentials (`operator@stockpilot.ai` / `Admin123!`), fallback to demo credentials if empty, and 1-tap quick role chips. |
| **Profile & Endpoint Config** | `profile_screen.dart` | `authStateProvider`, `apiClientProvider` | `ApiClient` | Local config & `ApiClient.updateBaseUrl` | **Broken**: Editing URL in Profile screen modified `ApiConfig._customUrl` in-memory only; never called `apiClient.updateBaseUrl()` or saved to `SharedPreferences`, causing the active Dio instance to ignore changes. No URL syntax validation or HTTPS enforcement. |
| **Role-Specific Dashboards** | `dashboard_screen.dart` | `inventoryListProvider`, `iotDevicesProvider`, `transfersListProvider` | `InventoryRepository`, `TransferRepository`, `IoTRepository` | `/inventory`, `/transfers`, `/iot/devices`, `/tasks` | **Defects**: 1) Super Admin dashboard hardcoded 4 static nodes. 2) Warehouse Manager fabricated a fake `IoTDeviceModel(currentTemp: 4.2)` when no hardware was present. 3) Distributor hid network errors behind `"Live"` / `"In Fleet"` labels. |
| **Inventory & FEFO Batches** | `inventory_list_screen.dart` | `inventoryListProvider`, `batchesListProvider` | `InventoryRepository` | `GET /inventory`, `GET /inventory/batches` | **Risk**: Silent fallback to `_getDemoInventory()` and `_getDemoBatches()` upon network failure. Silent default to `'wh_chicago_01'` when user warehouse is unset. |
| **Barcode & QR Scanning** | `qr_scan_screen.dart`, `qr_resolve_sheet.dart` | `inventoryRepositoryProvider` | `InventoryRepository` | `GET /products/resolve-qr` | **Incomplete/Risk**: `resolveQrCode` silently fell back to `_demoResolve(code)` on network failure. `_warehouseId` in `qr_resolve_sheet.dart` silently defaulted to `'wh_chicago_01'`. |
| **Stock Inbound (Receiving)** | `receive_stock_screen.dart`, `qr_resolve_sheet.dart` | `inventoryRepositoryProvider` | `InventoryRepository.receiveStock` | `POST /inventory/receive` | Working with server idempotency key. Defect: Defaults to `'wh_chicago_01'` if user has no assigned facility. |
| **Stock Outbound (Dispatch)** | `dispatch_stock_screen.dart`, `qr_resolve_sheet.dart` | `inventoryRepositoryProvider` | `InventoryRepository.dispatchStock` | `POST /inventory/dispatch` | Working with server idempotency key. Defect: Defaults to `'wh_chicago_01'` if user facility is unset. |
| **Physical Cycle Count** | `qr_resolve_sheet.dart` | `inventoryRepositoryProvider` | `InventoryRepository.cycleCount` | `POST /inventory/cycle-count` | Working with variance recording. |
| **Warehouse Tasks** | `tasks_screen.dart` | `tasksListProvider` | `TaskRepository` | `GET /tasks`, `POST /tasks/{id}/complete` | Real integration working end-to-end. |
| **Transfers & Approvals** | `transfers_screen.dart` | `transfersListProvider`, `pendingTransfersProvider` | `TransferRepository` | `GET /transfers`, `POST /transfers/approve` | **Risk**: `getTransfers()` silently returned `_getDemoTransfers()` on error. |
| **OR-Tools Optimization** | `dashboard_screen.dart` | `recommendationsProvider` | `OptimizationRepository` | `GET /optimization/runs` | **Risk**: Silently fell back to `_getDemoRecommendations()` when empty or server unreachable. |
| **IoT Telemetry & Alerts** | `iot_monitor_screen.dart` | `iotDevicesProvider`, `iotAlertsProvider` | `IoTRepository` | `GET /iot/devices`, `GET /iot/alerts`, `POST /iot/alerts/{id}/acknowledge` | **Risk**: Silently returned `_getDemoDevices()` and `_getDemoAlerts()` on error. |
| **Offline Sync Queue** | `offline_banner.dart` | `localStorageProvider`, `pendingSyncCountProvider` | `LocalStorageService` | Local SharedPreferences queue | Stores pending operations with correlation IDs. Needs explicit pending status rather than masquerading as committed. |

---

## 3. Detailed Audit Findings & Risks

### A. Misleading Demo Behavior & Silent Data Fallbacks (Phase 2)
1. **Login Credentials**: `login_screen.dart` initialized text controllers with `'operator@stockpilot.ai'` and `'Admin123!'`. If fields were left blank or emptied, lines 32–33 auto-substituted these demo credentials. Quick-role chips on lines 249–261 executed 1-tap logins with demo passwords.
2. **Fake Repositories Records**: When the backend server was offline or unreachable, `InventoryRepository`, `TransferRepository`, `IoTRepository`, and `OptimizationRepository` silently caught all exceptions and returned synthetic demo records (`_getDemoInventory()`, `_getDemoTransfers()`, `_getDemoDevices()`, `_getDemoRecommendations()`). This misled operators into believing fabricated records were authoritative live inventory counts.

### B. Warehouse and Tenant Scoping Bugs (Phase 3)
1. **Silent Fallback to `wh_chicago_01`**:
   - `inventory_provider.dart`: `final whId = auth?.warehouseId ?? 'wh_chicago_01';`
   - `receive_stock_screen.dart`: `final warehouseId = _selectedWarehouseId ?? user?.warehouseId ?? 'wh_chicago_01';`
   - `dispatch_stock_screen.dart`: `final warehouseId = _selectedWarehouseId ?? user?.warehouseId ?? 'wh_chicago_01';`
   - `qr_resolve_sheet.dart`: `widget.resolvedData['warehouse_id']?.toString() ?? 'wh_chicago_01';`
   - `dashboard_screen.dart`: lines 251, 559.
   - **Impact**: Any user whose facility assignment was missing or unassigned was silently scoped to Chicago, potentially exposing or misallocating Chicago stock.

### C. Endpoint Configuration Synchronization Defect (Phase 4)
In `profile_screen.dart`:
```dart
void _updateBaseUrl() {
  final newUrl = _urlController.text.trim();
  if (newUrl.isNotEmpty) {
    ApiConfig.setCustomBaseUrl(newUrl); // Only sets static variable in memory!
    // Never calls prefs.setString(ApiConfig.keyCustomBaseUrl, newUrl)
    // Never calls apiClient.updateBaseUrl(newUrl)
    // Dio client continues communicating with the old baseUrl!
  }
}
```
Furthermore:
- No URL syntax validation was performed before applying.
- No HTTPS requirement for non-local origins.
- No connection test was executed before confirming to the operator.

### D. Role-Specific Dashboards Integrity (Phase 5)
1. **Super Admin**: Hardcoded `nodes` list in `_buildSuperAdminDashboard()` rather than aggregating actual tenant facilities or displaying real server health.
2. **Warehouse Manager**: When no IoT sensors were returned for the facility, `_buildWarehouseManagerDashboard()` invented a fake device (`IoTDeviceModel(currentTemp: 4.2)`).
3. **Distributor**: When transfers failed to load, lines 693–713 displayed KPI cards with `"Live"` and `"In Fleet"` instead of communicating an error state.

### E. QR / Barcode Scanner Workflow (Phase 6)
- In `InventoryRepository.resolveQrCode()`, exceptions triggered `_demoResolve(code)`.
- `QrScanScreen` had manual entry with presets that resolved demo records even when disconnected.
- Resolution sheets must require explicit confirmation and display server-validated identifiers.

### F. Offline Operation & Queue Integrity (Phase 7)
- Queued requests in `LocalStorageService` must be explicitly marked as `PENDING_SYNC`, never described as committed transactions until confirmed by the backend server.
- Cached reads must indicate their timestamp and distinguish between fresh server responses and offline caches.

---

## 4. Prioritized Implementation Plan

1. **Phase 2: Authentication & Fallbacks**:
   - Clean `login_screen.dart`: remove pre-filled controllers, remove empty string fallback substitutions, remove production 1-tap quick role chips (isolate to explicit debug flags if needed).
   - Eliminate silent demo returns in `InventoryRepository`, `TransferRepository`, `IoTRepository`, and `OptimizationRepository`. Propagate typed exceptions to Riverpod providers for proper UI error states.
2. **Phase 3: Warehouse & Tenant Scoping**:
   - Update `inventory_provider.dart`: remove `'wh_chicago_01'` fallback. Use `user?.warehouseId`. If user has network-wide access (`superAdmin`, `orgAdmin`, `supplyChainManager`), pass `null` or `'all'` to retrieve cross-warehouse records.
   - Update `receive_stock_screen.dart`, `dispatch_stock_screen.dart`, `qr_resolve_sheet.dart`, and `dashboard_screen.dart` to require explicit authorized warehouse selection or fail gracefully.
3. **Phase 4: API Configuration & Active Client Switch**:
   - Implement rigorous URL validation in `ApiConfig`: check URI scheme (`http`/`https`), reject malformed strings, enforce HTTPS for non-loopback domains.
   - Update `profile_screen.dart` to validate URL, test connectivity via `apiClient.get('/health')`, update `apiClient.updateBaseUrl()`, and persist to `SharedPreferences`.
4. **Phase 5: Real Dashboards**:
   - Remove fake IoT device creation in `dashboard_screen.dart`.
   - Remove hardcoded nodes in Super Admin dashboard.
   - Replace distributor error fallback with honest error state.
5. **Phase 6 & 7: Scanning & Offline Queue**:
   - Make `resolveQrCode` return server errors rather than demo fallbacks.
   - Mark offline queued operations with clear `PENDING_SYNC` status and timestamp.
6. **Phase 11: Verification & Testing**:
   - Update unit and workflow tests in `test/`.
   - Run `flutter analyze` and `flutter test` and document results.
