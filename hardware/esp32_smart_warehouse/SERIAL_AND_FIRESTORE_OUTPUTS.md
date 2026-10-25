# StockPilot AI — Real-Time Serial Monitor & Firebase Firestore Verification

This document illustrates the exact outputs produced on the **Arduino Serial Monitor (115200 baud)** and the documents written in **Google Firebase Firestore** by the ESP32 Smart Warehouse prototype.

---

## 1. Arduino Serial Monitor (115200 Baud) Output

### A. Power-on & Wi-Fi Initialization
```text
=======================================================
  StockPilot AI — Smart Warehouse Hardware Prototype   
  Real-time Inventory Dispatch & Storage Monitor ESP32 
=======================================================
[SERVO] Initializing Barrier Gate -> 0° (Closed)
[LCD] I2C 16x2 Display Initialized at Address 0x27
[DHT22] Storage Sensor Calibrated
[QR] Hardware Serial2 (UART2) Listening on RX:16 TX:17

[WIFI] Connecting to 'Triwiz_Warehouse_WiFi' ...
......
[WIFI] Connected Successfully!
  IP Address: 192.168.1.145
  RSSI:       -54 dBm

[SYSTEM] Initialization Complete! Monitoring sensors...
[HINT] You can type 'OPEN', 'SCAN', or 'DISPATCH' into Serial Monitor anytime!
```

---

### B. Live Storage Telemetry & Firestore Push
```text
[TELEMETRY] Sensor Sweep:
  Temp: 24.2°C | Humidity: 58.0% | Gas ADC: 142 (Norm) | Vib: OK
[FIRESTORE] Telemetry pushed to 'sensor_readings' [HTTP 200]
[BACKEND] Telemetry ingested by StockPilot AI [HTTP 200]
```

---

### C. Carton Arrival Detected by HC-SR04
```text
=======================================================
 [EVENT] CARTON DETECTED AT DISPATCH DOCK!
  Distance: 6.8 cm | Status: Ready for QR & Verification
=======================================================
[LCD] Updated: "CARTON DETECTED / Ready to Dispatch"
[CHIRP] Audio notification played
```

---

### D. QR Code Scan & Verification
*(Triggered via barcode reader module or by typing `SCAN` into Serial Monitor)*
```text
[QR SCANNER UART2] Scanned: SKU:PRD-BISCUIT-B121,NAME:Biscuits,BATCH:B121,EXP:12/2026

[QR PARSER] Decoding QR Payload: SKU:PRD-BISCUIT-B121,NAME:Biscuits,BATCH:B121,EXP:12/2026
  ✔ QR Decoded Successfully!
  Product SKU:  PRD-BISCUIT-B121
  Batch Number: B121
  Expiry Date:  12/2026
[WORKFLOW] Carton detected at gate! Initiating automated dispatch...

[DISPATCH] Processing Dispatch Verification [Trigger: QR_SCAN_AUTO]...
  Product SKU:  PRD-BISCUIT-B121
  Batch Number: B121
  Expiry Date:  12/2026
  Warehouse ID: wh_chicago_01
[SERVO] Opening Dispatch Barrier Gate -> 90°
[LED] Green LED Activated (Gate OPEN)
[FIRESTORE] Dispatch record written to 'warehouse_dispatches' [HTTP 200] (ID: DISP-1849201)
[LCD] Updated: "GATE OPEN [>>>] / Dispatched: B121"
```

---

### E. Gate Auto-Close after 5 Seconds
```text
[SERVO] Closing Dispatch Barrier Gate -> 0°
[LED] Red LED Activated (Gate LOCKED)
[LCD] Updated: "GATE CLOSED / Dock Armed"
```

---

### F. Gas Excursion or Abnormal Vibration Alert
```text
[HAZARD ALERT] MQ-2 Gas Excursion Detected! Level: 582 (Threshold: 450)
[ALARM] Alternating buzzer frequency & pulsing Red LED!
[LCD] Updated: "!! GAS ALERT !! / Gas: 582 EXCURSION"
```

---

## 2. Interactive Serial Monitor Commands

You can interact with the prototype directly using the Arduino Serial Monitor input bar:

| Command | Action |
|---|---|
| `SCAN` | Simulates scanning the sample Biscuit carton (`PRD-BISCUIT-B121`, Batch `B121`, Exp `12/2026`). |
| `OPEN` or `DISPATCH` | Manually triggers the servo barrier gate to open (90°) and logs a dispatch event. |
| `CLOSE` | Forces the servo barrier gate to close (0°). |
| `QR:<custom_string>` | Injects custom QR payloads, e.g. `QR:SKU:PRD-VAX-01,BATCH:B990,EXP:08/2027`. |

---

## 3. Documents Created in Firebase Firestore

### Collection 1: `sensor_readings`
*(Written automatically every 10 seconds)*
```json
{
  "fields": {
    "device_id": { "stringValue": "TEMP-ESP32-01" },
    "org_id": { "stringValue": "org_triwiz_01" },
    "warehouse_id": { "stringValue": "wh_chicago_01" },
    "storage_zone": { "stringValue": "Dock-Bay-01 Cold Chain" },
    "temperature_c": { "doubleValue": 24.2 },
    "humidity_percent": { "doubleValue": 58.0 },
    "gas_level_raw": { "integerValue": 142 },
    "gas_alert": { "booleanValue": false },
    "vibration_detected": { "booleanValue": false },
    "carton_present": { "booleanValue": true },
    "carton_distance_cm": { "doubleValue": 6.8 },
    "gate_open": { "booleanValue": false },
    "rssi_dbm": { "doubleValue": -54.0 },
    "data_source": { "stringValue": "ESP32_SMART_WAREHOUSE_PROTOTYPE" }
  }
}
```

---

### Collection 2: `warehouse_dispatches`
*(Written whenever a carton is verified and dispatched)*
```json
{
  "fields": {
    "dispatch_id": { "stringValue": "DISP-1849201" },
    "device_id": { "stringValue": "TEMP-ESP32-01" },
    "org_id": { "stringValue": "org_triwiz_01" },
    "warehouse_id": { "stringValue": "wh_chicago_01" },
    "product_sku": { "stringValue": "PRD-BISCUIT-B121" },
    "batch_number": { "stringValue": "B121" },
    "expiry_date": { "stringValue": "12/2026" },
    "quantity": { "integerValue": 1 },
    "status": { "stringValue": "DISPATCHED" },
    "distance_cm": { "doubleValue": 6.8 },
    "verified_by": { "stringValue": "AUTOMATED_SG90_BARRIER" }
  }
}
```
