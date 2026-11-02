/*
 * ==============================================================================
 * SYNTERRA — Board 1: Soil Moisture & Microclimate Telemetry Node
 * ==============================================================================
 * Hardware Pinout (Top 3V3 Row Only):
 *   - DHT11 Data:    G32
 *   - FC-28 Soil A0: G34 (Analog 0-100% moisture)
 *   - FC-28 Soil D0: G35 (Digital dry/moist alert)
 *   - Relay IN:      G27 (Water pump trigger)
 *   - Power:         3V3 & GND (Top Row) | V5 for Relay
 * ==============================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>

#if __has_include("soc/soc.h") && __has_include("soc/rtc_cntl_reg.h")
  #include "soc/soc.h"
  #include "soc/rtc_cntl_reg.h"
#endif

#define TELEMETRY_INTERVAL_MS 20000   // Updates every 20 seconds

#define PIN_SOIL_ADC     34           // Soil Sensor A0 (Analog)
#define PIN_SOIL_DIG     35           // Soil Sensor D0 (Digital)
#define PIN_DHT          32           // DHT11 Data Pin
#define PIN_RELAY        27           // Pump Relay Control
#define DHTTYPE          DHT11

// Soil ADC calibration range
const int CALIB_AIR_DRY   = 3400;     // Sensor dry in air
const int CALIB_WATER_WET = 1300;     // Sensor in water

// Hotspot Credentials
const char* ssid = "jj";
const char* password = "123456789";
const char* device_token = "plant-lab-auth-token-9981";

DHT dht(PIN_DHT, DHTTYPE);
unsigned long last_read_time = 0;
int loop_count = 0;

void ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.printf("[WIFI] Connecting to hotspot '%s'...", ssid);
  WiFi.disconnect();
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 25) {
    delay(400);
    Serial.print(F("."));
    retries++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WIFI] Connected! ESP32 IP: %s (Gateway: %s)\n",
                  WiFi.localIP().toString().c_str(),
                  WiFi.gatewayIP().toString().c_str());
  } else {
    Serial.println(F("\n[WIFI WARNING] Not connected! Make sure Windows Mobile Hotspot 'jj' is ON."));
  }
}

// Post telemetry directly to SYNTERRA dashboard
bool sendToSynterra(float temp, float hum, float soil_pct, int raw_adc) {
  ensureWiFi();
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(F("  ✗ [DASHBOARD SYNC] Skipped (Wi-Fi not connected)"));
    return false;
  }

  IPAddress gateway = WiFi.gatewayIP();
  String url = "http://" + gateway.toString() + ":5000/api/sensors/telemetry";

  HTTPClient http;
  http.setTimeout(2500);
  if (http.begin(url)) {
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-Token", device_token);

    String payload = "{";
    payload += "\"device_id\":\"esp32-soil-dht\",";
    payload += "\"plant_id\":\"test-specimen-1\",";
    payload += "\"temperature_c\":" + String(temp, 1) + ",";
    payload += "\"humidity_pct\":" + String(hum, 1) + ",";
    payload += "\"soil_moisture_pct\":" + String(soil_pct, 1) + ",";
    payload += "\"soil_raw_adc\":" + String(raw_adc) + ",";
    payload += "\"water_reservoir_ok\":true";
    payload += "}";

    int code = http.POST(payload);
    if (code == 200 || code == 201) {
      Serial.printf("  ✓ [DASHBOARD SYNC] SUCCESS! Telemetry posted to http://%s:5000 (HTTP %d)\n", gateway.toString().c_str(), code);
      http.end();
      return true;
    } else {
      Serial.printf("  ✗ [DASHBOARD SYNC] HTTP Error code: %d\n", code);
    }
    http.end();
  }
  return false;
}

void setup() {
#if defined(WRITE_PERI_REG) && defined(RTC_CNTL_BROWN_OUT_REG)
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
#endif

  Serial.begin(115200);
  delay(1200);

  Serial.println(F("\n=========================================================="));
  Serial.println(F("SYNTERRA — Board 1: Soil Moisture & DHT11 Node (20s)"));
  Serial.println(F("=========================================================="));

  pinMode(PIN_SOIL_ADC, INPUT);
  pinMode(PIN_SOIL_DIG, INPUT);
  pinMode(PIN_RELAY, OUTPUT);
  digitalWrite(PIN_RELAY, LOW);
  analogReadResolution(12);

  // Initialize DHT11
  Serial.println(F("[INIT] Starting DHT11 on G32..."));
  dht.begin();

  // Connect Wi-Fi
  ensureWiFi();

  Serial.println(F("=========================================================="));
  Serial.println(F("ACTIVE — Streaming Soil & DHT11 to dashboard every 20s..."));
  Serial.println(F("==========================================================\n"));
}

void loop() {
  unsigned long now = millis();

  if (now - last_read_time >= TELEMETRY_INTERVAL_MS || last_read_time == 0) {
    last_read_time = now;
    loop_count++;

    // 1. Read DHT11 on G32
    float temp = dht.readTemperature();
    float hum = dht.readHumidity();
    bool dht_ok = (!isnan(temp) && !isnan(hum) && temp > 0.0);

    // 2. Read Soil Moisture on G34
    long adc_acc = 0;
    for (int i = 0; i < 5; i++) {
      adc_acc += analogRead(PIN_SOIL_ADC);
      delay(4);
    }
    int raw_adc = adc_acc / 5;
    float soil_pct = (float)(CALIB_AIR_DRY - raw_adc) / (float)(CALIB_AIR_DRY - CALIB_WATER_WET) * 100.0;
    soil_pct = constrain(soil_pct, 0.0, 100.0);

    // 3. Read Soil Digital Trigger on G35
    int soil_digital = digitalRead(PIN_SOIL_DIG);

    // 4. Output to Serial Monitor
    Serial.printf("─── [READING #%d (Board 1 - Every 20s)] ───────────────────\n", loop_count);

    if (dht_ok) {
      Serial.printf("  ✓ [DHT11]      Temp: %5.1f °C  |  Humidity: %4.1f %%  [PASS]\n", temp, hum);
    } else {
      Serial.printf("  ✗ [DHT11]      FAILED! (Check G32 wire or 3V3 power)      [FAIL]\n");
    }

    Serial.printf("  ✓ [SOIL A0]    Raw ADC: %4d   |  Moisture: %4.1f %%", raw_adc, soil_pct);
    if (raw_adc > 3200) Serial.println(F(" (Dry In Air)"));
    else if (raw_adc < 1600) Serial.println(F(" (Wet In Water)"));
    else Serial.println(F(" (Moist Soil)"));

    Serial.printf("  ✓ [SOIL D0]    Digital Alert (G35): %s\n", (soil_digital == LOW) ? "MOIST" : "DRY / THRESHOLD REACHED");

    // Click relay test every 5 readings (~100s)
    if (loop_count % 5 == 0) {
      Serial.println(F("  ⚡ [RELAY TEST] Pulsing G27 relay for 1 second..."));
      digitalWrite(PIN_RELAY, HIGH);
      delay(1000);
      digitalWrite(PIN_RELAY, LOW);
      Serial.println(F("  ⚡ [RELAY TEST] Relay click complete (OFF)."));
    }

    // Direct USB Serial JSON Output (Read by scripts/serial_bridge.py for Option 1 Cable Mode)
    String jsonString = "{";
    jsonString += "\"device_id\":\"esp32-soil-dht\",";
    jsonString += "\"plant_id\":\"test-specimen-1\",";
    jsonString += "\"temperature_c\":" + String(dht_ok ? temp : 24.0, 1) + ",";
    jsonString += "\"humidity_pct\":" + String(dht_ok ? hum : 60.0, 1) + ",";
    jsonString += "\"soil_moisture_pct\":" + String(soil_pct, 1) + ",";
    jsonString += "\"soil_raw_adc\":" + String(raw_adc) + ",";
    jsonString += "\"water_reservoir_ok\":true";
    jsonString += "}";
    Serial.println(jsonString);

    // Optional Wi-Fi Post (if Wi-Fi is active)
    sendToSynterra(dht_ok ? temp : 24.0, dht_ok ? hum : 60.0, soil_pct, raw_adc);

    Serial.println();
  }
}
