# StockPilot AI — Hardware Prototype Wiring & Assembly Guide

This guide details the complete hardware connection, pinout specifications, power distribution, and Arduino setup for the **StockPilot AI Smart Warehouse Prototype** as shown in your presentation slide.

---

## 1. System Architecture & Components

```
                +-------------------------------------------------+
                |            ESP32 NodeMCU / DevKit V1            |
                |   (Wi-Fi 2.4GHz + Dual Core Xtensa 240MHz)      |
                +-------------------------------------------------+
                    |         |         |         |         |
   +----------------+         |         |         |         +----------------+
   |                          |         |         |                          |
   v                          v         v         v                          v
[HC-SR04]                 [DHT22]    [MQ-2]    [SW-420]                  [SG90]
Ultrasonic Sensor         Temp/Hum   Gas/Smoke Vibration                 Servo Gate
(Carton Detection)        Storage    Hazard    Shock                     Barrier
   |                          |         |         |                          |
   +--------------------------+----+----+---------+--------------------------+
                                   |
                                   v
                      +--------------------------+
                      |   16x2 I2C LCD Display   |
                      | (Live Status & Metrics)  |
                      +--------------------------+
                                   |
                                   v
                      +--------------------------+
                      | Buttons & Status LEDs    |
                      | Green=Dispatch, Red=Stop |
                      +--------------------------+
                                   |
                                   v
             [Google Firebase Firestore] + [StockPilot AI Dashboard]
```

---

## 2. Complete Pinout Connection Table

| Component | Component Pin | ESP32 Pin | Logic Voltage | Function / Notes |
|---|---|---|---|---|
| **HC-SR04** (Ultrasonic) | VCC | **VIN (5V)** | 5V | Power supply |
| | GND | **GND** | 0V | Common Ground |
| | Trig | **GPIO 5** | 3.3V | Trigger pulse from ESP32 |
| | Echo | **GPIO 18** | 3.3V | Return pulse *(Use 1kΩ / 2kΩ divider if 5V Echo)* |
| **SG90 Servo** (Dispatch Gate) | VCC (Red) | **VIN (5V)** | 5V | Higher current power for motor |
| | GND (Brown) | **GND** | 0V | Common Ground |
| | PWM (Orange/Yellow) | **GPIO 13** | 3.3V | Barrier gate angle (0° = Closed, 90° = Open) |
| **DHT22** (Storage Sensor) | VCC / Pin 1 | **3V3** | 3.3V | Power supply |
| | Data / Pin 2 | **GPIO 19** | 3.3V | Digital Temp & Humidity reading *(10kΩ pullup to 3.3V)* |
| | GND / Pin 4 | **GND** | 0V | Common Ground |
| **MQ-2** (Gas/Smoke) | VCC | **VIN (5V)** | 5V | MQ-2 heater requires 5V |
| | GND | **GND** | 0V | Common Ground |
| | A0 (Analog) | **GPIO 34** | 0–3.3V | Analog smoke/gas level *(ADC1 channel safe with Wi-Fi)* |
| | D0 (Digital) | **GPIO 35** | 3.3V | Digital threshold interrupt (optional) |
| **SW-420** (Vibration) | VCC | **3V3** | 3.3V | Power supply |
| | GND | **GND** | 0V | Common Ground |
| | DO (Digital Out) | **GPIO 23** | 3.3V | Goes HIGH on mechanical shock or vibration |
| **16x2 LCD Display** (I2C) | VCC | **VIN (5V)** | 5V | Power supply for backlight and controller |
| | GND | **GND** | 0V | Common Ground |
| | SDA | **GPIO 21** | 3.3V | I2C Data bus |
| | SCL | **GPIO 22** | 3.3V | I2C Clock bus |
| **Green Button** (Dispatch) | Pin 1 | **GPIO 27** | 3.3V | Active LOW with internal `INPUT_PULLUP` |
| | Pin 2 | **GND** | 0V | Connected to ground when pressed |
| **Red Button** (Reset/Stop) | Pin 1 | **GPIO 14** | 3.3V | Active LOW with internal `INPUT_PULLUP` |
| | Pin 2 | **GND** | 0V | Connected to ground when pressed |
| **Green LED** (Normal/Open) | Anode (+) | **GPIO 2** | 3.3V | In series with 220Ω resistor |
| | Cathode (-) | **GND** | 0V | Common Ground |
| **Red LED** (Alert/Closed) | Anode (+) | **GPIO 4** | 3.3V | In series with 220Ω resistor |
| | Cathode (-) | **GND** | 0V | Common Ground |
| **Buzzer** (Active 3.3/5V) | Positive (+) | **GPIO 15** | 3.3V | Tone / Beep signal |
| | Negative (-) | **GND** | 0V | Common Ground |
| **QR Scanner** *(Optional HW)* | TX | **GPIO 16 (RX2)** | 3.3V | Barcode scanner UART Serial output |
| | RX | **GPIO 17 (TX2)** | 3.3V | Barcode scanner UART Serial input |
| | VCC / GND | **VIN / GND** | 5V / 0V | Power supply for scanner module |

---

## 3. Power Distribution & Electrical Rules

1. **Common Ground (GND)**:
   - Connect all GND pins from the sensors, servo motor, LCD, and ESP32 together into a single ground rail on your breadboard.
2. **5V (VIN Rail)**:
   - The **SG90 Servo**, **MQ-2 Gas Sensor heater**, **HC-SR04**, and **16x2 LCD** work best at **5V**. Connect their VCC pins to the ESP32 **VIN** pin (when powered via USB 5V) or an external 5V/2A power supply.
3. **3.3V Rail**:
   - The **DHT22**, **SW-420 Vibration Sensor**, and pull-ups should be powered from the **3V3** pin of the ESP32.
4. **ADC1 Wi-Fi Safety Rule**:
   - On the ESP32, **ADC2 pins cannot be used while Wi-Fi is active**.
   - The MQ-2 analog output is connected to **GPIO 34** (which belongs to **ADC1**), guaranteeing zero Wi-Fi radio conflicts or frozen analog values.
5. **HC-SR04 Echo Level Divider (Best Practice)**:
   - The HC-SR04 Echo pin outputs 5V pulses. While many ESP32 pins are 5V tolerant, placing a simple two-resistor voltage divider (1kΩ and 2kΩ) between the Echo pin and GPIO 18 steps the voltage down safely to 3.3V.

---

## 4. Required Arduino IDE Libraries

Install these libraries via **Tools -> Manage Libraries...** in Arduino IDE:

1. **LiquidCrystal I2C** (by Frank de Brabander or Marco Schwartz)
2. **DHT sensor library** (by Adafruit)
3. **Adafruit Unified Sensor** (by Adafruit)
4. **ESP32Servo** (by Kevin Harrington / John K. Bennett)
5. **ArduinoJson** (by Benoit Blanchon — version 6.x or 7.x)

---

## 5. Quick Start & Upload Instructions

1. Open `hardware/esp32_smart_warehouse/esp32_smart_warehouse.ino` in Arduino IDE.
2. Under **Tools -> Board**, select **ESP32 Dev Module** (or **NodeMCU-32S**).
3. Update lines 43–44 with your Wi-Fi name and password:
   ```cpp
   const char* WIFI_SSID     = "Your_WiFi_Name";
   const char* WIFI_PASSWORD = "Your_WiFi_Password";
   ```
4. Click **Upload**.
5. Open **Tools -> Serial Monitor** and set baud rate to **`115200`**.

---

## 6. How the Prototype Operates

1. **Boot**:
   - Connects to Wi-Fi.
   - Arms the dispatch barrier gate (Servo at 0°).
   - LCD displays `"System Active / Ready to Monitor"`.
2. **Storage Monitoring**:
   - DHT22 reads temperature & humidity every cycle.
   - MQ-2 continuously checks for gas/smoke leaks.
   - SW-420 monitors conveyor vibration and mechanical shocks.
   - Pushes live telemetry every 10 seconds to Firebase Firestore collection `sensor_readings`.
3. **Carton Arrival**:
   - Place a box in front of the HC-SR04 ultrasonic sensor (< 10 cm).
   - The system detects the carton immediately, beeps, and updates the LCD to `"CARTON DETECTED / Ready to Dispatch"`.
4. **QR Code Scanning & Verification**:
   - Point your hardware QR scanner at the box QR label, OR simply type `SCAN` in the Serial Monitor.
   - Decodes SKU, Batch, and Expiry.
5. **Automated Dispatch**:
   - The servo opens the barrier gate (90°).
   - Green LED lights up, confirmation chimes play.
   - Writes an immutable record to Firebase Firestore collection `warehouse_dispatches`.
   - After 5 seconds, the gate automatically lowers back down to 0° (Closed).
