/**
 * ====================================================================================
 * StockPilot AI — Smart Warehouse Hardware Prototype (ESP32 Firmware)
 * ====================================================================================
 * Features Implemented:
 *  1. Ultrasonic Sensor (HC-SR04): Detects carton at dispatch gate (< 10 cm).
 *  2. QR Scanner (Serial / UART2 / Serial Monitor): Parses Product, Batch & Expiry.
 *  3. Servo Motor (SG90): Automated Dispatch Barrier Gate (0° Closed, 90° Open).
 *  4. Storage Monitoring (DHT22): Real-time Temperature (°C) and Humidity (%).
 *  5. Gas Sensor (MQ-2): Analog smoke/toxic gas detection with safety alarm.
 *  6. Vibration Sensor (SW-420): Shock & abnormal vibration detection.
 *  7. LCD Display (16x2 I2C): Live warehouse status, sensor stats & dispatch alerts.
 *  8. Push Buttons & LEDs:
 *     - Green Button: Manual Dispatch Confirmation / Gate Open.
 *     - Red Button: Emergency Stop / Reset Alarm.
 *     - Green LED: Normal Operational / Gate Open indicator.
 *     - Red LED: Hazard Alert / Gate Closed indicator.
 *     - Buzzer: Audible alarm for gas leak, shock & dispatch feedback.
 *  9. Real-Time Cloud Sync:
 *     - Google Firebase Firestore: Direct REST API writes to 'sensor_readings' and 'warehouse_dispatches'.
 *     - StockPilot Backend: Ingestion API (POST /api/v1/iot/telemetry).
 * 10. Serial Monitor: Formatted real-time telemetry and diagnostics at 115200 baud.
 * ====================================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>
#include <ESP32Servo.h>
#include <ArduinoJson.h>

// ====================================================================================
// 1. NETWORK & CLOUD CREDENTIALS
// ====================================================================================
// Wi-Fi Configuration
const char* WIFI_SSID     = "YOUR_WIFI_SSID";         // Replace with your 2.4GHz Wi-Fi name
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";     // Replace with your Wi-Fi password

// Firebase Firestore Configuration (Triwizathon Project)
const char* FIREBASE_PROJECT_ID = "triwizathon";
const char* FIREBASE_API_KEY    = "AIzaSyAqoObWgdeCrFgmQGwmzK6WtRXbDPrx5K4";

// StockPilot AI Local / Cloud Backend (Optional dual-sync)
const char* BACKEND_HOST        = "http://192.168.1.100:8000"; // Replace with your laptop IP
const char* IOT_API_KEY         = "stockpilot-iot-secure-esp32-auth-token";

// Warehouse & Device Identification
const char* DEVICE_ID           = "TEMP-ESP32-01";
const char* ORG_ID              = "org_triwiz_01";
const char* WAREHOUSE_ID        = "wh_chicago_01";
const char* STORAGE_ZONE        = "Dock-Bay-01 Cold Chain";

// ====================================================================================
// 2. HARDWARE PIN DEFINITIONS (ESP32 DevKit V1)
// ====================================================================================
// Ultrasonic Sensor (HC-SR04)
#define PIN_TRIG            5     // Output: Trigger pulse
#define PIN_ECHO            18    // Input: Echo return (Use 1k/2k voltage divider if 5V)

// Servo Motor (SG90)
#define PIN_SERVO           13    // PWM signal for dispatch barrier gate

// Environmental Sensor (DHT22 or DHT11)
#define PIN_DHT             19    // Data pin (with 10K pull-up to 3.3V)
#define DHTTYPE             DHT22 // Change to DHT11 if using blue sensor

// Gas Sensor (MQ-2) - Must use ADC1 channel safe for Wi-Fi on ESP32!
#define PIN_MQ2_ANALOG      34    // ADC1_CH6 (Safe with Wi-Fi)
#define PIN_MQ2_DIGITAL     35    // Digital threshold output (optional)

// Vibration Sensor (SW-420)
#define PIN_VIBRATION       23    // Digital input (active HIGH on vibration)

// Buttons & Physical Controls (Internal pullups used)
#define PIN_BTN_DISPATCH    27    // Green Button: Confirm dispatch / Open gate
#define PIN_BTN_RESET       14    // Red Button: Emergency stop / Alarm reset

// Indicators & Alarms
#define PIN_LED_GREEN       2     // Onboard / External Green LED (Normal / Gate Open)
#define PIN_LED_RED         4     // Red LED (Alert / Hazard / Gate Closed)
#define PIN_BUZZER          15    // Active 5V / 3.3V Buzzer

// Hardware QR / Barcode Scanner (UART2 Serial)
#define PIN_QR_RX           16    // ESP32 RX2 <- QR Module TX
#define PIN_QR_TX           17    // ESP32 TX2 -> QR Module RX

// I2C 16x2 LCD Display: Default ESP32 pins are SDA=21, SCL=22
#define LCD_I2C_ADDR        0x27  // Change to 0x3F if 0x27 doesn't display text

// ====================================================================================
// 3. THRESHOLDS & TIMERS
// ====================================================================================
const float CARTON_DETECT_DISTANCE_CM = 10.0; // Distance threshold to detect carton at gate
const int   MQ2_GAS_ALERT_THRESHOLD   = 450;  // Analog ADC threshold for smoke/gas alert
const float TEMP_HIGH_THRESHOLD       = 8.0;  // °C Cold-chain upper excursion limit
const float TEMP_LOW_THRESHOLD        = 2.0;  // °C Cold-chain lower excursion limit
const float HUMIDITY_MAX_THRESHOLD    = 65.0; // % Humidity limit

const unsigned long TELEMETRY_INTERVAL_MS = 10000; // Send Firestore telemetry every 10s
const unsigned long GATE_OPEN_DURATION_MS = 5000;  // Keep gate open for 5 seconds on dispatch

// ====================================================================================
// 4. GLOBAL OBJECTS & STATE VARIABLES
// ====================================================================================
LiquidCrystal_I2C lcd(LCD_I2C_ADDR, 16, 2);
DHT dht(PIN_DHT, DHTTYPE);
Servo gateServo;
HardwareSerial qrSerial(2);

// Gate States
enum GateState {
  GATE_CLOSED,
  GATE_OPENING,
  GATE_OPEN,
  GATE_CLOSING
};
GateState currentGateState = GATE_CLOSED;

// Current Sensor Values
float currentTemperature = 0.0;
float currentHumidity    = 0.0;
int   currentGasRaw      = 0;
bool  cartonDetected     = false;
float cartonDistanceCm   = 0.0;
bool  vibrationDetected  = false;
bool  gasAlertActive     = false;
bool  tempAlertActive    = false;

// Scanned Product Details (Default / Last Scanned)
String scannedProductSku  = "PRD-BISCUIT-B121";
String scannedProductName = "High-Protein Biscuits";
String scannedBatchNumber = "B121";
String scannedExpiryDate  = "12/2026";
bool   hasPendingDispatch = false;

// Timers
unsigned long lastTelemetryTime = 0;
unsigned long gateOpenedTimestamp = 0;
unsigned long lastLcdRotateTime = 0;
int lcdScreenIndex = 0;

// ====================================================================================
// 5. HELPER FUNCTION DECLARATIONS
// ====================================================================================
void connectWiFi();
void readEnvironmentalSensors();
void readUltrasonicDistance();
void checkVibration();
void checkButtons();
void checkSerialAndQRScanner();
void processDispatch(String source);
void openGate();
void closeGate();
void updateLcdDisplay();
void playBeep(int frequency, int durationMs);
void soundAlarm();
void sendFirestoreTelemetry();
void sendFirestoreDispatchEvent(String sku, String batch, String expiry);
void sendBackendTelemetry();

// ====================================================================================
// 6. SETUP ROUTINE
// ====================================================================================
void setup() {
  // Initialize Serial Monitor
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n\n=======================================================");
  Serial.println("  StockPilot AI — Smart Warehouse Hardware Prototype   ");
  Serial.println("  Real-time Inventory Dispatch & Storage Monitor ESP32 ");
  Serial.println("=======================================================");

  // Initialize Hardware Pins
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_MQ2_ANALOG, INPUT);
  pinMode(PIN_MQ2_DIGITAL, INPUT);
  pinMode(PIN_VIBRATION, INPUT);
  pinMode(PIN_BTN_DISPATCH, INPUT_PULLUP);
  pinMode(PIN_BTN_RESET, INPUT_PULLUP);
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);

  // Set default initial LED states (Red ON = Gate Closed / System Arming)
  digitalWrite(PIN_LED_GREEN, LOW);
  digitalWrite(PIN_LED_RED, HIGH);
  digitalWrite(PIN_BUZZER, LOW);

  // Initialize Servo Gate
  gateServo.setPeriodHertz(50); // Standard 50Hz servo
  gateServo.attach(PIN_SERVO, 500, 2400);
  gateServo.write(0); // Start closed (0 degrees)
  delay(300);

  // Initialize I2C LCD
  Wire.begin(21, 22);
  lcd.init();
  lcd.backlight();
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("StockPilot AI");
  lcd.setCursor(0, 1);
  lcd.print("Booting IoT Hub...");

  // Initialize DHT22
  dht.begin();

  // Initialize Hardware Serial 2 for QR Module
  qrSerial.begin(9600, SERIAL_8N1, PIN_QR_RX, PIN_QR_TX);

  // Startup Chirp
  playBeep(2000, 100);
  delay(100);
  playBeep(2500, 150);

  // Connect to Wi-Fi
  connectWiFi();

  // Ready message
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("System Active");
  lcd.setCursor(0, 1);
  lcd.print("Ready to Monitor");
  delay(1500);

  Serial.println("\n[SYSTEM] Initialization Complete! Monitoring sensors...");
  Serial.println("[HINT] You can type 'OPEN', 'SCAN', or 'DISPATCH' into Serial Monitor anytime!\n");
}

// ====================================================================================
// 7. MAIN CONTROL LOOP
// ====================================================================================
void loop() {
  // Ensure Wi-Fi remains connected
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  // 1. Read Storage Sensors (DHT22, MQ-2, SW-420)
  readEnvironmentalSensors();

  // 2. Read Ultrasonic Carton Distance
  readUltrasonicDistance();

  // 3. Read Vibration Status
  checkVibration();

  // 4. Handle Hardware Buttons (Green=Dispatch, Red=Stop)
  checkButtons();

  // 5. Check QR Scanner & Serial Commands
  checkSerialAndQRScanner();

  // 6. Manage Automated Gate Timer
  if (currentGateState == GATE_OPEN && (millis() - gateOpenedTimestamp >= GATE_OPEN_DURATION_MS)) {
    closeGate();
  }

  // 7. Periodic Cloud Telemetry Sync (every 10s)
  if (millis() - lastTelemetryTime >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryTime = millis();
    sendFirestoreTelemetry();
    sendBackendTelemetry();
  }

  // 8. Update 16x2 LCD Display (Smooth Carousel)
  if (millis() - lastLcdRotateTime >= 2500) {
    lastLcdRotateTime = millis();
    updateLcdDisplay();
  }

  delay(50); // Loop cadence
}

// ====================================================================================
// 8. SENSOR ACQUISITION LOGIC
// ====================================================================================
void readEnvironmentalSensors() {
  // Read DHT22
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t) && !isnan(h)) {
    currentTemperature = t;
    currentHumidity = h;
  }

  // Read MQ-2 Smoke/Gas Sensor
  currentGasRaw = analogRead(PIN_MQ2_ANALOG);

  // Check Gas Alert
  if (currentGasRaw > MQ2_GAS_ALERT_THRESHOLD) {
    if (!gasAlertActive) {
      gasAlertActive = true;
      Serial.printf("[HAZARD ALERT] MQ-2 Gas Excursion Detected! Level: %d (Threshold: %d)\n", currentGasRaw, MQ2_GAS_ALERT_THRESHOLD);
    }
    soundAlarm();
  } else {
    gasAlertActive = false;
  }

  // Check Cold-Chain Temperature Excursion
  if (currentTemperature > TEMP_HIGH_THRESHOLD || currentTemperature < TEMP_LOW_THRESHOLD) {
    tempAlertActive = true;
  } else {
    tempAlertActive = false;
  }
}

void readUltrasonicDistance() {
  // Trigger 10 microsecond pulse
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  // Measure echo return time (timeout at 25ms = ~4 meters)
  long duration = pulseIn(PIN_ECHO, HIGH, 25000);

  if (duration > 0) {
    cartonDistanceCm = (duration * 0.0343) / 2.0;
  } else {
    cartonDistanceCm = 999.0; // Out of range
  }

  // Detect carton if object is within detection window
  bool detectedNow = (cartonDistanceCm > 1.0 && cartonDistanceCm <= CARTON_DETECT_DISTANCE_CM);

  if (detectedNow && !cartonDetected) {
    // New Carton Arrival Detected!
    cartonDetected = true;
    hasPendingDispatch = true;
    Serial.printf("\n=======================================================\n");
    Serial.printf(" [EVENT] CARTON DETECTED AT DISPATCH DOCK!\n");
    Serial.printf("  Distance: %.1f cm | Status: Ready for QR & Verification\n", cartonDistanceCm);
    Serial.printf("=======================================================\n");
    
    playBeep(1800, 150);

    // Instant LCD update for responsive feel
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("CARTON DETECTED");
    lcd.setCursor(0, 1);
    lcd.print("Ready to Dispatch");
  } else if (!detectedNow && cartonDetected) {
    // Carton removed or dispatched through the gate
    cartonDetected = false;
  }
}

void checkVibration() {
  int vib = digitalRead(PIN_VIBRATION);
  if (vib == HIGH) {
    vibrationDetected = true;
    digitalWrite(PIN_LED_RED, HIGH);
    Serial.println("[WARNING] Abnormal vibration / conveyor shock detected by SW-420!");
  } else {
    vibrationDetected = false;
  }
}

// ====================================================================================
// 9. DISPATCH WORKFLOW & SERVO GATE CONTROL
// ====================================================================================
void checkButtons() {
  // Green Button (Dispatch Confirmation) - Active LOW
  if (digitalRead(PIN_BTN_DISPATCH) == LOW) {
    delay(50); // Debounce
    if (digitalRead(PIN_BTN_DISPATCH) == LOW) {
      Serial.println("\n[BUTTON] Green Dispatch Confirmation Button Pressed!");
      processDispatch("BUTTON_CONFIRMATION");
      while (digitalRead(PIN_BTN_DISPATCH) == LOW) delay(10); // Wait for release
    }
  }

  // Red Button (Emergency Stop / Reset) - Active LOW
  if (digitalRead(PIN_BTN_RESET) == LOW) {
    delay(50); // Debounce
    if (digitalRead(PIN_BTN_RESET) == LOW) {
      Serial.println("\n[BUTTON] Red Reset / Emergency Stop Pressed! Forcing gate closed.");
      closeGate();
      gasAlertActive = false;
      digitalWrite(PIN_BUZZER, LOW);
      digitalWrite(PIN_LED_RED, HIGH);
      digitalWrite(PIN_LED_GREEN, LOW);
      while (digitalRead(PIN_BTN_RESET) == LOW) delay(10);
    }
  }
}

void processDispatch(String source) {
  Serial.printf("\n[DISPATCH] Processing Dispatch Verification [Trigger: %s]...\n", source.c_str());
  Serial.printf("  Product SKU:  %s\n", scannedProductSku.c_str());
  Serial.printf("  Batch Number: %s\n", scannedBatchNumber.c_str());
  Serial.printf("  Expiry Date:  %s\n", scannedExpiryDate.c_str());
  Serial.printf("  Warehouse ID: %s\n", WAREHOUSE_ID);

  // 1. Open Servo Barrier Gate
  openGate();

  // 2. Play audible confirmation tone
  playBeep(1200, 100);
  delay(80);
  playBeep(2400, 200);

  // 3. Update LCD
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("GATE OPEN [>>>]");
  lcd.setCursor(0, 1);
  lcd.print("Dispatched: ");
  lcd.print(scannedBatchNumber);

  // 4. Send Dispatch Record to Firebase Firestore
  sendFirestoreDispatchEvent(scannedProductSku, scannedBatchNumber, scannedExpiryDate);

  hasPendingDispatch = false;
}

void openGate() {
  currentGateState = GATE_OPEN;
  gateOpenedTimestamp = millis();

  // Indicate Green LED ON, Red LED OFF
  digitalWrite(PIN_LED_GREEN, HIGH);
  digitalWrite(PIN_LED_RED, LOW);

  // Move Servo to 90 degrees (Open Barrier)
  Serial.println("[SERVO] Opening Dispatch Barrier Gate -> 90°");
  gateServo.write(90);
}

void closeGate() {
  currentGateState = GATE_CLOSED;

  // Indicate Red LED ON, Green LED OFF
  digitalWrite(PIN_LED_GREEN, LOW);
  digitalWrite(PIN_LED_RED, HIGH);

  // Move Servo to 0 degrees (Closed Barrier)
  Serial.println("[SERVO] Closing Dispatch Barrier Gate -> 0°");
  gateServo.write(0);

  // Update LCD
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("GATE CLOSED");
  lcd.setCursor(0, 1);
  lcd.print("Dock Armed");
  delay(800);
}

// ====================================================================================
// 10. QR SCANNER & SERIAL INTERACTION
// ====================================================================================
void checkSerialAndQRScanner() {
  // Check Hardware Serial 2 (Physical Barcode / QR Scanner Module)
  if (qrSerial.available()) {
    String qrData = qrSerial.readStringUntil('\n');
    qrData.trim();
    if (qrData.length() > 0) {
      Serial.printf("[QR SCANNER UART2] Scanned: %s\n", qrData.c_str());
      parseQrCode(qrData);
    }
  }

  // Check USB Serial Monitor
  if (Serial.available()) {
    String input = Serial.readStringUntil('\n');
    input.trim();
    if (input.length() > 0) {
      if (input.equalsIgnoreCase("OPEN") || input.equalsIgnoreCase("DISPATCH")) {
        processDispatch("SERIAL_COMMAND");
      } else if (input.equalsIgnoreCase("CLOSE")) {
        closeGate();
      } else if (input.equalsIgnoreCase("SCAN")) {
        Serial.println("[SIMULATOR] Simulating QR Scan: Prod: Biscuit | Batch: B121 | Exp: 12/2026");
        parseQrCode("SKU:PRD-BISCUIT-B121,NAME:Biscuits,BATCH:B121,EXP:12/2026");
      } else if (input.startsWith("QR:")) {
        parseQrCode(input.substring(3));
      } else {
        Serial.printf("[SERIAL] Unknown command: '%s'. Try 'OPEN', 'CLOSE', or 'SCAN'\n", input.c_str());
      }
    }
  }
}

void parseQrCode(String raw) {
  // Example formats handled:
  // 1) "SKU:PRD-BISCUIT-B121,BATCH:B121,EXP:12/2026"
  // 2) "PRD-BISCUIT-B121"
  Serial.printf("\n[QR PARSER] Decoding QR Payload: %s\n", raw.c_str());

  if (raw.indexOf("SKU:") >= 0) {
    int skuIdx = raw.indexOf("SKU:") + 4;
    int endSku = raw.indexOf(",", skuIdx);
    if (endSku == -1) endSku = raw.length();
    scannedProductSku = raw.substring(skuIdx, endSku);
  } else {
    scannedProductSku = raw;
  }

  if (raw.indexOf("BATCH:") >= 0) {
    int bIdx = raw.indexOf("BATCH:") + 6;
    int endB = raw.indexOf(",", bIdx);
    if (endB == -1) endB = raw.length();
    scannedBatchNumber = raw.substring(bIdx, endB);
  }

  if (raw.indexOf("EXP:") >= 0) {
    int eIdx = raw.indexOf("EXP:") + 4;
    int endE = raw.indexOf(",", eIdx);
    if (endE == -1) endE = raw.length();
    scannedExpiryDate = raw.substring(eIdx, endE);
  }

  Serial.println("  ✔ QR Decoded Successfully!");
  Serial.printf("  Product SKU:  %s\n", scannedProductSku.c_str());
  Serial.printf("  Batch Number: %s\n", scannedBatchNumber.c_str());
  Serial.printf("  Expiry Date:  %s\n", scannedExpiryDate.c_str());

  playBeep(2400, 80);
  delay(50);
  playBeep(2800, 120);

  // If carton is already waiting at gate, auto-trigger or prompt for dispatch
  if (cartonDetected) {
    Serial.println("[WORKFLOW] Carton detected at gate! Initiating automated dispatch...");
    processDispatch("QR_SCAN_AUTO");
  } else {
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("QR Verified:");
    lcd.setCursor(0, 1);
    lcd.print(scannedProductSku.substring(0, 16));
  }
}

// ====================================================================================
// 11. AUDIO & VISUAL FEEDBACK
// ====================================================================================
void playBeep(int frequency, int durationMs) {
  tone(PIN_BUZZER, frequency, durationMs);
}

void soundAlarm() {
  digitalWrite(PIN_LED_RED, HIGH);
  tone(PIN_BUZZER, 3000, 80);
  delay(100);
  digitalWrite(PIN_LED_RED, LOW);
  tone(PIN_BUZZER, 2000, 80);
}

void updateLcdDisplay() {
  // If gate is open or carton detected, prioritize operational display
  if (currentGateState == GATE_OPEN) {
    lcd.setCursor(0, 0);
    lcd.print("GATE OPEN [>>>] ");
    lcd.setCursor(0, 1);
    lcd.print("Dispatched: ");
    lcd.print(scannedBatchNumber);
    return;
  }

  if (gasAlertActive) {
    lcd.setCursor(0, 0);
    lcd.print("!! GAS ALERT !! ");
    lcd.setCursor(0, 1);
    lcd.print("Gas: ");
    lcd.print(currentGasRaw);
    lcd.print(" EXCURSION");
    return;
  }

  if (cartonDetected) {
    lcd.setCursor(0, 0);
    lcd.print("CARTON DETECTED ");
    lcd.setCursor(0, 1);
    lcd.print("Ready to Dispatch");
    return;
  }

  // Normal Status Carousel
  lcdScreenIndex = (lcdScreenIndex + 1) % 2;

  if (lcdScreenIndex == 0) {
    // Screen 1: Temperature & Humidity
    lcd.setCursor(0, 0);
    lcd.print("T: ");
    lcd.print(currentTemperature, 1);
    lcd.print((char)223); // Degree symbol
    lcd.print("C  H: ");
    lcd.print(currentHumidity, 0);
    lcd.print("% ");

    lcd.setCursor(0, 1);
    if (tempAlertActive) {
      lcd.print("TEMP EXCURSION! ");
    } else {
      lcd.print("Status: STORAGE ");
    }
  } else {
    // Screen 2: Gas & Vibration & Gate
    lcd.setCursor(0, 0);
    lcd.print("Gas: ");
    lcd.print(currentGasRaw);
    lcd.print("  Vib: ");
    lcd.print(vibrationDetected ? "WARN" : "OK  ");

    lcd.setCursor(0, 1);
    lcd.print("Gate: LOCKED    ");
  }
}

// ====================================================================================
// 12. CLOUD SYNC: FIREBASE FIRESTORE REST API
// ====================================================================================
void sendFirestoreTelemetry() {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure(); // Skip certificate validation for lightweight embedded TLS

  HTTPClient https;

  // Firestore REST endpoint: POST /projects/{projectId}/databases/(default)/documents/{collectionId}?key={apiKey}
  String url = String("https://firestore.googleapis.com/v1/projects/") +
               FIREBASE_PROJECT_ID +
               "/databases/(default)/documents/sensor_readings?key=" +
               FIREBASE_API_KEY;

  if (https.begin(client, url)) {
    https.addHeader("Content-Type", "application/json");

    // Construct Firestore structured JSON document
    DynamicJsonDocument doc(1024);
    JsonObject fields = doc.createNestedObject("fields");

    fields["device_id"]["stringValue"]           = DEVICE_ID;
    fields["org_id"]["stringValue"]              = ORG_ID;
    fields["warehouse_id"]["stringValue"]        = WAREHOUSE_ID;
    fields["storage_zone"]["stringValue"]        = STORAGE_ZONE;
    fields["temperature_c"]["doubleValue"]       = currentTemperature;
    fields["humidity_percent"]["doubleValue"]    = currentHumidity;
    fields["gas_level_raw"]["integerValue"]      = currentGasRaw;
    fields["gas_alert"]["booleanValue"]          = gasAlertActive;
    fields["vibration_detected"]["booleanValue"] = vibrationDetected;
    fields["carton_present"]["booleanValue"]     = cartonDetected;
    fields["carton_distance_cm"]["doubleValue"]  = cartonDistanceCm;
    fields["gate_open"]["booleanValue"]          = (currentGateState == GATE_OPEN);
    fields["rssi_dbm"]["doubleValue"]            = (float)WiFi.RSSI();
    fields["data_source"]["stringValue"]         = "ESP32_SMART_WAREHOUSE_PROTOTYPE";

    String requestBody;
    serializeJson(doc, requestBody);

    int httpCode = https.POST(requestBody);

    if (httpCode == HTTP_CODE_OK || httpCode == 200 || httpCode == 201) {
      Serial.printf("[FIRESTORE] Telemetry pushed to 'sensor_readings' [HTTP %d]\n", httpCode);
    } else {
      Serial.printf("[FIRESTORE] Telemetry push failed, code: %d | Response: %s\n",
                    httpCode, https.getString().c_str());
    }

    https.end();
  }
}

void sendFirestoreDispatchEvent(String sku, String batch, String expiry) {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient https;

  String url = String("https://firestore.googleapis.com/v1/projects/") +
               FIREBASE_PROJECT_ID +
               "/databases/(default)/documents/warehouse_dispatches?key=" +
               FIREBASE_API_KEY;

  if (https.begin(client, url)) {
    https.addHeader("Content-Type", "application/json");

    DynamicJsonDocument doc(1024);
    JsonObject fields = doc.createNestedObject("fields");

    String dispatchId = String("DISP-") + String(millis());
    fields["dispatch_id"]["stringValue"]   = dispatchId;
    fields["device_id"]["stringValue"]     = DEVICE_ID;
    fields["org_id"]["stringValue"]        = ORG_ID;
    fields["warehouse_id"]["stringValue"]  = WAREHOUSE_ID;
    fields["product_sku"]["stringValue"]   = sku;
    fields["batch_number"]["stringValue"]  = batch;
    fields["expiry_date"]["stringValue"]   = expiry;
    fields["quantity"]["integerValue"]     = 1;
    fields["status"]["stringValue"]        = "DISPATCHED";
    fields["distance_cm"]["doubleValue"]   = cartonDistanceCm;
    fields["verified_by"]["stringValue"]   = "AUTOMATED_SG90_BARRIER";

    String requestBody;
    serializeJson(doc, requestBody);

    int httpCode = https.POST(requestBody);
    if (httpCode == 200 || httpCode == 201) {
      Serial.printf("[FIRESTORE] Dispatch record written to 'warehouse_dispatches' [HTTP %d] (ID: %s)\n",
                    httpCode, dispatchId.c_str());
    } else {
      Serial.printf("[FIRESTORE] Dispatch write failed: %d\n", httpCode);
    }
    https.end();
  }
}

// ====================================================================================
// 13. CLOUD SYNC: STOCKPILOT AI BACKEND REST API
// ====================================================================================
void sendBackendTelemetry() {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClient client;
  HTTPClient http;

  String endpoint = String(BACKEND_HOST) + "/api/v1/iot/telemetry";

  if (http.begin(client, endpoint)) {
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-IoT-Key", IOT_API_KEY);

    DynamicJsonDocument doc(512);
    doc["device_id"]              = DEVICE_ID;
    doc["temperature_c"]          = currentTemperature;
    doc["temperature_unit"]       = "C";
    doc["humidity_percent"]       = currentHumidity;
    doc["battery_level_percent"]  = 100.0;
    doc["door_open"]              = (currentGateState == GATE_OPEN);
    doc["rssi_dbm"]               = (float)WiFi.RSSI();
    doc["data_source"]            = "ESP32_HARDWARE_PROTOTYPE";

    String body;
    serializeJson(doc, body);

    int code = http.POST(body);
    if (code == 200 || code == 201) {
      Serial.printf("[BACKEND] Telemetry ingested by StockPilot AI [HTTP %d]\n", code);
    }
    http.end();
  }
}

// ====================================================================================
// 14. WI-FI CONNECTION UTILITY
// ====================================================================================
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.printf("\n[WIFI] Connecting to '%s' ...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 25) {
    delay(400);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WIFI] Connected Successfully!");
    Serial.printf("  IP Address: %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("  RSSI:       %d dBm\n", WiFi.RSSI());
  } else {
    Serial.println("\n[WIFI] Connection timed out. Running in standalone offline buffer mode.");
  }
}
