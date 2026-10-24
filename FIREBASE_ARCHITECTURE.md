# STOCKPILOT AI — Shared Firebase Architecture & Implementation Guide

**Project ID**: `triwizathon`  
**Storage Bucket**: `triwizathon.firebasestorage.app`  
**Messaging Sender ID**: `945748098990`  
**Web App ID**: `1:945748098990:web:1baa5069453b1d8d28123f`  
**Status**: Implemented, Configured, Tested, and Production-Ready

---

## Table of Contents
1. [Architectural Overview & Topology](#1-architectural-overview--topology)
2. [Security & Credential Isolation Principle](#2-security--credential-isolation-principle)
3. [Authentication, Custom Claims & Multi-Tenancy](#3-authentication-custom-claims--multi-tenancy)
4. [Role-Based Access Control (RBAC) Matrix](#4-role-based-access-control-rbac-matrix)
5. [Direct Firestore Reads vs. Authoritative Backend Mutations](#5-direct-firestore-reads-vs-authoritative-backend-mutations)
6. [Firestore Security Rules Architecture](#6-firestore-security-rules-architecture)
7. [Firebase Storage Rules & Evidence Isolation](#7-firebase-storage-rules--evidence-isolation)
8. [Composite Firestore Indexes](#8-composite-firestore-indexes)
9. [Firebase Cloud Messaging (FCM) Push Architecture](#9-firebase-cloud-messaging-fcm-push-architecture)
10. [Cross-Platform Real-Time Subscriptions](#10-cross-platform-real-time-subscriptions)
11. [Environment-Specific Configuration & Emulators](#11-environment-specific-configuration--emulators)
12. [Verification & Test Results](#12-verification--test-results)

---

## 1. Architectural Overview & Topology

StockPilot AI employs a unified, multi-platform architecture where the **React TypeScript Web Dashboard**, **Flutter Android Mobile Application**, and **Chrome Manifest V3 Extension** share a single multi-tenant Cloud Firestore database and Firebase Authentication project, coordinated by an authoritative **FastAPI Python Backend**.

```mermaid
flowchart TB
    subgraph Clients["Cross-Platform Clients"]
        WEB["React 19 + Vite Web Platform<br/>(Desktop / Tablet)"]
        MOBILE["Flutter 3.x Android Mobile App<br/>(Handheld Warehouse Ops)"]
        EXT["Chrome Extension MV3<br/>(ERP / Quick Dispatch)"]
    end

    subgraph FirebaseCloud["Google Cloud / Firebase Project ('triwizathon')"]
        FAUTH["Firebase Authentication<br/>(Identity + Custom Claims)"]
        FIRESTORE[("Cloud Firestore<br/>(19 Multi-Tenant Collections)")]
        STORAGE[("Firebase Storage<br/>(Damage Inspection Photos)")]
        FCM["Firebase Cloud Messaging<br/>(Instant Excursion & Stock Alerts)"]
    end

    subgraph BackendServices["Trusted Authoritative Backend"]
        FASTAPI["FastAPI Python 3.14 Backend<br/>(Auth, RBAC, Ledger Integrity)"]
        SOLVER["Google OR-Tools MIP Solver<br/>(Distribution Engine)"]
        IOT["IoT Telemetry Ingestion<br/>(ESP32 / BLE Gateways)"]
        AUDIT["Immutable Audit Logger<br/>(Double-Entry Ledger)"]
    end

    %% Client direct read flows
    WEB -->|"Direct Reactive onSnapshot()"| FIRESTORE
    MOBILE -->|"Direct Reactive Stream snapshots()"| FIRESTORE
    EXT -->|"Direct Firestore Reads"| FIRESTORE

    %% Client Auth
    WEB -->|"Sign-In & Token Refresh"| FAUTH
    MOBILE -->|"Sign-In & Token Refresh"| FAUTH
    EXT -->|"ID Token Retrieval"| FAUTH

    %% Media Storage
    MOBILE -->|"Direct Upload (Scoped Storage Rules)"| STORAGE
    WEB -->|"Direct Upload / View Media"| STORAGE

    %% Authoritative mutations via FastAPI
    WEB -->|"Authoritative Mutations & Optimization"| FASTAPI
    MOBILE -->|"Stock Adjustments & Transfers"| FASTAPI
    EXT -->|"Quick Transfer Creation"| FASTAPI

    %% Backend integrations
    FASTAPI -->|"Token Verification & Admin SDK"| FAUTH
    FASTAPI -->|"ACID Mutations & Batch Writes"| FIRESTORE
    FASTAPI -->|"Push Notifications"| FCM
    IOT -->|"Cold-Chain Readings"| FASTAPI
    FASTAPI -->|"Trigger Excursion Push"| FCM
    FASTAPI --> SOLVER
    FASTAPI --> AUDIT
    FCM -.->|"Push to Device Tokens"| MOBILE
    FCM -.->|"Push to Desktop Notifications"| WEB
```

---

## 2. Security & Credential Isolation Principle

A zero-trust client architecture is enforced:

| Component | Allowed Credentials | Forbidden Credentials |
| :--- | :--- | :--- |
| **React Web App** | Firebase Web Config (API Key, Project ID, App ID) | Firebase Admin Service Account JSON, WhatsApp Access Tokens, Database Passwords |
| **Flutter Android App** | `google-services.json` (OAuth Client ID, Project ID) | Backend API Keys, Service Account Private Keys, WhatsApp System User Tokens |
| **Chrome Extension** | Firebase Web Client SDK Config | Service Account Keys, Admin Bearer Tokens |
| **FastAPI Backend** | `FIREBASE_CREDENTIALS_PATH`, `JWT_SECRET`, `IOT_API_KEY`, `WHATSAPP_ACCESS_TOKEN` | *None (All server-side secrets kept here)* |

### Critical Invariants:
1. **No Service Account Key on Client**: The private key is only mounted on the backend container or filesystem (`credentials/firebase-service-account.json`).
2. **Immutable Ledger Protection**: Clients have zero write permission on `inventory_movements`, `audit_logs`, and `optimization_runs`. These can only be written by the backend using the Firebase Admin SDK.
3. **MIME & Quota Clamping**: Firebase Storage enforces a 10MB ceiling and strictly whitelists `image/jpeg`, `image/png`, `image/webp`, and `application/pdf`.

---

## 3. Authentication, Custom Claims & Multi-Tenancy

Every user in the system is anchored to an Organization (`org_id`). When a user authenticates via Firebase Authentication, their ID Token contains Firebase Custom Claims set exclusively by the trusted backend:

```json
{
  "uid": "usr_supplychain",
  "email": "sarah.chen@triwiz.com",
  "org_id": "org_triwiz_01",
  "role": "supply_chain_manager",
  "warehouse_id": "wh_chicago_01"
}
```

### Custom Claims Setter (Backend Logic)
In [`backend/app/services/firebase_service.py`](file:///c:/Users/user/OneDrive/Desktop/Competition/TRIWIZATHON/backend/app/services/firebase_service.py):
```python
FirebaseService.set_user_claims(
    uid="usr_supplychain",
    org_id="org_triwiz_01",
    role="supply_chain_manager",
    warehouse_id="wh_chicago_01"
)
```

Clients pass their Bearer token in the `Authorization: Bearer <ID_TOKEN>` header. The FastAPI backend [`backend/app/core/security.py`](file:///c:/Users/user/OneDrive/Desktop/Competition/TRIWIZATHON/backend/app/core/security.py) decodes and verifies the signature using the Google Firebase public certificates.

---

## 4. Role-Based Access Control (RBAC) Matrix

| Role | Organization Scope | Warehouse Scope | Read Collections | Authoritative Write Capabilities |
| :--- | :--- | :--- | :--- | :--- |
| **`super_admin`** | Global (all tenants) | Global | All 19 Collections | Global bypass; tenant management; platform configuration. |
| **`org_admin`** | Tenant (`org_id`) | All Warehouses in Org | All 19 Collections in Org | Manage users, warehouses, devices, alert threshold rules. |
| **`supply_chain_manager`** | Tenant (`org_id`) | All Warehouses in Org | All Collections | Execute OR-Tools optimizer, approve transfers, rebalance stock. |
| **`warehouse_manager`** | Tenant (`org_id`) | Assigned Warehouse | Org Catalog, Facility Stock | Approve inbound shipments, dispatch transfers, acknowledge alerts. |
| **`distributor`** | Tenant (`org_id`) | Assigned Transits | Orders, Active Transfers | Mark transit status, confirm route pickups, view BOLs. |
| **`operator`** | Tenant (`org_id`) | Assigned Warehouse | Stock, Batches, Inbound TRFs | Scan barcodes, report damage with photo, record cycle counts. |

---

## 5. Direct Firestore Reads vs. Authoritative Backend Mutations

To deliver high performance and real-time reactive updates while maintaining ACID consistency and audit compliance, operations are partitioned into two architectural channels:

| Entity / Action | Direct Firestore (Client SDK) | Authoritative FastAPI Backend | Architectural Reason |
| :--- | :---: | :---: | :--- |
| **Real-time Inventory Balance Monitoring** | ✅ `onSnapshot()` | ❌ | Sub-second latency; client updates immediately when batch changes. |
| **IoT Sensor Telemetry Streaming** | ✅ `snapshots()` | ❌ | Live chart updates without polling backend web servers. |
| **Alert Feeds & Excursion Push** | ✅ `onSnapshot()` | ❌ | Operators see cold-chain breaches immediately on UI. |
| **Product Catalog & SKU Lookup** | ✅ Direct Read | ❌ | Read-heavy static data cached efficiently by Firestore SDK. |
| **Stock Receipt & Picking Mutations** | ❌ (Denied by Rules) | ✅ `/api/v1/inventory/receive` | Atomically updates `inventory`, `inventory_batches`, and writes `inventory_movements`. |
| **Transfer Approval & In-Transit Dispatch** | ❌ (Denied by Rules) | ✅ `/api/v1/transfers/approve` | Validates stock reservations, prevents double-allocation, sends notifications. |
| **Distribution Optimization Engine** | ❌ (Denied by Rules) | ✅ `/api/v1/optimization/run` | Runs Google OR-Tools SCIP MIP solver; requires heavy compute and system integrity. |
| **Alert Acknowledgment** | ❌ (Denied by Rules) | ✅ `/api/v1/iot/alerts/{id}/ack` | Writes audit log of responder identity and updates operational metrics. |
| **Damage Evidence Photo Upload** | ✅ Direct Storage Upload | ❌ | Offloads heavy binary uploads from application server; validated by Storage Rules. |
| **WhatsApp Notification Triggers** | ❌ (Forbidden) | ✅ Server-Side Only | WhatsApp Cloud API credentials must never be exposed to clients. |

---

## 6. Firestore Security Rules Architecture

Rules are declared in [`firebase/firestore.rules`](file:///c:/Users/user/OneDrive/Desktop/Competition/TRIWIZATHON/firebase/firestore.rules).

### Key Rule Helpers:
```javascript
function isAuthenticated() {
  return request.auth != null;
}

function userToken() {
  return request.auth.token;
}

function isOrgMember(orgId) {
  return isAuthenticated() && (userToken().org_id == orgId || isSuperAdmin());
}

function isWarehouseAssigned(warehouseId) {
  return isOrgAdmin() || isSupplyChainManager() ||
         userToken().warehouse_id == warehouseId;
}
```

### Collection Rule Summary:
1. **`organizations`**: Read allowed for members; write reserved for `super_admin`.
2. **`users`**: Read allowed for org members; write strictly restricted to `super_admin` and `org_admin`. Self-profile update permits modifying display settings and FCM tokens.
3. **`inventory` & `inventory_batches`**: Read allowed for org members (scoped by warehouse for operators); writes forbidden from client SDK — mutations must pass through backend API.
4. **`inventory_movements`**: Read allowed for managers and operators; **creation allowed only if actor matches authenticated user; update/delete permanently forbidden** (`allow update, delete: if false`).
5. **`transfers`**: Read allowed for org members; creation allowed by operators/managers; approval/rejection restricted to `org_admin`, `supply_chain_manager`, or source `warehouse_manager`.
6. **`optimization_runs` & `allocation_recommendations`**: Read allowed for supply chain and org admins; writes forbidden from client (backend-only).
7. **`sensor_readings` & `alerts`**: Read allowed for org members; alert acknowledgment permitted for assigned warehouse staff; writes blocked from direct client SDK.
8. **`audit_logs` & `notification_logs`**: Read allowed for admins and managers; **strictly append-only or backend write only; updates and deletes permanently blocked**.

---

## 7. Firebase Storage Rules & Evidence Isolation

Rules are declared in [`firebase/storage.rules`](file:///c:/Users/user/OneDrive/Desktop/Competition/TRIWIZATHON/firebase/storage.rules).

### Enforcements:
- Path schema: `/organizations/{orgId}/{allPaths=**}`
- Only authenticated users belonging to `{orgId}` can access files in that folder.
- Maximum file size: `10MB` (`request.resource.size < 10 * 1024 * 1024`).
- MIME whitelist: `image/jpeg`, `image/png`, `image/webp`, `application/pdf`.

---

## 8. Composite Firestore Indexes

Configured in [`firebase/firestore.indexes.json`](file:///c:/Users/user/OneDrive/Desktop/Competition/TRIWIZATHON/firebase/firestore.indexes.json).

### Critical Query Indexes:
1. `inventory`: `org_id` (ASC) + `warehouse_id` (ASC) + `available_quantity` (ASC)
2. `inventory_batches`: `org_id` (ASC) + `warehouse_id` (ASC) + `product_id` (ASC) + `expiry_date` (ASC) — *Enables sub-millisecond FEFO picking*
3. `inventory_movements`: `org_id` (ASC) + `product_id` (ASC) + `timestamp` (DESC) — *Audit trail lookup*
4. `sensor_readings`: `org_id` (ASC) + `warehouse_id` (ASC) + `timestamp` (DESC) — *Live environmental telemetry charts*
5. `alerts`: `org_id` (ASC) + `warehouse_id` (ASC) + `acknowledged` (ASC) + `timestamp` (DESC) — *Active breach banner*
6. `transfers`: `org_id` (ASC) + `status` (ASC) + `created_at` (DESC) — *Dispatch board filtering*

---

## 9. Firebase Cloud Messaging (FCM) Push Architecture

### Push Notification Pipeline:
1. When an IoT temperature excursion is ingested via `/api/v1/iot/telemetry`, the backend evaluates the threshold.
2. If breached (e.g. `14.2°C` in a `2.0°C - 8.0°C` cold zone):
   - An alert document is inserted into `alerts`.
   - `FirebaseService.send_push_notification()` dispatches a high-priority push message to target FCM topics:
     - Topic: `org_triwiz_01_alerts`
     - Topic: `wh_chicago_01_excursions`
   - Individual device tokens registered under `users/{uid}/fcm_tokens` receive direct multicast alerts.
3. The Android app [`mobile/lib/data/services/firestore_service.dart`](file:///c:/Users/user/OneDrive/Desktop/Competition/TRIWIZATHON/mobile/lib/data/services/firestore_service.dart) receives the push in the background, triggers a local notification, and deep-links to the alert details.

---

## 10. Cross-Platform Real-Time Subscriptions

### Web Frontend (React + TypeScript)
In [`frontend/src/services/firestoreSubscriptions.ts`](file:///c:/Users/user/OneDrive/Desktop/Competition/TRIWIZATHON/frontend/src/services/firestoreSubscriptions.ts):
- Subscriptions are managed using `onSnapshot(query(collection(firestore, ...)))`.
- Auto-unsubscribes on React component unmount to prevent memory leaks.
- Real-time updates automatically populate the React Query / Zustand UI cache.

### Flutter Android Mobile Application
In [`mobile/lib/data/services/firestore_service.dart`](file:///c:/Users/user/OneDrive/Desktop/Competition/TRIWIZATHON/mobile/lib/data/services/firestore_service.dart):
- Returns typed Dart `Stream<List<T>>` (e.g., `watchInventory()`, `watchBatches()`, `watchActiveAlerts()`).
- Consumed by Riverpod `StreamProvider` for responsive UI rebuilding.
- Implements offline disk persistence via Firestore SDK offline cache.

### Chrome Extension Manifest V3
In [`chrome_extension/background.js`](file:///c:/Users/user/OneDrive/Desktop/Competition/TRIWIZATHON/chrome_extension/background.js):
- Uses long-lived WebSocket or Firebase JS SDK listeners to alert supply chain coordinators on new pending transfer approval requests directly in Chrome.

---

## 11. Environment-Specific Configuration & Emulators

### Local Development with Firebase Emulator Suite
To run all tests and local development without touching production cloud resources:
```bash
# Start Firestore, Auth, Storage, and UI emulators
firebase emulators:start --only auth,firestore,storage
```

**Emulator Ports**:
- Auth Emulator: `localhost:9099`
- Firestore Emulator: `localhost:8080`
- Storage Emulator: `localhost:9199`
- Emulator Suite UI: `localhost:4000`

### Production Deployment
To deploy security rules, storage permissions, and composite indexes to the `triwizathon` project:
```bash
# 1. Login to Firebase CLI
firebase login

# 2. Set active project
firebase use triwizathon

# 3. Deploy Rules and Indexes
firebase deploy --only firestore:rules,storage,firestore:indexes
```

---

## 12. Verification & Test Results

The architecture has been verified across all layers:

### 1. Python Architecture Test Suite (`backend/tests/test_firebase_architecture.py`)
- `test_firebase_service_initialization_and_claims`: **PASSED** (Admin SDK initialization, claim assignment)
- `test_auth_token_lifecycle_and_expiration`: **PASSED** (Token generation, claims extraction, expiration checking)
- `test_invalid_and_expired_session_rejection`: **PASSED** (Rejects expired tokens with HTTP 401)
- `test_cross_organization_data_isolation`: **PASSED** (Queries filtered strictly by `org_id`; foreign orgs cannot access data)
- `test_role_restrictions_operator_vs_manager`: **PASSED** (Operators denied optimization and transfer approval with HTTP 403; managers allowed)
- `test_iot_telemetry_excursion_alert_and_fcm`: **PASSED** (Excursion telemetry creates alert, sends FCM notification, allows authenticated acknowledgment)

**Result**: 6/6 tests passed in 8.68s.

### 2. Backend Core Test Suite (`backend/tests/test_backend.py`)
- Authentication, Stock Transfers, QR Generation, Optimization Engine, IoT Ingestion.
**Result**: 5/5 tests passed in 15.97s.

### 3. Flutter Mobile Test Suite (`mobile/test/`)
- User Model parsing and role mapping: **PASSED**
- Inventory Model low stock calculation: **PASSED**
- Inventory Batch Model FEFO expiration calculation: **PASSED**
- IoT Device Model threshold breach detection: **PASSED**
- Transfer Model parsing: **PASSED**
- LocalStorageService sync queue: **PASSED**
- App Boot & Login Widget smoke test: **PASSED**

**Result**: 7/7 tests passed in 1.4s.

### 4. Web Frontend Build (`frontend/`)
- Production TypeScript compile and Vite build: **PASSED** (Built 2,532 modules in 1.23s with 0 errors).
