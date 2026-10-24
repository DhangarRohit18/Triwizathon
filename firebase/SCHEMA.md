# STOCKPILOT AI — Canonical Firestore Schema Reference

This document defines the production schema specification for all 19 Cloud Firestore collections shared across the React TypeScript Web platform, Flutter Android companion app, Chrome Manifest V3 extension, and FastAPI backend.

---

## Global Scoping & Multi-Tenancy Invariant

Every collection and document in the system belongs to an organization tenant identified by `org_id` (e.g. `org_triwiz_01`). 

### Key Invariants:
1. **Tenant Isolation**: Direct Firestore reads and queries must contain `where("org_id", "==", currentUser.org_id)`.
2. **Auditability**: Authoritative mutations generate an append-only entry in `inventory_movements` and `audit_logs`.
3. **Immutability**: `inventory_movements` and `audit_logs` are strictly append-only; update and delete operations are forbidden at the Security Rules level.
4. **Idempotency**: All operations carrying client-generated UUIDs accept `correlation_id` to prevent double-processing.

---

## The 19 Collection Schemas

### 1. `organizations`
- **Collection**: `/organizations/{org_id}`
- **Purpose**: Master tenant profile, plan tiers, and organization-wide configuration.
- **Fields**:
  - `id`: `string` (e.g., `"org_triwiz_01"`)
  - `name`: `string` (e.g., `"Triwiz BioPharma Logistics"`)
  - `code`: `string` (e.g., `"TBPL"`)
  - `industry`: `string` (e.g., `"Pharmaceutical Cold Chain"`)
  - `status`: `string` (`"active" | "suspended" | "trial"`)
  - `plan_tier`: `string` (`"enterprise" | "standard"`)
  - `settings`: `map`
    - `default_currency`: `string` (`"USD"`)
    - `timezone`: `string` (`"America/Chicago"`)
    - `temp_unit`: `string` (`"celsius"`)
    - `whatsapp_enabled`: `boolean`
    - `fcm_enabled`: `boolean`
  - `created_at`: `timestamp`
  - `updated_at`: `timestamp`

### 2. `users`
- **Collection**: `/users/{user_id}`
- **Purpose**: Organization-scoped user profile, credentials metadata, role assignments, and notification endpoints.
- **Fields**:
  - `id`: `string` (Matches Firebase Auth UID or internal ID e.g., `"usr_supplychain"`)
  - `email`: `string`
  - `full_name`: `string`
  - `role`: `string` (`"super_admin" | "org_admin" | "supply_chain_manager" | "warehouse_manager" | "distributor" | "operator"`)
  - `org_id`: `string`
  - `warehouse_id`: `string | null` (Nullable; if assigned, scopes operator to this warehouse)
  - `phone_number`: `string | null` (E.164 formatted for WhatsApp notifications e.g., `"+13125550192"`)
  - `fcm_tokens`: `array<string>` (Active FCM device registration tokens)
  - `is_active`: `boolean`
  - `created_at`: `timestamp`
  - `last_login_at`: `timestamp`

### 3. `warehouses`
- **Collection**: `/warehouses/{warehouse_id}`
- **Purpose**: Physical facility nodes, geographical coordinates, storage capacities, and operational status.
- **Fields**:
  - `id`: `string` (e.g., `"wh_chicago_01"`)
  - `org_id`: `string`
  - `code`: `string` (e.g., `"WH-ORD-01"`)
  - `name`: `string` (e.g., `"Central Hub Chicago"`)
  - `address`: `map` (`street`, `city`, `state`, `zip`, `country`)
  - `lat`: `number` (float, e.g. `41.8781`)
  - `lng`: `number` (float, e.g. `-87.6298`)
  - `capacity_pallets`: `number` (integer)
  - `used_pallets`: `number` (integer)
  - `cold_storage_capacity`: `number` (integer)
  - `cold_storage_used`: `number` (integer)
  - `is_operational`: `boolean` (Disruption switch for scenario modeling)
  - `disruption_reason`: `string | null`
  - `contact_email`: `string`
  - `contact_phone`: `string`
  - `created_at`: `timestamp`

### 4. `products`
- **Collection**: `/products/{product_id}`
- **Purpose**: Master product catalog, SKU, barcode/QR definitions, handling classifications, and cost profiles.
- **Fields**:
  - `id`: `string` (e.g., `"prd_vax_01"`)
  - `org_id`: `string`
  - `sku`: `string` (Unique e.g., `"PRD-VAX-01"`)
  - `name`: `string` (e.g., `"PneuVax mRNA-1273 (20-vial pack)"`)
  - `category`: `string` (e.g., `"Biologics / Vaccines"`)
  - `handling`: `string` (`"cold_chain" | "deep_freeze" | "ambient" | "hazardous" | "fragile"`)
  - `storage_temp_range`: `map`
    - `min_c`: `number` (e.g., `2.0`)
    - `max_c`: `number` (e.g., `8.0`)
  - `unit`: `string` (`"vials" | "pens" | "cartons" | "bottles"`)
  - `unit_cost`: `number` (float)
  - `selling_price`: `number` (float)
  - `min_safety_stock`: `number` (integer)
  - `reorder_point`: `number` (integer)
  - `barcode`: `string` (e.g., `"8901234567890"`)
  - `qr_code_payload`: `string` (`"STOCKPILOT://SKU/PRD-VAX-01/ORG/org_triwiz_01"`)
  - `shelf_life_days`: `number` (integer)
  - `created_at`: `timestamp`

### 5. `inventory`
- **Collection**: `/inventory/{inv_id}` (ID convention: `inv_{warehouse_id}_{product_id}`)
- **Purpose**: Materialized real-time stock balances at warehouse-product granularity.
- **Fields**:
  - `id`: `string`
  - `org_id`: `string`
  - `warehouse_id`: `string`
  - `product_id`: `string`
  - `total_quantity`: `number` (integer)
  - `reserved_quantity`: `number` (integer)
  - `available_quantity`: `number` (integer, `total_quantity - reserved_quantity - damaged_quantity`)
  - `damaged_quantity`: `number` (integer)
  - `in_transit_quantity`: `number` (integer)
  - `safety_stock`: `number` (integer)
  - `reorder_point`: `number` (integer)
  - `last_replenished_at`: `timestamp | null`
  - `updated_at`: `timestamp`

### 6. `inventory_batches`
- **Collection**: `/inventory_batches/{batch_id}`
- **Purpose**: FEFO (First-Expired, First-Out) lot tracking, expiration enforcement, and bin locations.
- **Fields**:
  - `id`: `string` (e.g., `"bat_wh_chicago_01_LOT-2026-A12"`)
  - `org_id`: `string`
  - `warehouse_id`: `string`
  - `product_id`: `string`
  - `batch_number`: `string` (e.g., `"LOT-2026-A12"`)
  - `mfg_date`: `string` (ISO date `"2026-01-10"`)
  - `expiry_date`: `string` (ISO date `"2026-11-30"`)
  - `days_to_expiry`: `number` (integer)
  - `initial_quantity`: `number` (integer)
  - `quantity`: `number` (integer, remaining usable stock)
  - `reserved_quantity`: `number` (integer)
  - `damaged_quantity`: `number` (integer)
  - `unit_cost`: `number` (float)
  - `storage_bin`: `string` (e.g., `"BIN-COLD-A-04"`)
  - `status`: `string` (`"active" | "quarantined" | "expired" | "depleted"`)
  - `created_at`: `timestamp`
  - `updated_at`: `timestamp`

### 7. `inventory_movements`
- **Collection**: `/inventory_movements/{movement_id}`
- **Purpose**: Immutable, append-only double-entry audit ledger of every inventory mutation.
- **Fields**:
  - `id`: `string` (e.g., `"mov_e847c1f2-..."`)
  - `org_id`: `string`
  - `correlation_id`: `string` (Unique transaction idempotency key)
  - `product_id`: `string`
  - `batch_id`: `string | null`
  - `source_warehouse_id`: `string | null`
  - `destination_warehouse_id`: `string | null`
  - `destination_customer_id`: `string | null`
  - `movement_type`: `string` (`"receipt" | "dispatch" | "transfer_out" | "transfer_in" | "adjustment" | "damage_report" | "quarantine"`)
  - `quantity_changed`: `number` (signed integer: positive for receipts, negative for dispatches)
  - `balance_after`: `number` (integer)
  - `actor_id`: `string`
  - `actor_name`: `string`
  - `actor_role`: `string`
  - `reason`: `string`
  - `photo_evidence_url`: `string | null` (Storage link for damage reports)
  - `timestamp`: `timestamp`

### 8. `orders`
- **Collection**: `/orders/{order_id}`
- **Purpose**: Inbound purchase orders and outbound customer/facility fulfillment orders.
- **Fields**:
  - `id`: `string` (e.g., `"ord_2026_0984"`)
  - `org_id`: `string`
  - `order_number`: `string`
  - `order_type`: `string` (`"outbound_sales" | "inbound_purchase" | "stock_transfer"`)
  - `status`: `string` (`"draft" | "pending_allocation" | "allocated" | "picking" | "dispatched" | "delivered" | "cancelled"`)
  - `customer_name`: `string | null`
  - `destination_facility`: `string | null`
  - `destination_lat`: `number | null`
  - `destination_lng`: `number | null`
  - `assigned_warehouse_id`: `string | null`
  - `total_items`: `number`
  - `total_value`: `number`
  - `priority`: `string` (`"critical" | "high" | "normal" | "low"`)
  - `created_at`: `timestamp`
  - `updated_at`: `timestamp`

### 9. `transfers`
- **Collection**: `/transfers/{transfer_id}`
- **Purpose**: Inter-warehouse stock balance transfers created manually or from optimization engine runs.
- **Fields**:
  - `id`: `string` (e.g., `"trf_001_chi_ny"`)
  - `org_id`: `string`
  - `transfer_number`: `string` (e.g., `"TRF-2026-0891"`)
  - `source_warehouse_id`: `string`
  - `target_warehouse_id`: `string`
  - `status`: `string` (`"pending" | "approved" | "in_transit" | "received" | "rejected" | "cancelled"`)
  - `requested_by_id`: `string`
  - `approved_by_id`: `string | null`
  - `approved_at`: `timestamp | null`
  - `shipped_at`: `timestamp | null`
  - `received_at`: `timestamp | null`
  - `carrier_name`: `string | null`
  - `tracking_number`: `string | null`
  - `estimated_transport_cost`: `number`
  - `total_units`: `number`
  - `created_at`: `timestamp`
  - `updated_at`: `timestamp`

### 10. `transfer_items`
- **Collection**: `/transfer_items/{transfer_item_id}`
- **Purpose**: Itemized SKUs and specific batches bundled in an inter-warehouse transfer.
- **Fields**:
  - `id`: `string`
  - `org_id`: `string`
  - `transfer_id`: `string`
  - `product_id`: `string`
  - `batch_id`: `string | null`
  - `quantity_requested`: `number`
  - `quantity_shipped`: `number`
  - `quantity_received`: `number`
  - `damaged_quantity`: `number`
  - `unit_cost`: `number`
  - `condition_on_receipt`: `string | null` (`"intact" | "excursion" | "damaged"`)
  - `created_at`: `timestamp`

### 11. `demand_history`
- **Collection**: `/demand_history/{record_id}`
- **Purpose**: Historical sales and dispatch records used by forecasting models.
- **Fields**:
  - `id`: `string`
  - `org_id`: `string`
  - `product_id`: `string`
  - `warehouse_id`: `string`
  - `period_date`: `string` (YYYY-MM-DD)
  - `quantity_demanded`: `number`
  - `quantity_fulfilled`: `number`
  - `stockout_events`: `number`
  - `is_promotion_period`: `boolean`
  - `created_at`: `timestamp`

### 12. `forecasts`
- **Collection**: `/forecasts/{forecast_id}`
- **Purpose**: AI/ML predictive demand forecasts generated with seasonal, trend, and confidence bounds.
- **Fields**:
  - `id`: `string`
  - `org_id`: `string`
  - `product_id`: `string`
  - `warehouse_id`: `string`
  - `forecast_horizon_days`: `number` (e.g. `30`)
  - `predicted_demand`: `number`
  - `lower_bound_80`: `number`
  - `upper_bound_80`: `number`
  - `model_name`: `string` (`"prophet" | "sarima" | "ensemble_v2"`)
  - `confidence_score`: `number` (0.0 to 1.0)
  - `generated_at`: `timestamp`

### 13. `optimization_runs`
- **Collection**: `/optimization_runs/{run_id}`
- **Purpose**: Execution snapshots of the Google OR-Tools SCIP Mixed-Integer Linear Program.
- **Fields**:
  - `id`: `string` (e.g., `"opt_run_649f8a..."`)
  - `org_id`: `string`
  - `run_id`: `string`
  - `strategy`: `string` (`"balanced" | "cost_minimization" | "service_level"`)
  - `allow_partial`: `boolean`
  - `scenario`: `map`
    - `disrupted_warehouse_ids`: `array<string>`
    - `demand_surge_percent`: `number`
    - `fuel_cost_multiplier`: `number`
  - `optimized`: `map`
    - `total_modeled_cost`: `number`
    - `total_allocated_units`: `number`
    - `fulfillment_rate`: `number`
    - `computation_time_seconds`: `number`
    - `status`: `string` (`"OPTIMAL" | "FEASIBLE" | "INFEASIBLE"`)
  - `baseline_heuristic`: `map`
    - `total_modeled_cost`: `number`
    - `total_allocated_units`: `number`
  - `savings_cost`: `number`
  - `savings_percent`: `number`
  - `actor_id`: `string`
  - `timestamp`: `timestamp`

### 14. `allocation_recommendations`
- **Collection**: `/allocation_recommendations/{rec_id}`
- **Purpose**: Granular routing recommendations from the optimization run.
- **Fields**:
  - `id`: `string`
  - `org_id`: `string`
  - `run_id`: `string`
  - `source_warehouse_id`: `string`
  - `destination_warehouse_id`: `string`
  - `product_id`: `string`
  - `batch_id`: `string | null`
  - `recommended_quantity`: `number`
  - `unit_transport_cost`: `number`
  - `fefo_expiry_risk_score`: `number` (0.0 to 1.0)
  - `recommendation_reason`: `string`
  - `status`: `string` (`"pending_action" | "converted_to_transfer" | "dismissed"`)
  - `created_at`: `timestamp`

### 15. `iot_devices`
- **Collection**: `/iot_devices/{device_id}`
- **Purpose**: Physical hardware sensors (ESP32 / BLE gateways) tracking cold-chain conditions.
- **Fields**:
  - `id`: `string` (e.g., `"TEMP-ESP32-01"`)
  - `org_id`: `string`
  - `device_id`: `string`
  - `warehouse_id`: `string`
  - `storage_zone`: `string` (e.g., `"Zone A Cold Room"`)
  - `device_type`: `string` (`"esp32_dht22" | "ble_beacon" | "gateway"`)
  - `temp_min_threshold`: `number` (float, e.g. `2.0`)
  - `temp_max_threshold`: `number` (float, e.g. `8.0`)
  - `humidity_max_threshold`: `number` (float, e.g. `65.0`)
  - `is_online`: `boolean`
  - `battery_level_percent`: `number`
  - `firmware_version`: `string`
  - `last_heartbeat_at`: `timestamp`
  - `created_at`: `timestamp`

### 16. `sensor_readings`
- **Collection**: `/sensor_readings/{reading_id}`
- **Purpose**: High-frequency environmental telemetry stream.
- **Fields**:
  - `id`: `string` (e.g., `"read_71c312c61fa3"`)
  - `org_id`: `string`
  - `device_id`: `string`
  - `warehouse_id`: `string`
  - `temperature_c`: `number`
  - `humidity_percent`: `number`
  - `battery_level_percent`: `number`
  - `door_open`: `boolean`
  - `is_excursion`: `boolean`
  - `timestamp`: `timestamp`

### 17. `alerts`
- **Collection**: `/alerts/{alert_id}`
- **Purpose**: Critical operational anomalies (cold chain excursions, stockouts, expiry warnings).
- **Fields**:
  - `id`: `string` (e.g., `"alt_2026_00192"`)
  - `org_id`: `string`
  - `alert_type`: `string` (`"cold_chain_excursion" | "critical_low_stock" | "stockout" | "expiry_approaching" | "hardware_offline"`)
  - `severity`: `string` (`"critical" | "warning" | "info"`)
  - `message`: `string`
  - `warehouse_id`: `string`
  - `device_id`: `string | null`
  - `product_id`: `string | null`
  - `batch_id`: `string | null`
  - `reading_value`: `number | null`
  - `threshold_value`: `number | null`
  - `acknowledged`: `boolean`
  - `acknowledged_by`: `string | null`
  - `acknowledged_at`: `timestamp | null`
  - `fcm_sent`: `boolean`
  - `whatsapp_sent`: `boolean`
  - `timestamp`: `timestamp`

### 18. `notification_logs`
- **Collection**: `/notification_logs/{log_id}`
- **Purpose**: Delivery tracking for FCM push alerts, WhatsApp Business messages, and webhooks.
- **Fields**:
  - `id`: `string`
  - `org_id`: `string`
  - `channel`: `string` (`"fcm" | "whatsapp" | "webhook" | "email"`)
  - `recipient`: `string` (FCM token / WhatsApp E.164 phone number)
  - `title`: `string`
  - `body`: `string`
  - `payload`: `map`
  - `delivery_status`: `string` (`"delivered" | "failed" | "queued"`)
  - `external_message_id`: `string | null` (WhatsApp WAMID or FCM multicast ID)
  - `error_message`: `string | null`
  - `timestamp`: `timestamp`

### 19. `audit_logs`
- **Collection**: `/audit_logs/{audit_id}`
- **Purpose**: Immutable governance and compliance tracking for every security event, role elevation, and stock mutation.
- **Fields**:
  - `id`: `string` (e.g., `"aud_31fc09..."`)
  - `org_id`: `string`
  - `actor_id`: `string`
  - `actor_name`: `string`
  - `actor_role`: `string`
  - `action`: `string` (`"LOGIN" | "INVENTORY_RECEIPT" | "TRANSFER_APPROVED" | "OPTIMIZATION_EXECUTED" | "ALERT_ACKNOWLEDGED" | "DAMAGE_REPORT"`)
  - `target_entity`: `string` (`"inventory" | "transfer" | "alert" | "optimization_run" | "user"`)
  - `entity_id`: `string`
  - `details`: `map` (Structured key-value context of the event)
  - `client_ip`: `string | null`
  - `client_user_agent`: `string | null`
  - `timestamp`: `timestamp`
