# IoT & WhatsApp Integration Guide — StockPilot AI

## Table of Contents
1. [ESP32 IoT Telemetry](#1-esp32-iot-telemetry)
2. [WhatsApp Business Platform](#2-whatsapp-business-platform)
3. [Simulator Mode](#3-simulator-mode)
4. [Going Live Checklist](#4-going-live-checklist)

---

## 1. ESP32 IoT Telemetry

### 1.1 Device Registration

Before an ESP32 can send telemetry, an org_admin or super_admin must register it:

```bash
POST /api/v1/iot/devices/register
Authorization: Bearer <JWT>

{
  "device_id": "esp32-cold-a-01",
  "warehouse_id": "wh_chicago_01",
  "storage_zone": "Cold Storage A",
  "device_type": "ESP32_COLD_CHAIN",
  "temp_min_threshold": 2.0,
  "temp_max_threshold": 8.0,
  "humidity_max_threshold": 65.0,
  "reporting_interval_sec": 300
}
```

The response includes a **one-time `device_api_key`** — store it in the device firmware securely.
**This key is never stored in plaintext; only its SHA-256 hash is retained.**

---

### 1.2 Telemetry Payload Schema

Send authenticated readings to:

```
POST /api/v1/iot/telemetry
X-IoT-Key: <device_api_key>
```

```json
{
  "device_id": "esp32-cold-a-01",
  "temperature_c": 4.7,
  "temperature_unit": "C",
  "humidity_percent": 58.3,
  "battery_level_percent": 87.0,
  "door_open": false,
  "rssi_dbm": -62.0,
  "boot_count": 14,
  "timestamp": "2026-10-24T10:00:00Z",
  "data_source": "ESP32_SECURE_HARDWARE"
}
```

**Field rules:**

| Field | Required | Notes |
|---|---|---|
| `device_id` | YES | Must match registered device |
| `temperature_c` | YES | Raw value in the declared unit |
| `temperature_unit` | NO | `"C"` (default) or `"F"`. Invalid units → 400 |
| `humidity_percent` | NO | 0–100 |
| `battery_level_percent` | NO | 0–100. Below 15% triggers low_battery alert |
| `door_open` | NO | Boolean. `true` triggers door_ajar alert |
| `rssi_dbm` | NO | Wi-Fi signal strength |
| `timestamp` | NO | ISO 8601 with timezone offset. Omit to use server time |

---

### 1.3 Security Model

| Validation | Rule |
|---|---|
| **Device authentication** | `X-IoT-Key` header checked against per-device SHA-256 hash. Falls back to global `IOT_API_KEY`. |
| **Org/Warehouse binding** | `org_id` and `warehouse_id` are **always** read from the registered device record, never from the payload. |
| **Location mismatch** | If device supplies `supplied_org_id` or `supplied_warehouse_id` differing from registered values, `location_mismatch_detected=true` is set and a security log entry is written. |
| **Future timestamps** | Readings >5 minutes in the future are rejected with HTTP 400. |
| **Stale timestamps** | Readings >7 days old are rejected with HTTP 400. |
| **Sanity bounds** | Temperature must be −100 to +80°C; humidity 0–100%. Out-of-bounds readings are stored as `is_valid=false` with no alerts raised. |

---

### 1.4 Fahrenheit Conversion

The backend accepts `temperature_unit: "F"`. The conversion is:

```
°C = (°F − 32) × 5 / 9
```

The stored value is always `temperature_c` in Celsius. The original unit is preserved in `temperature_unit_received` for audit purposes.

---

### 1.5 Alert Types

| Alert | Trigger | Severity |
|---|---|---|
| `temp_excursion` | temp < min_threshold or > max_threshold | warning / critical |
| `humidity_breach` | humidity > max_threshold | warning |
| `door_ajar` | door_open = true | warning |
| `low_battery` | battery < 15% | warning |

Critical is raised when temp is >4°C above max or >5°C below min.

---

### 1.6 Scalable Storage & Retention Strategy

**Avoids unbounded document growth** by using two collections:

| Collection | Content | Retention |
|---|---|---|
| `sensor_readings` | Raw per-reading documents | 7 days (configurable) |
| `iot_aggregates` | Rolling hourly buckets (one doc per device per hour) | 90 days (configurable) |

Run the prune job manually or on a cron:

```bash
POST /api/v1/iot/retention/prune-and-aggregate
Authorization: Bearer <admin_JWT>

{ "retain_raw_days": 7, "retain_hourly_days": 90 }
```

---

### 1.7 ESP32 Arduino Firmware Example

```cpp
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include "time.h"

// Store these in NVS / encrypted flash — NEVER hardcode in source
const char* DEVICE_ID       = "esp32-cold-a-01";
const char* IOT_API_KEY     = "<device_api_key>";
const char* INGEST_ENDPOINT = "https://api.stockpilot.ai/api/v1/iot/telemetry";
const char* NTP_SERVER      = "pool.ntp.org";

DHT dht(4, DHT22);

void sendTelemetry() {
    struct tm timeinfo;
    char timestamp[30];
    if (getLocalTime(&timeinfo))
        strftime(timestamp, sizeof(timestamp), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);

    StaticJsonDocument<256> doc;
    doc["device_id"] = DEVICE_ID;
    doc["temperature_c"] = dht.readTemperature();
    doc["temperature_unit"] = "C";
    doc["humidity_percent"] = dht.readHumidity();
    doc["battery_level_percent"] = analogRead(35) / 40.96; // calibrate
    doc["door_open"] = false;
    doc["timestamp"] = timestamp;
    doc["data_source"] = "ESP32_SECURE_HARDWARE";

    String body;
    serializeJson(doc, body);

    HTTPClient http;
    http.begin(INGEST_ENDPOINT);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-IoT-Key", IOT_API_KEY);
    int code = http.POST(body);
    http.end();
}
```

---

## 2. WhatsApp Business Platform

### 2.1 Architecture

```
ESP32 → excursion alert → FastAPI → WhatsAppBotService._dispatch_outbound()
                                          ↓
                               Meta Cloud API v21.0
                               POST /v21.0/{phone_number_id}/messages
                                          ↓
                                    Manager's Phone
                                          ↓
                               Webhook POST /api/v1/whatsapp/webhook
                                          ↓
                               HMAC-SHA256 verified
                                          ↓
                               Phone → user lookup
                                          ↓
                               Command parsed & executed
```

---

### 2.2 Webhook Setup (Meta Developer Console)

1. Create a Meta App at https://developers.facebook.com/apps/
2. Add **WhatsApp** product
3. Under **API Setup**, note your **Phone Number ID** and generate a **System User Token** (not temporary).
4. Under **Webhooks**, configure:
   - **Callback URL**: `https://api.stockpilot.ai/api/v1/whatsapp/webhook`
   - **Verify Token**: value of `WHATSAPP_VERIFY_TOKEN` env var
   - **Subscribe to**: `messages`, `message_status`
5. Set environment variables:
   ```env
   WHATSAPP_API_TOKEN=<System User Token>
   WHATSAPP_PHONE_NUMBER_ID=<Phone Number ID>
   WHATSAPP_VERIFY_TOKEN=<your chosen verify token>
   WHATSAPP_APP_SECRET=<App Secret from App Settings → Basic>
   ```

---

### 2.3 Security Model

| Mechanism | Implementation |
|---|---|
| **Signature validation** | `X-Hub-Signature-256` HMAC-SHA256 verified with `WHATSAPP_APP_SECRET`. Mandatory when secret is configured. |
| **Message deduplication** | Meta message IDs stored in `processed_idempotency_keys`. Duplicate webhooks return `status: duplicate_ignored`. |
| **Sender authorization** | `from` phone number normalized and looked up in `users` collection. Unknown senders receive security notice; no action is taken. |
| **Consent management** | `STOP`/`UNSUBSCRIBE`/`OPTOUT` → `whatsapp_opted_in=false`. `START`/`SUBSCRIBE`/`OPTIN` → `whatsapp_opted_in=true`. |
| **Role-based actions** | `APPROVE`/`REJECT` require `supply_chain_manager`, `warehouse_manager`, `org_admin`, or `super_admin`. |
| **Double approval prevention** | `InventoryService.approve_or_reject_transfer` raises 409 if transfer is no longer `pending`. |
| **Secret isolation** | WhatsApp tokens never appear in client code, QR payloads, or deep links. |
| **Safe deep links** | Transfer links format: `https://app.stockpilot.ai/transfers?id=<TRF_ID>` — no secrets in URL. |

---

### 2.4 Supported Commands

| Command | Role Required | Description |
|---|---|---|
| `HELP` | Any authorized | Lists all commands |
| `STATUS` | Any authorized | Network inventory & warehouse health |
| `STOCK <SKU>` | Any authorized | Multi-warehouse stock for product |
| `TRANSFER <TRF_ID>` | Any authorized | Transfer status with deep link |
| `ALERTS` | Any authorized | Unacknowledged cold-chain alerts |
| `APPROVE <TRF_ID>` | Manager+ | Approve pending transfer |
| `REJECT <TRF_ID>` | Any authorized | Reject pending transfer |
| `HUMAN` | Any authorized | Escalate to Operations Desk |
| `STOP` | Any (incl. unregistered) | Opt out of notifications |
| `START` | Any (incl. unregistered) | Opt back in |

---

### 2.5 Outbound Alert Templates

StockPilot dispatches proactive WhatsApp messages for:

| Event | Trigger | Recipients |
|---|---|---|
| Cold-chain excursion | `IoTTelemetryService` detects threshold breach | All opted-in managers in org |
| Stockout / low stock | Inventory falls below safety stock | All opted-in managers |
| Transfer approval request | New transfer created with `pending` status | All opted-in managers |

---

## 3. Simulator Mode

Both IoT and WhatsApp have clearly labeled simulator endpoints that **do not** make real hardware or Meta API calls.

### IoT Simulator
```bash
POST /api/v1/iot/simulator/inject
Authorization: Bearer <JWT>

{
  "device_id": "esp32_sim_01",
  "temperature_c": 12.5,
  "temperature_unit": "C",
  "humidity_percent": 75.0,
  "door_open": true
}
```
- Response includes `is_simulated: true` and `simulator_note`.
- `data_source` is prefixed with `SIMULATOR_`.

### WhatsApp Simulator
```bash
POST /api/v1/whatsapp/simulator/chat
Authorization: Bearer <JWT>

{
  "message_text": "APPROVE trf_001_chi_ny",
  "from_number": "+13125550103"
}
```
- Response includes `is_simulated: true`, `delivery_status: SIMULATED_LOCAL`, and `simulator_note`.
- No real Meta API call is made.
- All interactions are logged to `notification_logs` with `is_simulated: true`.

---

## 4. Going Live Checklist

### IoT
- [ ] Flash device firmware with `device_id` and per-device API key from registration endpoint
- [ ] Verify NTP sync on each ESP32 (clock drift protection enforced server-side)
- [ ] Set `IOT_API_KEY` env var to a strong random secret (≥32 chars)
- [ ] Run first telemetry reading and verify `is_valid: true` in response
- [ ] Configure alerting recipients (ensure phone numbers and `whatsapp_opted_in: true` in user records)
- [ ] Schedule `POST /api/v1/iot/retention/prune-and-aggregate` as a daily cron job

### WhatsApp
- [ ] Complete Meta App setup and Business Verification
- [ ] Set all 4 WhatsApp env vars (`API_TOKEN`, `PHONE_NUMBER_ID`, `VERIFY_TOKEN`, `APP_SECRET`)
- [ ] Register webhook callback URL in Meta Developer Console
- [ ] Subscribe to `messages` and `message_status` webhook fields
- [ ] Send test message and verify round-trip (incoming → HMAC check → command → reply)
- [ ] Confirm `delivery_status` changes from `queued` → `sent` → `delivered` → `read` in `notification_logs`
