# StockPilot AI Mobile (Android Companion)

**StockPilot AI Mobile** is the enterprise Android companion app for the StockPilot AI multi-warehouse distribution intelligence and inventory optimization platform (Triwizathon PS2).

Built with **Flutter stable**, **Dart sound null safety**, **Material 3 industrial design system**, **Riverpod**, and **GoRouter**, it natively connects to the shared Python FastAPI backend and Firebase project (`triwizathon`).

---

## 📱 Key Features & Role-Aware Operations

1. **Role-Aware Dashboards**:
   - **Warehouse Operator**: Immediate access to prominent camera QR/barcode scanner, today's floor checklist, inbound receipts, outbound dispatch queue, discrepancy logging, and offline synchronization banner.
   - **Supply Chain & Warehouse Manager**: Network-wide stock health metrics, pending transfer approvals with 1-click accept/reject, FEFO expiring batch alerts (<30 days), real-time cold-chain IoT excursion alerts, and Google OR-Tools AI allocation proposals.
2. **Industrial Barcode & QR Scanner**:
   - Native camera scanning using `mobile_scanner` with target brackets, torch switch, and camera flip.
   - Emulator demo / manual entry modal with sample barcodes (`BATCH-COV-8821`, `PROD-COV-VAX-01`, `BATCH-INS-4412`) for Android Studio virtual devices without physical cameras.
   - Server-validated identifier lookup with contextual action sheet (Receive, Dispatch, Cycle Count, Report Damage).
   - Duplicate scan prevention and server-side idempotency keys (`correlation_id`).
3. **Sensitive Warehouse Movements**:
   - Predicted stock impact confirmation dialog before mutation commit.
   - Full FEFO (First-Expired, First-Out) batch prioritization.
4. **Cold-Chain IoT Telemetry**:
   - Live temperature & humidity dials for warehouse storage zones and transit reefers.
   - Threshold breach detection (`2.0°C - 8.0°C` cold chain standard).
   - Excursion alert list with 1-click operator acknowledgment.
5. **Offline-Aware Operation**:
   - Real-time online/offline connectivity monitoring.
   - Local pending draft queue with retry mechanism and transparent sync status.
6. **Live Role Switcher**:
   - In-app persona switcher in Profile screen to instantly test all 5 Triwizathon roles:
     - Organization Admin
     - Supply Chain Manager
     - Warehouse Manager
     - Distributor
     - Warehouse Operator

---

## 🛠️ Technology Stack & Dependency Matrix

| Package | Version | Purpose |
|---|---|---|
| `flutter` | `3.38.7+` (Stable) | Cross-platform framework |
| `dart` | `3.10.7+` (Sound Null Safety) | Programming language |
| `flutter_riverpod` | `^2.6.1` | State & dependency injection |
| `go_router` | `^14.8.1` | Declarative role-based routing |
| `dio` | `^5.8.0+1` | Authenticated HTTP client with interceptors |
| `firebase_core` | `^3.12.1` | Firebase shared foundation (`triwizathon`) |
| `firebase_auth` | `^5.5.1` | Identity and authentication |
| `cloud_firestore` | `^5.6.5` | Real-time database streams |
| `mobile_scanner` | `^6.0.7` | Camera barcode & QR reader |
| `qr_flutter` | `^4.1.0` | On-device QR generator for SKUs & batches |
| `fl_chart` | `^0.70.2` | Mobile sensor & inventory charts |
| `shared_preferences`| `^2.5.2` | Local persistence & offline draft queue |
| `uuid` | `^4.5.1` | Idempotency key generation |

---

## 🚀 Running in Android Studio

### Prerequisites
- Android Studio Ladybug / Meerkat or later.
- Android SDK (API 34 / 35 recommended, `minSdk = 23`).
- Flutter SDK configured in Android Studio.

### Step-by-Step Launch
1. Open Android Studio.
2. Select **Open** and choose the `mobile` folder:
   ```
   c:\Users\user\OneDrive\Desktop\Competition\TRIWIZATHON\mobile
   ```
3. Fetch dependencies:
   ```bash
   flutter pub get
   ```
4. Start an Android Virtual Device (AVD) from Android Studio's **Device Manager** (e.g., Pixel 8 API 34).
5. Ensure the Python FastAPI backend is running on the host machine:
   ```bash
   cd ../backend
   python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
   ```
   *(Note: The Android Emulator automatically loops back to `127.0.0.1:8000` via `http://10.0.2.2:8000`, which is pre-configured in `ApiConfig`).*
6. Click **Run** (`Shift + F10`) or execute:
   ```bash
   flutter run
   ```

---

## 🧪 Testing & Verification

Run the test suite from terminal:
```bash
flutter test
```
**Results**:
- `UserModel parse and role mapping`: **PASSED**
- `InventoryItemModel low stock detection`: **PASSED**
- `InventoryBatchModel FEFO calculation`: **PASSED**
- `IoTDeviceModel temperature threshold breach detection`: **PASSED**
- `TransferModel parse with nested TransferItemModel`: **PASSED**
- `LocalStorageService pending sync queue handles enqueue and clear`: **PASSED**
- `StockPilotApp boots and renders login screen smoke test`: **PASSED**

Static code analysis:
```bash
flutter analyze
```
Result: **0 warnings, 0 errors**.
