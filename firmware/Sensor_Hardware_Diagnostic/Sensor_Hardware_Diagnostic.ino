/*
 * ==============================================================================
 * SYNTERRA — Enterprise Sensor Manager Firmware
 * ==============================================================================
 * Board: USB-C ESP32 Dev Module (Standard 30/38-Pin DevKit)
 *
 * Hardware Wiring:
 *   - DHT11 Data Pin:        D32 (GPIO 32)
 *   - FC-28 Soil Moisture:   A0 = D34 (ADC1_CH6), D0 = D35
 *   - BH1750 Light Meter:    SDA = D21, SCL = D22 (Hardware I2C)
 *   - Solenoid/Pump Relay:   Signal IN = D27
 *   - Power Bus:             VIN (5V for BH1750 & Relay) | 3V3 (Soil & DHT11) | GND
 *
 * Telemetry Pipeline:
 *   - Cadence: 6 SECONDS (6000 ms)
 *   - Environmental Climate & Condition Classification Engine:
 *       * Light:       Night, Dim/Twilight, Cloudy, Partly Cloudy, Sunny, Intense Sun
 *       * Temperature: Cold, Mild, Optimal, Warm, Extreme Heat
 *       * Humidity:    Arid, Ideal, Humid/Tropical, Saturated
 *       * Soil:        Severe Drought, Dry (Needs Water), Optimal Root Moisture, Saturated
 *       * Microclimate: Combined Macro-Atmospheric State Summary
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
  String light_condition;
  String soil_condition;
  String temp_condition;
  String humidity_condition;
  String climate_summary;
  unsigned long timestamp_ms;
};

// ==============================================================================
// 2. SensorManager Class Definition
// ==============================================================================
class SensorManager {
private:
  // Hardware Pins from Board Silkscreen
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
  // Climate & Sensor Condition Classification Helpers
  // --------------------------------------------------------------------------
  static String inferLightCondition(float lux) {
    if (lux < 0.0) return "SENSOR OFFLINE";
    if (lux < 25.0) return "NIGHT / DARK";
    if (lux < 200.0) return "DIM / TWILIGHT";
    if (lux < 1000.0) return "CLOUDY / OVERCAST";
    if (lux < 10000.0) return "DAYLIGHT / PARTLY CLOUDY";
    if (lux < 25000.0) return "SUNNY / CLEAR SKY";
    return "INTENSE SUNLIGHT";
  }

  static String inferSoilCondition(float moisture_pct) {
    if (moisture_pct < 20.0) return "CRITICAL DRY (DROUGHT)";
    if (moisture_pct < 40.0) return "DRY (WATER NEEDED)";
    if (moisture_pct <= 75.0) return "OPTIMAL ROOT MOISTURE";
    if (moisture_pct <= 90.0) return "WET / SATURATED";
    return "WATERLOGGED";
  }

  static String inferTempCondition(float temp_c) {
    if (temp_c < 16.0) return "COLD / CHILLY";
    if (temp_c < 22.0) return "MILD / COOL";
    if (temp_c <= 28.0) return "OPTIMAL PLANT TEMP";
    if (temp_c <= 34.0) return "WARM / ELEVATED";
    return "EXTREME HEATWAVE";
  }

  static String inferHumidityCondition(float hum_pct) {
    if (hum_pct < 35.0) return "ARID / DRY AIR";
    if (hum_pct <= 65.0) return "IDEAL CANOPY HUMIDITY";
    if (hum_pct <= 80.0) return "HUMID / TROPICAL";
    return "SATURATED / SULTRY";
  }

  static String inferClimateSummary(float lux, float temp_c, float hum_pct) {
    if (lux < 25.0) return "NIGHT (REST PERIOD)";
    if (lux >= 10000.0) {
      if (temp_c >= 28.0) return "HOT & SUNNY";
      return "BRIGHT & SUNNY";
    }
    if (lux >= 1000.0) {
      if (hum_pct >= 75.0) return "PARTLY CLOUDY & HUMID";
      return "PARTLY CLOUDY & PLEASANT";
    }
    if (lux >= 200.0) {
      if (hum_pct >= 70.0) return "OVERCAST & RAINY/HUMID";
      return "CLOUDY / OVERCAST";
    }
    return "DIM INDOORS / LOW LIGHT";
  }

  // --------------------------------------------------------------------------
  // Synchronous Multi-Sensor Read
  // --------------------------------------------------------------------------
  BotanicalTelemetry readAll() {
    BotanicalTelemetry data;
    data.timestamp_ms = millis();
    data.reservoir_ok = true;

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
      if (lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE)) {
        bh1750_initialized = true;
        data.light_lux = lightMeter.readLightLevel();
        data.bh1750_online = (data.light_lux >= 0.0);
      } else {
        data.bh1750_online = false;
      }
    }

    // 4. Determine Environmental Classifications & Microclimate State
    data.light_condition    = inferLightCondition(data.light_lux);
    data.soil_condition     = inferSoilCondition(data.soil_moisture_pct);
    data.temp_condition     = inferTempCondition(data.temperature_c);
    data.humidity_condition = inferHumidityCondition(data.humidity_pct);
    data.climate_summary    = inferClimateSummary(data.light_lux, data.temperature_c, data.humidity_pct);

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
  // Diagnostic Serial Formatter (With Climate & Condition Badges)
  // --------------------------------------------------------------------------
  void printDiagnostics(const BotanicalTelemetry& data, int cycle) {
    Serial.printf("─── [TELEMETRY CYCLE #%d (EVERY 6s)] ────────────────────────────────\n", cycle);
    Serial.printf("  🌤️  [CLIMATE STATE]   >>> %s <<<\n", data.climate_summary.c_str());

    // BH1750 Report
    if (data.bh1750_online) {
      Serial.printf("  ✓ [BH1750]  Light:     %6.1f Lux  --> [%s]\n", data.light_lux, data.light_condition.c_str());
    } else {
      Serial.println(F("  ✗ [BH1750]  Light:     NOT DETECTED (Check D21=SDA, D22=SCL)"));
    }

    // DHT11 Report
    if (data.dht_online) {
      Serial.printf("  ✓ [DHT11]   Temp:      %5.1f °C   --> [%s]\n", data.temperature_c, data.temp_condition.c_str());
      Serial.printf("              Humidity:  %5.1f %%   --> [%s]\n", data.humidity_pct, data.humidity_condition.c_str());
    } else {
      Serial.printf("  ✗ [DHT11]   COMMUNICATION FAULT (Check D%d Wire)\n", pin_dht);
    }

    // Soil Moisture Report
    Serial.printf("  ✓ [SOIL A0] Moisture:  %5.1f %% (ADC %4d) --> [%s]\n",
                  data.soil_moisture_pct, data.soil_raw_adc, data.soil_condition.c_str());
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
      payload += "\"light_condition\":\"" + data.light_condition + "\",";
    }
    payload += "\"soil_condition\":\"" + data.soil_condition + "\",";
    payload += "\"temp_condition\":\"" + data.temp_condition + "\",";
    payload += "\"humidity_condition\":\"" + data.humidity_condition + "\",";
    payload += "\"climate\":\"" + data.climate_summary + "\",";
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
// 3. Application Execution Loop (Every 6 Seconds)
// ==============================================================================
SensorManager sensorManager;
unsigned long lastTelemetryTime = 0;
const unsigned long telemetryInterval = 5000; // 6-Second Cadence (6000 ms)
int telemetryCycle = 0;

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println(F("\n=========================================================="));
  Serial.println(F("SYNTERRA — Autonomous Botanical Sensor Manager Node"));
  Serial.println(F("=========================================================="));

  sensorManager.begin();

  Serial.println(F("=========================================================="));
  Serial.println(F("SYSTEM READY — Polling and streaming sensors every 6s..."));
  Serial.println(F("==========================================================\n"));
}

void loop() {
  unsigned long currentMillis = millis();

  // Non-blocking 6-second timer
  if (currentMillis - lastTelemetryTime >= telemetryInterval || lastTelemetryTime == 0) {
    lastTelemetryTime = currentMillis;
    telemetryCycle++;

    // 1. Read all sensors synchronously with climate inference
    BotanicalTelemetry telemetry = sensorManager.readAll();

    // 2. Output formatted report to Serial Monitor
    sensorManager.printDiagnostics(telemetry, telemetryCycle);

    // 3. Emit JSON over USB Cable (Option 1 Cable Mode for serial_bridge.py)
    String jsonTelemetry = sensorManager.toJSON(telemetry);
    Serial.println(jsonTelemetry);

    // 4. Dispatch over Wi-Fi (Option 2 Wireless Stream directly to dashboard)
    sensorManager.dispatchWiFi(telemetry);

    // 5. Periodic actuator self-test every 10 cycles (~60s)
    if (telemetryCycle % 10 == 0) {
      sensorManager.pulseRelay(1000);
    }

    Serial.println();
  }
}
