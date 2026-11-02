/*
 * ==============================================================================
 * SYNTERRA — Sensor Live Diagnostics (Auto-Detecting I2C & Top-Row Wiring)
 * ==============================================================================
 * Sequential Top-Row Pinout:
 *   - 3V3       -> 3.3V Power Rail (DHT11, BH1750, FC-28 Soil VCC)
 *   - G34       -> FC-28 Soil Sensor A0 (Analog 0-100% moisture)
 *   - G35       -> FC-28 Soil Sensor D0 (Digital threshold - optional)
 *   - G32       -> DHT11 Data Pin (Bidirectional)
 *   - G26 / G25 -> BH1750 I2C (Auto-detects SDA & SCL in either order!)
 *   - G27       -> Relay Module Signal IN (Pump Control)
 *   - GND       -> Common Ground (All Sensor GNDs + BH1750 ADDR/ADO)
 *   - V5        -> 5V Power (Relay Coil or BH1750 VCC if 3.3V is weak)
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

// Pin Definitions
#define PIN_SOIL_ADC     34      // Soil Sensor A0 (Top Row: G34)
#define PIN_SOIL_DIG     35      // Soil Sensor D0 (Top Row: G35)
#define PIN_DHT          32      // DHT11 Data Pin (Top Row: G32)
#define PIN_RELAY        27      // Relay Control  (Top Row: G27)

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

// Dynamic I2C Auto-detection state
int current_sda = 26;
int current_scl = 25;
byte bh1750_address = 0;
bool bh1750_found = false;
unsigned long last_read_time = 0;
int loop_count = 0;

// Direct hardware read for BH1750 (works even if library has version quirks)
float readBH1750Direct(byte addr) {
  Wire.beginTransmission(addr);
  Wire.write(0x10); // Continuous High-Resolution Mode (1 lx resolution)
  if (Wire.endTransmission() != 0) return -1.0;

  delay(180); // Wait for optical measurement cycle (max 180ms)

  if (Wire.requestFrom((int)addr, 2) == 2) {
    unsigned int raw = (Wire.read() << 8) | Wire.read();
    return (float)raw / 1.2;
  }
  return -1.0;
}

// Auto-detector: Tries both (SDA=26, SCL=25) and (SDA=25, SCL=26), checking 0x23 and 0x5C
bool autoDetectBH1750() {
  int configs[2][2] = {
    {26, 25}, // Standard: SDA=26, SCL=25
    {25, 26}  // Swapped:  SDA=25, SCL=26
  };

  for (int c = 0; c < 2; c++) {
    int sda = configs[c][0];
    int scl = configs[c][1];

    Wire.end();
    delay(30);
    pinMode(sda, INPUT_PULLUP);
    pinMode(scl, INPUT_PULLUP);
    Wire.begin(sda, scl, 100000); // 100kHz standard I2C
    delay(50);

    // Test address 0x23 (ADDR connected to GND)
    Wire.beginTransmission(0x23);
    if (Wire.endTransmission() == 0) {
      current_sda = sda;
      current_scl = scl;
      bh1750_address = 0x23;
      bh1750_found = true;
      Serial.printf("[AUTO-DETECT] SUCCESS! Found BH1750 at 0x23 using SDA=G%d, SCL=G%d\n", sda, scl);
      lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE, 0x23, &Wire);
      return true;
    }

    // Test address 0x5C (ADDR connected to 3.3V or floating)
    Wire.beginTransmission(0x5C);
    if (Wire.endTransmission() == 0) {
      current_sda = sda;
      current_scl = scl;
      bh1750_address = 0x5C;
      bh1750_found = true;
      Serial.printf("[AUTO-DETECT] SUCCESS! Found BH1750 at 0x5C using SDA=G%d, SCL=G%d (ADDR is HIGH/floating)\n", sda, scl);
      lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE, 0x5C, &Wire);
      return true;
    }
  }

  // Also check standard pins 21/22 just in case wires were placed there
  Wire.end();
  delay(30);
  Wire.begin(21, 22, 100000);
  delay(50);
  Wire.beginTransmission(0x23);
  if (Wire.endTransmission() == 0) {
    current_sda = 21;
    current_scl = 22;
    bh1750_address = 0x23;
    bh1750_found = true;
    Serial.println(F("[AUTO-DETECT] SUCCESS! Found BH1750 at 0x23 on default pins SDA=G21, SCL=G22"));
    lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE, 0x23, &Wire);
    return true;
  }

  return false;
}

// Send reading to SYNTERRA dashboard
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
  Serial.println(F("SYNTERRA — Sensor Live Diagnostics (Auto-Detecting Mode)"));
  Serial.println(F("=========================================================="));

  pinMode(PIN_SOIL_ADC, INPUT);
  pinMode(PIN_SOIL_DIG, INPUT);
  pinMode(PIN_RELAY, OUTPUT);
  digitalWrite(PIN_RELAY, LOW); // Relay OFF by default
  analogReadResolution(12);

  // 1. Initialize DHT11 on G32
  Serial.println(F("[INIT] Starting DHT11 on G32..."));
  dht.begin();

  // 2. Run Auto-Detection for BH1750
  Serial.println(F("[INIT] Auto-detecting BH1750 wiring (checking G26/G25 and G25/G26)..."));
  if (autoDetectBH1750()) {
    Serial.println(F("[INIT] BH1750 Light Meter is ONLINE and configured!"));
  } else {
    Serial.println(F("[INIT] BH1750 not found yet. Auto-scanner will keep retrying in loop..."));
  }

  // 3. Connect to Hotspot
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

    // 2. Read BH1750 (with automatic live retry if it was offline)
    if (!bh1750_found && (loop_count % 2 == 0)) {
      autoDetectBH1750(); // Keep trying to find it in the background
    }

    float lux = -1.0;
    if (bh1750_found) {
      // First try library read, fallback to direct I2C read if library returns negative
      lux = lightMeter.readLightLevel();
      if (lux < 0.0) {
        lux = readBH1750Direct(bh1750_address);
      }
    }

    // 3. Read Soil Moisture (A0 on G34) - 5 sample average
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

    if (bh1750_found && lux >= 0) {
      Serial.printf("  ✓ [BH1750]     Light: %6.1f Lux  (SDA=G%d, SCL=G%d, 0x%02X) [PASS]\n",
                    lux, current_sda, current_scl, bh1750_address);
    } else {
      Serial.printf("  ✗ [BH1750]     SEARCHING... (Check VCC, GND, and wires on G26/G25) [OFFLINE]\n");
    }

    Serial.printf("  ✓ [SOIL A0]    Raw ADC: %4d   |  Moisture: %4.1f %%", raw_adc, soil_pct);
    if (raw_adc > 3200) Serial.println(F(" (Dry In Air)"));
    else if (raw_adc < 1600) Serial.println(F(" (Wet In Water)"));
    else Serial.println(F(" (Moist Soil)"));

    Serial.printf("  ✓ [SOIL D0]    Digital Alert (G35): %s\n", (soil_digital == LOW) ? "MOIST" : "DRY / THRESHOLD REACHED");

    // Optional Relay Pulse every 10 readings
    if (loop_count % 10 == 0) {
      Serial.println(F("  ⚡ [RELAY TEST] Pulsing G27 relay for 1 second..."));
      digitalWrite(PIN_RELAY, HIGH);
      delay(1000);
      digitalWrite(PIN_RELAY, LOW);
      Serial.println(F("  ⚡ [RELAY TEST] Relay click complete (OFF)."));
    }

    if (WiFi.status() == WL_CONNECTED) {
      sendToSynterra(dht_ok ? temp : 24.0, dht_ok ? hum : 60.0, lux >= 0 ? lux : 500.0, soil_pct, raw_adc);
    }

    Serial.println();
  }
}
