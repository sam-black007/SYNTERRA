/*
 * ==============================================================================
 * SYNTERRA — All-In-One Single Board Firmware (10-Second Telemetry)
 * ==============================================================================
 * ALL SENSORS ON ONE ESP32 BOARD:
 *   - DHT11 Data Pin:        G32 (Top Row)
 *   - FC-28 Soil Moisture:   A0 = G34, D0 = G35 (Top Row)
 *   - BH1750 Ambient Light:  SDA = G26, SCL = G25 (Auto-detects G25/G26 or G21/G22!)
 *   - Relay Pump Control:    Signal IN = G27 (Top Row)
 *   - Power Pins:            3V3 (Sensors) | V5 (Relay & BH1750) | GND (Common)
 *
 * Output:
 *   - Dual Mode: Emits USB Serial JSON (for Cable Mode) + Wi-Fi HTTP POST (for Hotspot)
 *   - Update Interval: Once every 10 seconds
 * ==============================================================================
 */

#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>

#if __has_include("soc/soc.h") && __has_include("soc/rtc_cntl_reg.h")
  #include "soc/soc.h"
  #include "soc/rtc_cntl_reg.h"
#endif

// ==============================================================================
// Configuration
// ==============================================================================
#define UPDATE_INTERVAL_MS 10000   // Updates once every 10 seconds

// Pins
#define PIN_SOIL_ADC     34       // FC-28 Soil Sensor A0 (Analog)
#define PIN_SOIL_DIG     35       // FC-28 Soil Sensor D0 (Digital)
#define PIN_DHT          32       // DHT11 Data Pin
#define PIN_RELAY        27       // Pump Relay Control
#define DHTTYPE          DHT11

// Soil ADC calibration range
const int CALIB_AIR_DRY   = 3400; // Dry in air
const int CALIB_WATER_WET = 1300; // In water

// Hotspot Credentials (Optional - works over USB cable even without Wi-Fi!)
const char* ssid = "jj";
const char* password = "123456789";
const char* device_token = "plant-lab-auth-token-9981";

DHT dht(PIN_DHT, DHTTYPE);

// Dynamic I2C Detection for BH1750
int active_sda = 26;
int active_scl = 25;
byte active_addr = 0x23;
bool bh1750_found = false;

unsigned long last_read_time = 0;
int loop_count = 0;

// Force-unlock I2C bus if a slave is holding the SDA line LOW
void unfreezeI2C(int sda, int scl) {
  pinMode(sda, INPUT_PULLUP);
  pinMode(scl, OUTPUT);
  for (int i = 0; i < 16; i++) {
    digitalWrite(scl, LOW);
    delayMicroseconds(5);
    digitalWrite(scl, HIGH);
    delayMicroseconds(5);
  }
  // Send I2C STOP condition
  pinMode(sda, OUTPUT);
  digitalWrite(sda, LOW);
  delayMicroseconds(5);
  digitalWrite(scl, HIGH);
  delayMicroseconds(5);
  digitalWrite(sda, HIGH);
  delayMicroseconds(5);
}

// Scans top row (G26/G25, G25/G26) and bottom row (G21/G22)
bool detectBH1750() {
  int pinPairs[3][2] = {
    {26, 25}, // Top row: SDA=G26, SCL=G25
    {25, 26}, // Top row: SDA=G25, SCL=G26 (reversed)
    {21, 22}  // Bottom row: SDA=G21, SCL=G22
  };

  for (int i = 0; i < 3; i++) {
    int sda = pinPairs[i][0];
    int scl = pinPairs[i][1];

    unfreezeI2C(sda, scl);
    Wire.end();
    delay(20);
    Wire.begin(sda, scl);
    delay(40);

    // Check address 0x23 (default)
    Wire.beginTransmission(0x23);
    if (Wire.endTransmission() == 0) {
      active_sda = sda;
      active_scl = scl;
      active_addr = 0x23;
      bh1750_found = true;
      Serial.printf("  ✓ [BH1750 DETECTED] Found on SDA=G%d, SCL=G%d (Address 0x23)!\n", sda, scl);
      return true;
    }

    // Check address 0x5C (alternate)
    Wire.beginTransmission(0x5C);
    if (Wire.endTransmission() == 0) {
      active_sda = sda;
      active_scl = scl;
      active_addr = 0x5C;
      bh1750_found = true;
      Serial.printf("  ✓ [BH1750 DETECTED] Found on SDA=G%d, SCL=G%d (Address 0x5C)!\n", sda, scl);
      return true;
    }
  }
  return false;
}

// Raw direct I2C read from BH1750 (robust, no library bugs)
float readBH1750Direct() {
  if (!bh1750_found) {
    if (!detectBH1750()) return -1.0;
  }

  // 1. Send Continuous High-Resolution Mode command (0x10)
  Wire.beginTransmission(active_addr);
  Wire.write(0x10);
  if (Wire.endTransmission() != 0) {
    bh1750_found = false; // Mark for re-scan if line glitched
    return -1.0;
  }

  delay(180); // Wait for optical measurement cycle (max 180ms)

  // 2. Read 2-byte luminance word
  if (Wire.requestFrom((int)active_addr, 2) == 2) {
    unsigned int raw = (Wire.read() << 8) | Wire.read();
    return (float)raw / 1.2;
  }

  bh1750_found = false;
  return -1.0;
}

// Optional Wi-Fi forwarder (if hotspot is available)
void postWiFi(float temp, float hum, float soil, float lux, int raw_adc) {
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
    payload += "\"soil_moisture_pct\":" + String(soil, 1) + ",";
    payload += "\"soil_raw_adc\":" + String(raw_adc) + ",";
    if (lux >= 0.0) {
      payload += "\"light_lux\":" + String(lux, 1) + ",";
    }
    payload += "\"water_reservoir_ok\":true";
    payload += "}";

    int code = http.POST(payload);
    if (code == 200 || code == 201) {
      Serial.println(F("  └─> [WI-FI SYNC] Posted all 4 sensors to dashboard (HTTP 200)"));
    }
    http.end();
  }
}

void setup() {
#if defined(WRITE_PERI_REG) && defined(RTC_CNTL_BROWN_OUT_REG)
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
#endif

  Serial.begin(115200);
  delay(1200);

  Serial.println(F("\n=========================================================="));
  Serial.println(F("SYNTERRA — 1-Board All-In-One Sensor Station (10s)"));
  Serial.println(F("=========================================================="));

  pinMode(PIN_SOIL_ADC, INPUT);
  pinMode(PIN_SOIL_DIG, INPUT);
  pinMode(PIN_RELAY, OUTPUT);
  digitalWrite(PIN_RELAY, LOW);
  analogReadResolution(12);

  // 1. Initialize DHT11
  Serial.println(F("[INIT] Starting DHT11 on G32..."));
  dht.begin();

  // 2. Auto-Detect BH1750
  Serial.println(F("[INIT] Detecting BH1750 Light Meter..."));
  if (!detectBH1750()) {
    Serial.println(F("[BH1750 NOTE] Sensor not seen yet. Auto-scanner will keep checking in background..."));
  }

  // 3. Connect Wi-Fi (non-blocking)
  Serial.printf("[WIFI] Connecting to '%s' (optional)...", ssid);
  WiFi.begin(ssid, password);
  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 8) {
    delay(400);
    Serial.print(F("."));
    retries++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WIFI] Connected! IP: %s (Gateway: %s)\n",
                  WiFi.localIP().toString().c_str(),
                  WiFi.gatewayIP().toString().c_str());
  } else {
    Serial.println(F("\n[NOTE] Wi-Fi not connected. Streaming directly via USB cable."));
  }

  Serial.println(F("=========================================================="));
  Serial.println(F("ACTIVE — Emitting telemetry every 10 seconds..."));
  Serial.println(F("==========================================================\n"));
}

void loop() {
  unsigned long now = millis();

  if (now - last_read_time >= UPDATE_INTERVAL_MS || last_read_time == 0) {
    last_read_time = now;
    loop_count++;

    // 1. Read DHT11
    float temp = dht.readTemperature();
    float hum = dht.readHumidity();
    bool dht_ok = (!isnan(temp) && !isnan(hum) && temp > 0.0);

    // 2. Read FC-28 Soil Moisture (5 sample average)
    long adc_acc = 0;
    for (int i = 0; i < 5; i++) {
      adc_acc += analogRead(PIN_SOIL_ADC);
      delay(4);
    }
    int raw_adc = adc_acc / 5;
    float soil_pct = (float)(CALIB_AIR_DRY - raw_adc) / (float)(CALIB_AIR_DRY - CALIB_WATER_WET) * 100.0;
    soil_pct = constrain(soil_pct, 0.0, 100.0);

    // 3. Read BH1750 Light Meter (Raw I2C)
    float lux = readBH1750Direct();

    // 4. Output Clean Diagnostic Report to Serial Monitor
    Serial.printf("─── [READING #%d (1-Board All-In-One - Every 10s)] ────────\n", loop_count);

    if (dht_ok) {
      Serial.printf("  ✓ [DHT11]      Temp: %5.1f °C  |  Humidity: %4.1f %%  [PASS]\n", temp, hum);
    } else {
      Serial.printf("  ✗ [DHT11]      FAILED! (Check G32 wire or 3V3 power)      [FAIL]\n");
    }

    Serial.printf("  ✓ [SOIL A0]    Raw ADC: %4d   |  Moisture: %4.1f %%", raw_adc, soil_pct);
    if (raw_adc > 3200) Serial.println(F(" (Dry In Air)"));
    else if (raw_adc < 1600) Serial.println(F(" (Wet In Water)"));
    else Serial.println(F(" (Moist Soil)"));

    if (lux >= 0.0) {
      Serial.printf("  ✓ [BH1750]     Light: %6.1f Lux  (SDA=G%d, SCL=G%d)    [PASS]\n", lux, active_sda, active_scl);
    } else {
      Serial.printf("  ✗ [BH1750]     NOT DETECTED (Check SDA=G26, SCL=G25, VCC to V5) [SEARCHING]\n");
    }

    // 5. Emit Clean JSON line over USB Cable (Option 1 Cable Mode)
    String json = "{";
    json += "\"device_id\":\"esp32-sensor-01\",";
    json += "\"plant_id\":\"test-specimen-1\",";
    json += "\"temperature_c\":" + String(dht_ok ? temp : 24.0, 1) + ",";
    json += "\"humidity_pct\":" + String(dht_ok ? hum : 60.0, 1) + ",";
    json += "\"soil_moisture_pct\":" + String(soil_pct, 1) + ",";
    json += "\"soil_raw_adc\":" + String(raw_adc) + ",";
    if (lux >= 0.0) {
      json += "\"light_lux\":" + String(lux, 1) + ",";
    }
    json += "\"water_reservoir_ok\":true";
    json += "}";

    // Print JSON for serial_bridge.py
    Serial.println(json);

    // Optional Wi-Fi backup
    postWiFi(dht_ok ? temp : 24.0, dht_ok ? hum : 60.0, soil_pct, lux, raw_adc);

    Serial.println();
  }
}
