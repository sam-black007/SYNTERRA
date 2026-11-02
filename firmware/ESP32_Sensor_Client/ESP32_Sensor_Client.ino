/*
 * ==============================================================================
 * SYNTERRA — Autonomous Agricultural Intelligence
 * ESP32-S3 Sensor Client Firmware
 * ==============================================================================
 *
 * Microcontroller: ESP32-S3 (WROOM / DevKitC-1)
 *
 * Hardware Pinout:
 *   - DHT11 Temp/Humidity:  GPIO 2
 *   - BH1750 Ambient Light: I2C (SDA = GPIO 4, SCL = GPIO 5)
 *   - FC-28 Soil Moisture:  Analog Out (AO) = GPIO 1 (ADC1 CH0)
 *                           Digital Out (DO) = GPIO 40
 *   - Water Reservoir Level: GPIO 41 (Pulled-up switch; LOW = Empty, HIGH = OK)
 *
 * Output:
 *   - Emits structured JSON strings over USB Serial (115200 baud) every 10 seconds.
 *   - Compatible with scripts/serial_bridge.py -> SYNTERRA Backend API.
 *
 * Required Arduino Libraries:
 *   - "DHT sensor library" by Adafruit (v1.4.6+)
 *   - "Adafruit Unified Sensor" by Adafruit
 *   - "BH1750" by Christopher Laws (v1.3.0+)
 *   - "ArduinoJson" by Benoit Blanchon (v6.x or v7.x)
 * ==============================================================================
 */

#include <Arduino.h>
#include <Wire.h>
#include <DHT.h>
#include <BH1750.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <HTTPClient.h>

#if __has_include("soc/soc.h") && __has_include("soc/rtc_cntl_reg.h")
  #include "soc/soc.h"
  #include "soc/rtc_cntl_reg.h"
#endif

// ==============================================================================
// Configuration & Flags
// ==============================================================================
#define DEVICE_ID           "esp32-sensor-01"
#define PLANT_ID            "specimen-alpha"
#define TELEMETRY_INTERVAL_MS 10000     // 10 seconds
#define SERIAL_BAUD_RATE    115200

// Set to true to emit realistic synthetic botanical readings (for bench testing without sensors)
#define SIMULATION_MODE     false

// ==============================================================================
// Wireless Wi-Fi Telemetry Configuration (Over Hotspot or LAN)
// ==============================================================================
#define ENABLE_WIFI         true
const char* ssid = "jj";                              // Windows Mobile Hotspot
const char* password = "123456789";                   // 2.4 GHz Band
const char* device_token = "plant-lab-auth-token-9981";  // Matched to .env DEVICE_TOKEN
const char* fallback_server_ip = "192.168.137.10";

// ==============================================================================
// Pin Definitions (Auto-detects "ESP32 Dev Module" vs "ESP32-S3")
// ==============================================================================
#if defined(CONFIG_IDF_TARGET_ESP32S3)
  #define PIN_DHT             2        // DHT11 Data Pin
  #define PIN_I2C_SDA         4        // BH1750 I2C Data
  #define PIN_I2C_SCL         5        // BH1750 I2C Clock
  #define PIN_SOIL_ANALOG     1        // FC-28 Analog Out (ADC1 CH0)
  #define PIN_SOIL_DIGITAL    40
  #define PIN_WATER_RESERVOIR 41       // Water Level Switch (Internal Pullup)
  #define PIN_RELAY           42       // Pump Relay
#else
  // Standard "ESP32 Dev Module" 100% Sequential Top-Row (3V3 Row) Pinout:
  #define PIN_SOIL_ANALOG     34       // FC-28 Soil Moisture A0 (Top Row: G34 / ADC1_CH6)
  #define PIN_DHT             32       // DHT11 Data Pin (Top Row: G32 - Bidirectional)
  #define PIN_WATER_RESERVOIR 33       // Water Level Switch (Top Row: G33 with Pullup)
  #define PIN_I2C_SCL         25       // BH1750 I2C Clock (Top Row: G25)
  #define PIN_I2C_SDA         26       // BH1750 I2C Data (Top Row: G26)
  #define PIN_RELAY           27       // Solenoid / Pump Relay Control (Top Row: G27)
  #define PIN_SOIL_DIGITAL    35       // (Optional DO pin - G35)
#endif

// Calibration constants for FC-28 (12-bit ADC: 0 - 4095)
// In air (completely dry): ~3300 - 3600
// In water (completely submerged): ~1200 - 1500
const int SOIL_DRY_ADC = 3400;
const int SOIL_WET_ADC = 1300;

// ==============================================================================
// Global Sensor Instances
// ==============================================================================
DHT dht(PIN_DHT, DHTTYPE);
BH1750 lightMeter;

bool bh1750_available = false;
unsigned long last_telemetry_time = 0;

// Helper: Post telemetry wirelessly directly to SYNTERRA backend
void sendTelemetryOverWifi(const String& jsonPayload) {
  if (WiFi.status() != WL_CONNECTED) return;

  IPAddress gateway = WiFi.gatewayIP();
  String serverHosts[2] = {
    gateway.toString(),
    fallback_server_ip
  };

  for (int i = 0; i < 2; i++) {
    if (serverHosts[i].length() == 0 || serverHosts[i] == "0.0.0.0") continue;
    HTTPClient http;
    String url = "http://" + serverHosts[i] + ":5000/api/sensors/telemetry";
    http.setTimeout(1500);
    if (http.begin(url)) {
      http.addHeader("Content-Type", "application/json");
      http.addHeader("X-Device-Token", device_token);
      int code = http.POST(jsonPayload);
      if (code == 200 || code == 201) {
        http.end();
        return;
      }
      http.end();
    }
  }
}

// Simulation variables
float sim_temp = 24.5;
float sim_hum = 58.0;
float sim_soil = 64.0;
float sim_lux = 450.0;

// ==============================================================================
// Setup
// ==============================================================================
void setup() {
#if defined(WRITE_PERI_REG) && defined(RTC_CNTL_BROWN_OUT_REG)
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0); // Disable brownout resets
#endif
  Serial.begin(SERIAL_BAUD_RATE);
  delay(1500); // Allow USB CDC connection to stabilize

  Serial.println();
  Serial.println(F("{\"system\": \"SYNTERRA ESP32 Sensor Client\", \"status\": \"booting\"}"));

  if (!SIMULATION_MODE) {
    // 1. Initialize DHT11
    dht.begin();

    // 2. Initialize I2C for BH1750 (with 30ms bus timeout)
    Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
    Wire.setTimeOut(30);
    if (lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE)) {
      bh1750_available = true;
      Serial.println(F("{\"sensor\": \"BH1750\", \"status\": \"online\"}"));
    } else {
      Serial.println(F("{\"sensor\": \"BH1750\", \"status\": \"offline\", \"warning\": \"check I2C wiring\"}"));
    }

    // 3. Configure GPIOs
    pinMode(PIN_SOIL_ANALOG, INPUT);
    pinMode(PIN_SOIL_DIGITAL, INPUT);
    pinMode(PIN_WATER_RESERVOIR, INPUT_PULLUP);
    pinMode(PIN_RELAY, OUTPUT);
    digitalWrite(PIN_RELAY, LOW); // Relay OFF by default

    // ADC Resolution: ESP32 supports 12 bits (0 - 4095)
    analogReadResolution(12);
  } else {
    Serial.println(F("{\"mode\": \"SIMULATION_MODE_ENABLED\"}"));
  }

  // Wireless Wi-Fi initialization (connect to hotspot or local LAN)
  if (ENABLE_WIFI) {
    Serial.printf("[WIFI] Connecting to hotspot %s", ssid);
    WiFi.begin(ssid, password);
    int retries = 0;
    while (WiFi.status() != WL_CONNECTED && retries < 15) {
      delay(400);
      Serial.print(F("."));
      retries++;
    }
    if (WiFi.status() == WL_CONNECTED) {
      Serial.println();
      Serial.printf("[WIFI] CONNECTED! IP: %s | Gateway: %s\n",
                    WiFi.localIP().toString().c_str(),
                    WiFi.gatewayIP().toString().c_str());
    } else {
      Serial.println();
      Serial.println(F("[WIFI] Standalone mode (emitting to USB Serial)."));
    }
  }

  Serial.println(F("{\"system\": \"SYNTERRA ESP32-S3 Client\", \"status\": \"ready\"}"));
}

// ==============================================================================
// Measurement & Telemetry Emission
// ==============================================================================
void loop() {
  unsigned long now = millis();

  if (now - last_telemetry_time >= TELEMETRY_INTERVAL_MS || last_telemetry_time == 0) {
    last_telemetry_time = now;

    float temperature_c = 0.0;
    float humidity_pct = 0.0;
    float light_lux = 0.0;
    int soil_raw_adc = 0;
    float soil_moisture_pct = 0.0;
    bool water_reservoir_ok = true;

    if (SIMULATION_MODE) {
      // Simulate gradual ecological variations
      sim_temp += (random(-20, 21) / 100.0);
      sim_hum += (random(-30, 31) / 100.0);
      sim_soil += (random(-15, 16) / 100.0);
      sim_lux += random(-10, 11);

      temperature_c = constrain(sim_temp, 16.0, 36.0);
      humidity_pct = constrain(sim_hum, 35.0, 90.0);
      soil_moisture_pct = constrain(sim_soil, 20.0, 95.0);
      soil_raw_adc = map((int)soil_moisture_pct, 0, 100, SOIL_DRY_ADC, SOIL_WET_ADC);
      light_lux = constrain(sim_lux, 50.0, 10000.0);
      water_reservoir_ok = true;
    } else {
      // 1. Read DHT11
      temperature_c = dht.readTemperature();
      humidity_pct = dht.readHumidity();

      // Check if DHT read failed
      if (isnan(temperature_c) || isnan(humidity_pct)) {
        temperature_c = 0.0;
        humidity_pct = 0.0;
      }

      // 2. Read BH1750
      if (bh1750_available) {
        light_lux = lightMeter.readLightLevel();
        if (light_lux < 0) light_lux = 0.0;
      }

      // 3. Read FC-28 Soil Moisture
      // Multi-sample averaging (10 reads for noise reduction)
      long adc_accumulator = 0;
      for (int i = 0; i < 10; i++) {
        adc_accumulator += analogRead(PIN_SOIL_ANALOG);
        delay(5);
      }
      soil_raw_adc = adc_accumulator / 10;

      // Calculate percentage based on calibration curve
      float mapped_pct = (float)(SOIL_DRY_ADC - soil_raw_adc) / (float)(SOIL_DRY_ADC - SOIL_WET_ADC) * 100.0;
      soil_moisture_pct = constrain(mapped_pct, 0.0, 100.0);

      // 4. Read Water Reservoir float switch (LOW = dry / float dropped)
      water_reservoir_ok = (digitalRead(PIN_WATER_RESERVOIR) == HIGH);
    }

    // ==========================================================================
    // Construct and Emit JSON over Serial
    // ==========================================================================
    StaticJsonDocument<256> doc;
    doc["device_id"] = DEVICE_ID;
    doc["plant_id"] = PLANT_ID;
    doc["temperature_c"] = serialized(String(temperature_c, 1));
    doc["humidity_pct"] = serialized(String(humidity_pct, 1));
    doc["light_lux"] = serialized(String(light_lux, 1));
    doc["soil_moisture_pct"] = serialized(String(soil_moisture_pct, 1));
    doc["soil_raw_adc"] = soil_raw_adc;
    doc["water_reservoir_ok"] = water_reservoir_ok;

    String jsonString;
    serializeJson(doc, jsonString);
    Serial.println(jsonString); // Trailing newline delimiter for USB serial bridge

    // Wireless HTTP telemetry directly to SYNTERRA laptop server
    if (ENABLE_WIFI) {
      sendTelemetryOverWifi(jsonString);
    }
  }

  // Yield to background ESP32 tasks
  delay(50);
}
