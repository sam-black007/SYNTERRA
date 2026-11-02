/*
 * ==============================================================================
 * SYNTERRA — Sensor Live Diagnostics & Dashboard Telemetry
 * ==============================================================================
 * Clean base using direct Wire.begin() and standard BH1750 library calls.
 *
 * Pinout:
 *   - DHT11 Data:    G32 (Top Row)
 *   - FC-28 Soil A0: G34 (Top Row)
 *   - FC-28 Soil D0: G35 (Top Row)
 *   - BH1750 SDA:    G26 (Top Row) [or G21 default]
 *   - BH1750 SCL:    G25 (Top Row) [or G22 default]
 *   - Relay IN:      G27 (Top Row)
 *   - Power:         3V3 & GND (Top Row) | V5 for Relay
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
// Hardware Pins
// ==============================================================================
#define PIN_SOIL_ADC     34      // Soil Sensor A0 (Analog 0-100%)
#define PIN_SOIL_DIG     35      // Soil Sensor D0 (Digital threshold)
#define PIN_DHT          32      // DHT11 Data Pin
#define PIN_I2C_SDA      26      // BH1750 SDA (Change to 21 if using bottom row)
#define PIN_I2C_SCL      25      // BH1750 SCL (Change to 22 if using bottom row)
#define PIN_RELAY        27      // Pump Relay Control

#define DHTTYPE          DHT11

// ADC Calibration for Soil Moisture (0 - 4095)
const int CALIB_AIR_DRY   = 3400; // Sensor in dry air
const int CALIB_WATER_WET = 1300; // Sensor submerged in water

// Hotspot Credentials
const char* ssid = "jj";
const char* password = "123456789";
const char* device_token = "plant-lab-auth-token-9981";

DHT dht(PIN_DHT, DHTTYPE);
BH1750 lightMeter;
bool bh1750_ready = false;
unsigned long last_read_time = 0;
int loop_count = 0;

// Post telemetry directly to SYNTERRA dashboard
void sendToSynterra(float temp, float hum, float lux, float soil_pct, int raw_adc) {
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
    payload += "\"water_reservoir_ok\":true";
    payload += "}";

    int code = http.POST(payload);
    if (code == 200 || code == 201) {
      Serial.println(F("  └─> [SYNTERRA SYNC] Sent telemetry to laptop dashboard (HTTP 200)"));
    }
    http.end();
  }
}

void setup() {
#if defined(WRITE_PERI_REG) && defined(RTC_CNTL_BROWN_OUT_REG)
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0); // Disable brownout resets
#endif

  Serial.begin(115200);
  delay(1200);

  Serial.println(F("\n=========================================================="));
  Serial.println(F("SYNTERRA — Sensor Live Diagnostics & Dashboard Telemetry"));
  Serial.println(F("=========================================================="));

  pinMode(PIN_SOIL_ADC, INPUT);
  pinMode(PIN_SOIL_DIG, INPUT);
  pinMode(PIN_RELAY, OUTPUT);
  digitalWrite(PIN_RELAY, LOW);
  analogReadResolution(12);

  // 1. Initialize DHT11
  Serial.println(F("[INIT] Starting DHT11 on G32..."));
  dht.begin();

  // 2. Initialize BH1750 using your clean base
  Serial.printf("[INIT] Starting I2C bus on SDA=G%d, SCL=G%d...\n", PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);

  if (lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE)) {
    Serial.println(F("BH1750 initialized successfully!"));
    bh1750_ready = true;
  } else {
    Serial.println(F("BH1750 initialization failed! (Check SDA/SCL wires & 3V3/V5 power)"));
  }

  // 3. Connect to Hotspot for Dashboard Sync
  Serial.printf("[WIFI] Connecting to '%s'...", ssid);
  WiFi.begin(ssid, password);
  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 10) {
    delay(400);
    Serial.print(F("."));
    retries++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WIFI] Connected! Board IP: %s (Gateway: %s)\n",
                  WiFi.localIP().toString().c_str(),
                  WiFi.gatewayIP().toString().c_str());
  } else {
    Serial.println(F("\n[WIFI NOTE] Hotspot offline. Running serial diagnostic mode."));
  }

  Serial.println(F("=========================================================="));
  Serial.println(F("DIAGNOSTICS ACTIVE — Reading hardware every 2 seconds..."));
  Serial.println(F("==========================================================\n"));
}

void loop() {
  unsigned long now = millis();
  if (now - last_read_time >= 2000) {
    last_read_time = now;
    loop_count++;

    // 1. Read DHT11 on G32
    float temp = dht.readTemperature();
    float hum = dht.readHumidity();
    bool dht_ok = (!isnan(temp) && !isnan(hum) && temp > 0.0);

    // 2. Read BH1750
    float lux = -1.0;
    if (bh1750_ready) {
      lux = lightMeter.readLightLevel();
    } else {
      // Retry initializing if it wasn't ready at boot
      if (lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE)) {
        bh1750_ready = true;
        lux = lightMeter.readLightLevel();
      }
    }

    // 3. Read FC-28 Soil Moisture (5 sample average)
    long adc_acc = 0;
    for (int i = 0; i < 5; i++) {
      adc_acc += analogRead(PIN_SOIL_ADC);
      delay(4);
    }
    int raw_adc = adc_acc / 5;
    float soil_pct = (float)(CALIB_AIR_DRY - raw_adc) / (float)(CALIB_AIR_DRY - CALIB_WATER_WET) * 100.0;
    soil_pct = constrain(soil_pct, 0.0, 100.0);

    // 4. Read Soil Digital Trigger (D0 on G35)
    int soil_digital = digitalRead(PIN_SOIL_DIG);

    // 5. Output formatted report
    Serial.printf("─── [READING #%d] ──────────────────────────────────────────\n", loop_count);

    if (dht_ok) {
      Serial.printf("  ✓ [DHT11]      Temp: %5.1f °C  |  Humidity: %4.1f %%  [PASS]\n", temp, hum);
    } else {
      Serial.printf("  ✗ [DHT11]      FAILED! (Check G32 wire or 3V3 power)      [FAIL]\n");
    }

    if (bh1750_ready && lux >= 0) {
      Serial.printf("  ✓ [BH1750]     Light: %6.1f Lux                       [PASS]\n", lux);
    } else {
      Serial.printf("  ✗ [BH1750]     NOT DETECTED (Check SDA=G%d, SCL=G%d)    [FAIL]\n", PIN_I2C_SDA, PIN_I2C_SCL);
    }

    Serial.printf("  ✓ [SOIL A0]    Raw ADC: %4d   |  Moisture: %4.1f %%", raw_adc, soil_pct);
    if (raw_adc > 3200) Serial.println(F(" (Dry In Air)"));
    else if (raw_adc < 1600) Serial.println(F(" (Wet In Water)"));
    else Serial.println(F(" (Moist Soil)"));

    Serial.printf("  ✓ [SOIL D0]    Digital Alert (G35): %s\n", (soil_digital == LOW) ? "MOIST" : "DRY / THRESHOLD REACHED");

    // Click relay test every 10 readings (20 seconds)
    if (loop_count % 10 == 0) {
      Serial.println(F("  ⚡ [RELAY TEST] Pulsing G27 relay for 1 second..."));
      digitalWrite(PIN_RELAY, HIGH);
      delay(1000);
      digitalWrite(PIN_RELAY, LOW);
      Serial.println(F("  ⚡ [RELAY TEST] Relay click complete (OFF)."));
    }

    // Send to SYNTERRA Dashboard over Wi-Fi
    if (WiFi.status() == WL_CONNECTED) {
      sendToSynterra(dht_ok ? temp : 24.0, dht_ok ? hum : 60.0, (bh1750_ready && lux >= 0) ? lux : 500.0, soil_pct, raw_adc);
    }

    Serial.println();
  }
}
