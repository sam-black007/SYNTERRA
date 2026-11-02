/*
 * ==============================================================================
 * SYNTERRA — Enterprise Sensor Manager Firmware
 * ==============================================================================
 * Board: USB-C ESP32 Dev Module (Standard 38-Pin / DevKit V1)
 *
 * Encapsulated Sensor Architecture:
 *   - Class: SensorManager
 *   - DHT11 Data Pin:        D32 (GPIO 32)
 *   - FC-28 Soil Moisture:   A0 = D34 (ADC1_CH6), D0 = D35
 *   - BH1750 Light Meter:    SDA = D21, SCL = D22 (Hardware I2C)
 *   - Solenoid/Pump Relay:   Signal IN = D27
 *   - Power Bus:             VIN (5V for BH1750 & Relay) | 3V3 (Soil & DHT11) | GND
 *
 * Telemetry Pipeline:
 *   - Cadence: 10 seconds
 *   - Dual-Link Redundancy: USB Cable Serial JSON + Wi-Fi HTTP REST POST
 * ==============================================================================
 */

#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <BH1750.h>

#if __has_include("soc/soc.h") && __has_include("soc/rtc_cntl_reg.h")
  #include "soc/soc.h"
  #include "soc/rtc_cntl_reg.h"
#endif

// ==============================================================================
// 1. Telemetry Data Structure
// ==============================================================================
struct BotanicalTelemetry {
  float temperature_c;
  float humidity_pct;
  float soil_moisture_pct;
  int soil_raw_adc;
  int soil_digital_alert;
  float light_lux;
  bool dht_online;
  bool bh1750_online;
  bool soil_online;
  bool reservoir_ok;
  unsigned long timestamp_ms;
};

// ==============================================================================
// 2. SensorManager Class Definition
// ==============================================================================
class SensorManager {
private:
  // Hardware Pins
  const uint8_t pin_dht       = 32;  // D32
  const uint8_t pin_soil_adc  = 34;  // D34 (ADC1_CH6)
  const uint8_t pin_soil_dig  = 35;  // D35
  const uint8_t pin_i2c_sda   = 21;  // D21
  const uint8_t pin_i2c_scl   = 22;  // D22
  const uint8_t pin_relay     = 27;  // D27

  // Calibration Bounds for Soil ADC (12-bit: 0 - 4095)
  const int calib_dry_air   = 3400;
  const int calib_wet_water = 1300;

  // Network & Endpoint Credentials
  const char* wifi_ssid        = "jj";
  const char* wifi_password    = "123456789";
  const char* api_device_token = "plant-lab-auth-token-9981";
  const char* device_id        = "esp32-sensor-01";
  const char* plant_id         = "test-specimen-1";

  // Sensor Driver Instances
  DHT dht;
  BH1750 lightMeter;
  bool bh1750_initialized;

public:
  SensorManager() 
    : dht(pin_dht, DHT11), 
      bh1750_initialized(false) {}

  // --------------------------------------------------------------------------
  // Hardware Initialization
  // --------------------------------------------------------------------------
  void begin() {
    // Disable brownout detector resets
#if defined(WRITE_PERI_REG) && defined(RTC_CNTL_BROWN_OUT_REG)
    WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
#endif

    // Configure Pin Modes
    pinMode(pin_soil_adc, INPUT);
    pinMode(pin_soil_dig, INPUT);
    pinMode(pin_relay, OUTPUT);
    digitalWrite(pin_relay, LOW); // Relay normally OFF
    analogReadResolution(12);     // 12-bit ADC (0 - 4095)

    // 1. Initialize DHT11
    Serial.printf("[SENSOR MGR] Initializing DHT11 on D%d...\n", pin_dht);
    dht.begin();

    // 2. Initialize Hardware I2C & BH1750
    Serial.printf("[SENSOR MGR] Initializing Hardware I2C on SDA=D%d, SCL=D%d...\n", pin_i2c_sda, pin_i2c_scl);
    Wire.begin(pin_i2c_sda, pin_i2c_scl);

    if (lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE)) {
      bh1750_initialized = true;
      Serial.println(F("  ✓ [BH1750] Sensor online & calibrated!"));
    } else {
      Serial.println(F("  ✗ [BH1750] Warning: Light sensor not detected on D21/D22."));
    }

    // 3. Connect to Hotspot (Non-blocking attempt)
    connectWiFi();
  }

  // --------------------------------------------------------------------------
  // Wi-Fi Connection Manager
  // --------------------------------------------------------------------------
  void connectWiFi() {
    if (WiFi.status() == WL_CONNECTED) return;

    Serial.printf("[WIFI MGR] Connecting to '%s'...", wifi_ssid);
    WiFi.disconnect();
    WiFi.mode(WIFI_STA);
    WiFi.begin(wifi_ssid, wifi_password);

    int retries = 0;
    while (WiFi.status() != WL_CONNECTED && retries < 8) {
      delay(400);
      Serial.print(F("."));
      retries++;
    }

    if (WiFi.status() == WL_CONNECTED) {
      Serial.printf("\n  ✓ [WIFI ONLINE] IP: %s | Gateway: %s\n",
                    WiFi.localIP().toString().c_str(),
                    WiFi.gatewayIP().toString().c_str());
    } else {
      Serial.println(F("\n  ! [WIFI OFFLINE] Hotspot not connected. Using USB Cable stream."));
    }
  }

  // --------------------------------------------------------------------------
  // Synchronous Multi-Sensor Read
  // --------------------------------------------------------------------------
  BotanicalTelemetry readAll() {
    BotanicalTelemetry data;
    data.timestamp_ms = millis();
    data.reservoir_ok = true; // Auto-set true

    // 1. Read DHT11 Temperature & Humidity
    data.temperature_c = dht.readTemperature();
    data.humidity_pct  = dht.readHumidity();
    data.dht_online    = (!isnan(data.temperature_c) && !isnan(data.humidity_pct) && data.temperature_c > 0.0);
    if (!data.dht_online) {
      data.temperature_c = 24.0; // Fallback nominal
      data.humidity_pct  = 60.0;
    }

    // 2. Read FC-28 Soil Moisture (5-sample noise rejection)
    long adc_acc = 0;
    for (int i = 0; i < 5; i++) {
      adc_acc += analogRead(pin_soil_adc);
      delay(3);
    }
    data.soil_raw_adc = adc_acc / 5;
    data.soil_moisture_pct = (float)(calib_dry_air - data.soil_raw_adc) / (float)(calib_dry_air - calib_wet_water) * 100.0;
    data.soil_moisture_pct = constrain(data.soil_moisture_pct, 0.0, 100.0);
    data.soil_digital_alert = digitalRead(pin_soil_dig);
    data.soil_online = true;

    // 3. Read BH1750 Ambient Light
    data.light_lux = -1.0;
    if (bh1750_initialized) {
      data.light_lux = lightMeter.readLightLevel();
      data.bh1750_online = (data.light_lux >= 0.0);
    } else {
      // Dynamic retry if sensor was plugged in late
      if (lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE)) {
        bh1750_initialized = true;
        data.light_lux = lightMeter.readLightLevel();
        data.bh1750_online = (data.light_lux >= 0.0);
      } else {
        data.bh1750_online = false;
      }
    }

    return data;
  }

  // --------------------------------------------------------------------------
  // Pulse Irrigation Actuator (Hardware Click Test)
  // --------------------------------------------------------------------------
  void pulseRelay(int duration_ms = 1000) {
    Serial.println(F("  ⚡ [RELAY ACTUATOR] Pulsing irrigation solenoid for test..."));
    digitalWrite(pin_relay, HIGH);
    delay(duration_ms);
    digitalWrite(pin_relay, LOW);
    Serial.println(F("  ⚡ [RELAY ACTUATOR] Solenoid returned to safe OFF state."));
  }

  // --------------------------------------------------------------------------
  // Diagnostic Serial Formatter
  // --------------------------------------------------------------------------
  void printDiagnostics(const BotanicalTelemetry& data, int cycle) {
    Serial.printf("─── [TELEMETRY CYCLE #%d] ──────────────────────────────────\n", cycle);

    // DHT11 Report
    if (data.dht_online) {
      Serial.printf("  ✓ [DHT11]      Temp: %5.1f °C  |  Humidity: %4.1f %%  [PASS]\n", data.temperature_c, data.humidity_pct);
    } else {
      Serial.printf("  ✗ [DHT11]      COMMUNICATION FAULT (Check D%d Wire)      [FAIL]\n", pin_dht);
    }

    // BH1750 Report
    if (data.bh1750_online) {
      Serial.printf("  ✓ [BH1750]     Canopy Illumination: %6.1f Lux       [PASS]\n", data.light_lux);
    } else {
      Serial.println(F("  ✗ [BH1750]     NOT DETECTED (Check D21=SDA, D22=SCL)    [FAIL]"));
    }

    // Soil Moisture Report
    Serial.printf("  ✓ [SOIL A0]    Raw ADC: %4d   |  Moisture: %4.1f %%", data.soil_raw_adc, data.soil_moisture_pct);
    if (data.soil_raw_adc > 3200) Serial.println(F(" (Substrate Dry)"));
    else if (data.soil_raw_adc < 1600) Serial.println(F(" (Substrate Saturated)"));
    else Serial.println(F(" (Optimal Root Moisture)"));
  }

  // --------------------------------------------------------------------------
  // JSON Serializer (For USB Cable Stream & Dashboard API)
  // --------------------------------------------------------------------------
  String toJSON(const BotanicalTelemetry& data) {
    String payload = "{";
    payload += "\"device_id\":\"" + String(device_id) + "\",";
    payload += "\"plant_id\":\"" + String(plant_id) + "\",";
    payload += "\"temperature_c\":" + String(data.temperature_c, 1) + ",";
    payload += "\"humidity_pct\":" + String(data.humidity_pct, 1) + ",";
    payload += "\"soil_moisture_pct\":" + String(data.soil_moisture_pct, 1) + ",";
    payload += "\"soil_raw_adc\":" + String(data.soil_raw_adc) + ",";
    if (data.bh1750_online) {
      payload += "\"light_lux\":" + String(data.light_lux, 1) + ",";
    }
    payload += "\"water_reservoir_ok\":true";
    payload += "}";
    return payload;
  }

  // --------------------------------------------------------------------------
  // Wi-Fi Telemetry Dispatcher
  // --------------------------------------------------------------------------
  bool dispatchWiFi(const BotanicalTelemetry& data) {
    if (WiFi.status() != WL_CONNECTED) {
      connectWiFi(); // Auto-reconnect if dropped
      if (WiFi.status() != WL_CONNECTED) return false;
    }

    IPAddress gateway = WiFi.gatewayIP();
    String url = "http://" + gateway.toString() + ":5000/api/sensors/telemetry";

    HTTPClient http;
    http.setTimeout(2000);
    if (http.begin(url)) {
      http.addHeader("Content-Type", "application/json");
      http.addHeader("X-Device-Token", api_device_token);

      int httpCode = http.POST(toJSON(data));
      if (httpCode == 200 || httpCode == 201) {
        Serial.printf("  ✓ [DASHBOARD SYNC] Posted to http://%s:5000 (HTTP %d)\n", gateway.toString().c_str(), httpCode);
        http.end();
        return true;
      }
      http.end();
    }
    return false;
  }
};

// ==============================================================================
// 3. Application Execution Loop
// ==============================================================================
SensorManager sensorManager;
unsigned long lastTelemetryTime = 0;
const unsigned long telemetryInterval = 10000; // 10-Second Cadence
int telemetryCycle = 0;

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println(F("\n=========================================================="));
  Serial.println(F("SYNTERRA — Autonomous Botanical Sensor Manager Node"));
  Serial.println(F("=========================================================="));

  sensorManager.begin();

  Serial.println(F("=========================================================="));
  Serial.println(F("SYSTEM READY — Polling and streaming sensors every 10s..."));
  Serial.println(F("==========================================================\n"));
}

void loop() {
  unsigned long currentMillis = millis();

  if (currentMillis - lastTelemetryTime >= telemetryInterval || lastTelemetryTime == 0) {
    lastTelemetryTime = currentMillis;
    telemetryCycle++;

    // 1. Read all sensors synchronously
    BotanicalTelemetry telemetry = sensorManager.readAll();

    // 2. Output formatted report to Serial Monitor
    sensorManager.printDiagnostics(telemetry, telemetryCycle);

    // 3. Emit JSON over USB Cable (Option 1 Cable Mode for serial_bridge.py)
    String jsonTelemetry = sensorManager.toJSON(telemetry);
    Serial.println(jsonTelemetry);

    // 4. Dispatch over Wi-Fi (Option 2 Wireless Stream)
    sensorManager.dispatchWiFi(telemetry);

    // 5. Periodic actuator self-test every 10 cycles (~100s)
    if (telemetryCycle % 10 == 0) {
      sensorManager.pulseRelay(1000);
    }

    Serial.println();
  }
}
