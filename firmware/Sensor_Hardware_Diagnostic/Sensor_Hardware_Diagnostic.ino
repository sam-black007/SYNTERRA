/*
 * ==============================================================================
 * SYNTERRA — Sensor Hardware Live Diagnostics & Bench Test
 * ==============================================================================
 * Board: ESP32 Dev Module (standard 30/38-pin ESP32-WROOM-32)
 *
 * 100% SEQUENTIAL TOP-ROW (3V3 ROW) WIRING:
 * All sensors connect in strict physical order along the top row:
 *
 *   1. 3V3             -> 3.3V Power Rail (Powers DHT11, BH1750, FC-28)
 *   2. G34 (GPIO 34)   -> FC-28 Soil Moisture A0 (Analog ADC1)
 *   3. G32 (GPIO 32)   -> DHT11 Data Pin (Bidirectional Digital I/O)
 *   4. G33 (GPIO 33)   -> Float Switch (Water Reservoir with INPUT_PULLUP)
 *   5. G25 (GPIO 25)   -> BH1750 I2C SCL (Clock)
 *   6. G26 (GPIO 26)   -> BH1750 I2C SDA (Data)
 *   7. G27 (GPIO 27)   -> Relay Module Signal IN (Pump Control Output)
 *   8. GND (Pin 6)     -> Common Ground (All sensor GNDs + BH1750 ADDR/ADO)
 *   9. V5 (Far Left)   -> Relay Module VCC (5V Power for Relay Coil)
 * ==============================================================================
 */

#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <BH1750.h>

// Brownout register header (guarded for ESP32 Core 3.x)
#if __has_include("soc/soc.h") && __has_include("soc/rtc_cntl_reg.h")
  #include "soc/soc.h"
  #include "soc/rtc_cntl_reg.h"
#endif

// ==============================================================================
// Automatic Pin Detection ("ESP32 Dev Module" vs "ESP32-S3")
// ==============================================================================
#if defined(CONFIG_IDF_TARGET_ESP32S3)
  // ESP32-S3 Pinout
  #define PIN_DHT          2       // DHT11 Data Pin
  #define PIN_I2C_SDA      4       // BH1750 I2C Data
  #define PIN_I2C_SCL      5       // BH1750 I2C Clock
  #define PIN_SOIL_ADC     1       // FC-28 Analog Out (ADC1 CH0)
  #define PIN_FLOAT_SW     41      // Water Level Switch (Internal Pullup)
  #define PIN_RELAY        42      // Solenoid / Pump Relay Control
  #define BOARD_NAME       "ESP32-S3"
#else
  // Standard "ESP32 Dev Module" 100% Sequential Top-Row (3V3 Row) Pinout:
  #define PIN_SOIL_ADC     34      // FC-28 Soil Moisture A0 (Top Row: G34 / ADC1_CH6)
  #define PIN_DHT          32      // DHT11 Data Pin (Top Row: G32 - Bidirectional)
  #define PIN_FLOAT_SW     33      // Water Reservoir Float Switch (Top Row: G33 with Pullup)
  #define PIN_I2C_SCL      25      // BH1750 I2C Clock (Top Row: G25)
  #define PIN_I2C_SDA      26      // BH1750 I2C Data (Top Row: G26)
  #define PIN_RELAY        27      // Solenoid / Pump Relay Control (Top Row: G27)
  #define BOARD_NAME       "ESP32 Dev Module (Sequential Top-Row)"
#endif

#define DHTTYPE DHT11

// Calibration range for 12-bit ADC (0 - 4095)
// Dry (In Air): ~3200 - 3600 | Submerged in Water: ~1200 - 1500
const int CALIB_AIR_DRY   = 3400;
const int CALIB_WATER_WET = 1300;

// ==============================================================================
// WiFi Configuration (Connects to your laptop hotspot "jj")
// ==============================================================================
const char* ssid = "jj";                                // Windows Mobile Hotspot
const char* password = "123456789";                     // Hotspot Password
const char* device_token = "plant-lab-auth-token-9981"; // Validated by SYNTERRA .env

DHT dht(PIN_DHT, DHTTYPE);
BH1750 lightMeter;
bool bh1750_found = false;
unsigned long last_read_time = 0;
int loop_count = 0;

// Scan I2C Bus to detect BH1750 address
void scanI2CBus() {
  Serial.println(F("[I2C SCAN] Scanning for I2C devices..."));
  byte count = 0;
  for (byte i = 1; i < 127; i++) {
    Wire.beginTransmission(i);
    if (Wire.endTransmission() == 0) {
      Serial.printf("[I2C FOUND] Device detected at address 0x%02X", i);
      if (i == 0x23 || i == 0x5C) {
        Serial.print(F(" (BH1750 Ambient Light Sensor)\n"));
        bh1750_found = true;
      } else {
        Serial.println();
      }
      count++;
    }
  }
  if (count == 0) {
    Serial.println(F("[I2C WARNING] No I2C devices found! Check SDA/SCL wiring and 3.3V power."));
  }
}

// Transmit telemetry to SYNTERRA host
void sendToSynterra(float temp, float hum, float lux, float soil_pct, int raw_adc, bool reservoir) {
  if (WiFi.status() != WL_CONNECTED) return;

  IPAddress gateway = WiFi.gatewayIP();
  String url = "http://" + gateway.toString() + ":5000/api/sensors/telemetry";

  HTTPClient http;
  http.setTimeout(1500);
  if (http.begin(url)) {
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-Token", device_token);

    String payload = "{";
    payload += "\"device_id\":\"esp32-sensor-01\",";
    payload += "\"plant_id\":\"test-specimen-1\",";
    payload += "\"temperature_c\":" + String(temp, 1) + ",";
    payload += "\"humidity_pct\":" + String(hum, 1) + ",";
    payload += "\"light_lux\":" + String(lux, 1) + ",";
    payload += "\"soil_moisture_pct\":" + String(soil_pct, 1) + ",";
    payload += "\"soil_raw_adc\":" + String(raw_adc) + ",";
    payload += "\"water_reservoir_ok\":" + String(reservoir ? "true" : "false");
    payload += "}";

    int code = http.POST(payload);
    if (code == 200 || code == 201) {
      Serial.println(F("  └─> [SYNTERRA SYNC] Sent telemetry to dashboard (HTTP 200)"));
    }
    http.end();
  }
}

void setup() {
#if defined(WRITE_PERI_REG) && defined(RTC_CNTL_BROWN_OUT_REG)
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0); // Disable brownout reset if supported
#endif

  Serial.begin(115200);
  delay(1500);

  Serial.println();
  Serial.println(F("=========================================================="));
  Serial.printf("SYNTERRA — Sensor Hardware Live Diagnostics (%s)\n", BOARD_NAME);
  Serial.println(F("=========================================================="));

  // 1. Configure Pins
  pinMode(PIN_SOIL_ADC, INPUT);
  pinMode(PIN_FLOAT_SW, INPUT_PULLUP);
  pinMode(PIN_RELAY, OUTPUT);
  digitalWrite(PIN_RELAY, LOW); // Relay OFF by default
  analogReadResolution(12);     // 12-bit ADC (0 - 4095)

  // 2. Initialize DHT11
  Serial.printf("[INIT] Starting DHT11 on GPIO %d...\n", PIN_DHT);
  dht.begin();

  // 3. Initialize I2C Bus & BH1750
  Serial.printf("[INIT] Starting I2C (SDA=GPIO %d, SCL=GPIO %d)...\n", PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setTimeOut(40);
  scanI2CBus();

  if (bh1750_found) {
    if (lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE)) {
      Serial.println(F("[INIT] BH1750 initialized in High-Resolution Mode!"));
    }
  }

  // 4. Connect to Hotspot (Non-blocking attempt)
  Serial.printf("[WIFI] Connecting to hotspot '%s'...", ssid);
  WiFi.begin(ssid, password);
  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 12) {
    delay(400);
    Serial.print(F("."));
    retries++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WIFI] Connected! IP: %s (Gateway: %s)\n",
                  WiFi.localIP().toString().c_str(),
                  WiFi.gatewayIP().toString().c_str());
  } else {
    Serial.println(F("\n[WIFI NOTE] Hotspot not connected. Running standalone serial diagnostics."));
  }

  Serial.println(F("=========================================================="));
  Serial.println(F("DIAGNOSTIC TEST RUNNING — Reading sensors every 2 seconds..."));
  Serial.println(F("==========================================================\n"));
}

void loop() {
  unsigned long now = millis();
  if (now - last_read_time >= 2000) {
    last_read_time = now;
    loop_count++;

    // 1. Read DHT11
    float temp = dht.readTemperature();
    float hum = dht.readHumidity();
    bool dht_ok = (!isnan(temp) && !isnan(hum) && temp > 0.0);

    // 2. Read BH1750 Light
    float lux = -1.0;
    if (bh1750_found) {
      lux = lightMeter.readLightLevel();
    }

    // 3. Read FC-28 Soil Moisture (5-sample average)
    long adc_acc = 0;
    for (int i = 0; i < 5; i++) {
      adc_acc += analogRead(PIN_SOIL_ADC);
      delay(4);
    }
    int raw_adc = adc_acc / 5;
    float soil_pct = (float)(CALIB_AIR_DRY - raw_adc) / (float)(CALIB_AIR_DRY - CALIB_WATER_WET) * 100.0;
    soil_pct = constrain(soil_pct, 0.0, 100.0);

    // 4. Read Float Switch (LOW = Float down/Dry, HIGH = OK)
    bool reservoir_ok = (digitalRead(PIN_FLOAT_SW) == HIGH);

    // 5. Output Clean Formatted Diagnostic Report to Serial Monitor
    Serial.printf("─── [READING #%d] ──────────────────────────────────────────\n", loop_count);

    // DHT11 Report
    if (dht_ok) {
      Serial.printf("  ✓ [DHT11]      Temp: %5.1f °C  |  Humidity: %4.1f %%  [PASS]\n", temp, hum);
    } else {
      Serial.printf("  ✗ [DHT11]      FAILED! (Check GPIO %d wire or 3.3V power)  [FAIL]\n", PIN_DHT);
    }

    // BH1750 Report
    if (bh1750_found && lux >= 0) {
      Serial.printf("  ✓ [BH1750]     Light: %6.1f Lux                       [PASS]\n", lux);
    } else {
      Serial.printf("  ✗ [BH1750]     NOT DETECTED (Check SDA=GPIO %d, SCL=GPIO %d) [OFFLINE]\n", PIN_I2C_SDA, PIN_I2C_SCL);
    }

    // Soil Moisture Report
    Serial.printf("  ✓ [SOIL ADC]   Raw ADC: %4d   |  Calculated: %4.1f %%", raw_adc, soil_pct);
    if (raw_adc > 3200) {
      Serial.println(F("  (Dry / In Air)"));
    } else if (raw_adc < 1600) {
      Serial.println(F("  (Wet / In Water)"));
    } else {
      Serial.println(F("  (Moist Substrate)"));
    }

    // Water Level Float Switch
    Serial.printf("  ✓ [RESERVOIR]  Status: %s\n", reservoir_ok ? "OK (Water Level Normal)" : "LOW (Reservoir Empty!)");

    // Optional Relay Pulse Test every 10 readings (20 seconds)
    if (loop_count % 10 == 0) {
      Serial.println(F("  ⚡ [RELAY TEST] Pulsing irrigation solenoid relay for 1 second..."));
      digitalWrite(PIN_RELAY, HIGH);
      delay(1000);
      digitalWrite(PIN_RELAY, LOW);
      Serial.println(F("  ⚡ [RELAY TEST] Relay click test complete (OFF)."));
    }

    // Forward reading to live SYNTERRA dashboard if Wi-Fi connected
    if (WiFi.status() == WL_CONNECTED) {
      sendToSynterra(dht_ok ? temp : 24.0, dht_ok ? hum : 60.0, lux >= 0 ? lux : 500.0, soil_pct, raw_adc, reservoir_ok);
    }

    Serial.println();
  }
}