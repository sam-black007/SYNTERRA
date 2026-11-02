
#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <BH1750.h>
#include <math.h>

// ============================================================
// SYNTERRA - AUTONOMOUS SENSOR TELEMETRY
// ESP32 DEVKIT V1
// ============================================================

// ---------------- CONFIGURATION ----------------

#define TELEMETRY_INTERVAL_MS 20000UL

#define PIN_SOIL_ADC 34
#define PIN_SOIL_DIG 35
#define PIN_DHT 32

#define I2C_SDA 21
#define I2C_SCL 22

#define DHTTYPE DHT11

#define BH1750_ADDRESS 0x23

// ---------------- SOIL CALIBRATION ----------------

const int CALIB_AIR_DRY = 3400;
const int CALIB_WATER_WET = 1300;

// ---------------- WIFI CREDENTIALS ----------------

const char* ssid = "jj";
const char* password = "123456789";

const char* device_token = "plant-lab-auth-token-9981";

const char* device_id = "esp32-sensor-01";
const char* plant_id = "test-specimen-1";

// ---------------- DASHBOARD ----------------

const char* dashboard_path =
  "/api/sensors/telemetry";

const int dashboard_port = 5000;

// ---------------- SENSOR OBJECTS ----------------

DHT dht(PIN_DHT, DHTTYPE);
BH1750 lightMeter;

// ---------------- GLOBAL VARIABLES ----------------

bool bh1750_ready = false;

unsigned long last_read_time = 0;

unsigned long last_wifi_attempt = 0;

int loop_count = 0;

// ============================================================
// INITIALIZE BH1750
// ============================================================

void initializeBH1750() {

  Serial.println("[INIT] Initializing BH1750...");

  Wire.begin(I2C_SDA, I2C_SCL);

  Wire.setClock(100000);

  delay(50);

  Wire.beginTransmission(BH1750_ADDRESS);

  byte error = Wire.endTransmission();

  if (error == 0) {

    bh1750_ready = lightMeter.begin(
      BH1750::CONTINUOUS_HIGH_RES_MODE,
      BH1750_ADDRESS,
      &Wire
    );

  } else {

    bh1750_ready = false;

  }

  if (bh1750_ready) {

    Serial.println(
      "[BH1750] Detected successfully at address 0x23"
    );

  } else {

    Serial.println(
      "[BH1750] Initialization failed"
    );

  }
}

// ============================================================
// READ BH1750
// ============================================================

float readLightSensor() {

  if (!bh1750_ready) {
    return NAN;
  }

  float lux = lightMeter.readLightLevel();

  if (!isfinite(lux) || lux < 0.0) {
    return NAN;
  }

  return lux;
}

// ============================================================
// READ DHT11
// ============================================================

bool readDHTSensor(float &temperature, float &humidity) {

  temperature = dht.readTemperature();

  humidity = dht.readHumidity();

  if (
    !isfinite(temperature) ||
    !isfinite(humidity) ||
    temperature <= 0.0 ||
    humidity < 0.0 ||
    humidity > 100.0
  ) {

    return false;

  }

  return true;
}

// ============================================================
// READ SOIL ANALOG SENSOR
// ============================================================

int readSoilADC() {

  long total = 0;

  for (int i = 0; i < 5; i++) {

    total += analogRead(PIN_SOIL_ADC);

    delay(5);

  }

  return total / 5;
}

// ============================================================
// CALCULATE SOIL MOISTURE
// ============================================================

float calculateSoilMoisture(int raw_adc) {

  float moisture =
    ((float)(CALIB_AIR_DRY - raw_adc) /
    (float)(CALIB_AIR_DRY - CALIB_WATER_WET))
    * 100.0;

  return constrain(moisture, 0.0, 100.0);
}

// ============================================================
// INITIALIZE WIFI
// ============================================================

void initializeWiFi() {

  Serial.printf(
    "[WIFI] Connecting to %s",
    ssid
  );

  WiFi.mode(WIFI_STA);

  WiFi.begin(ssid, password);

  unsigned long start = millis();

  while (
    WiFi.status() != WL_CONNECTED &&
    millis() - start < 10000
  ) {

    delay(500);

    Serial.print(".");

  }

  if (WiFi.status() == WL_CONNECTED) {

    Serial.println("\n[WIFI] Connected!");

    Serial.print("[WIFI] ESP32 IP: ");

    Serial.println(WiFi.localIP());

    Serial.print("[WIFI] Gateway: ");

    Serial.println(WiFi.gatewayIP());

  } else {

    Serial.println(
      "\n[WIFI] Connection failed. Serial mode active."
    );

  }

}

// ============================================================
// WIFI RECONNECTION
// ============================================================

void maintainWiFi() {

  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  if (millis() - last_wifi_attempt < 10000) {
    return;
  }

  last_wifi_attempt = millis();

  Serial.println("[WIFI] Attempting reconnection...");

  WiFi.disconnect();

  WiFi.begin(ssid, password);

}

// ============================================================
// SEND DATA TO SYNTERRA DASHBOARD
// ============================================================

void sendToSynterra(
  float temperature,
  float humidity,
  float lux,
  float soil_pct,
  int raw_adc
) {

  if (WiFi.status() != WL_CONNECTED) {

    Serial.println("[SYNC] WiFi unavailable.");

    return;

  }

  IPAddress gateway = WiFi.gatewayIP();

  String url =
    "http://" +
    gateway.toString() +
    ":" +
    String(dashboard_port) +
    String(dashboard_path);

  String payload = "{";

  payload += "\"device_id\":\"";
  payload += device_id;
  payload += "\",";

  payload += "\"plant_id\":\"";
  payload += plant_id;
  payload += "\",";

  payload += "\"temperature_c\":";

  payload += isfinite(temperature)
    ? String(temperature, 1)
    : "null";

  payload += ",\"humidity_pct\":";

  payload += isfinite(humidity)
    ? String(humidity, 1)
    : "null";

  payload += ",\"light_lux\":";

  payload += isfinite(lux)
    ? String(lux, 1)
    : "null";

  payload += ",\"soil_moisture_pct\":";
  payload += String(soil_pct, 1);

  payload += ",\"soil_raw_adc\":";
  payload += String(raw_adc);

  payload += ",\"water_reservoir_ok\":true";

  payload += "}";

  HTTPClient http;

  http.setTimeout(5000);

  if (!http.begin(url)) {

    Serial.println("[SYNC] HTTP initialization failed.");

    return;

  }

  http.addHeader(
    "Content-Type",
    "application/json"
  );

  http.addHeader(
    "X-Device-Token",
    device_token
  );

  Serial.println("[SYNC] Sending telemetry...");

  int response = http.POST(payload);

  if (response > 0) {

    Serial.printf(
      "[SYNC] HTTP Response: %d\n",
      response
    );

    if (response >= 200 && response < 300) {

      Serial.println(
        "[SYNC] Dashboard synchronization successful."
      );

    } else {

      Serial.println(
        "[SYNC] Dashboard returned an error."
      );

      String responseBody = http.getString();

      Serial.println(responseBody);

    }

  } else {

    Serial.printf(
      "[SYNC] Request failed: %s\n",
      http.errorToString(response).c_str()
    );

  }

  http.end();

}

// ============================================================
// INITIALIZE ESP32
// ============================================================

void setup() {

  Serial.begin(115200);

  delay(1000);

  Serial.println();

  Serial.println(
    "=================================================="
  );

  Serial.println(
    "          SYNTERRA SENSOR TELEMETRY"
  );

  Serial.println(
    "=================================================="
  );

  // Soil sensor GPIO

  pinMode(PIN_SOIL_ADC, INPUT);

  pinMode(PIN_SOIL_DIG, INPUT);

  analogReadResolution(12);

  // DHT11

  Serial.println("[INIT] Starting DHT11...");

  dht.begin();

  // BH1750

  initializeBH1750();

  // WiFi

  initializeWiFi();

  Serial.println();

  Serial.println(
    "[SYSTEM] Initialization completed."
  );

  Serial.println(
    "[SYSTEM] Update interval: 20 seconds."
  );

  Serial.println(
    "[SYSTEM] Relay: DISABLED."
  );

  Serial.println(
    "=================================================="
  );

}

// ============================================================
// MAIN SENSOR LOOP
// ============================================================

void loop() {

  unsigned long now = millis();

  if (
    now - last_read_time >= TELEMETRY_INTERVAL_MS ||
    last_read_time == 0
  ) {

    last_read_time = now;

    loop_count++;

    Serial.println();

    Serial.printf(
      "------ READING #%d ------\n",
      loop_count
    );

    // ---------------- DHT11 ----------------

    float temperature = NAN;

    float humidity = NAN;

    bool dht_ok = readDHTSensor(
      temperature,
      humidity
    );

    if (dht_ok) {

      Serial.printf(
        "[DHT11] Temperature: %.1f C | Humidity: %.1f %% [PASS]\n",
        temperature,
        humidity
      );

    } else {

      Serial.println(
        "[DHT11] Reading failed [FAIL]"
      );

    }

    // ---------------- BH1750 ----------------

    float lux = readLightSensor();

    if (isfinite(lux)) {

      Serial.printf(
        "[BH1750] Light: %.1f lux [PASS]\n",
        lux
      );

    } else {

      Serial.println(
        "[BH1750] Reading unavailable [FAIL]"
      );

    }

    // ---------------- SOIL ANALOG ----------------

    int raw_adc = readSoilADC();

    float soil_pct = calculateSoilMoisture(
      raw_adc
    );

    Serial.printf(
      "[SOIL A0] ADC: %d | Moisture: %.1f %%\n",
      raw_adc,
      soil_pct
    );

    // ---------------- SOIL DIGITAL ----------------

    int soil_digital = digitalRead(PIN_SOIL_DIG);

    Serial.printf(
      "[SOIL D0] Status: %s\n",
      soil_digital == LOW
        ? "MOIST / TRIGGERED"
        : "DRY / NOT TRIGGERED"
    );

    // ---------------- WIFI ----------------

    maintainWiFi();

    // ---------------- DASHBOARD ----------------

    if (WiFi.status() == WL_CONNECTED) {

      sendToSynterra(
        temperature,
        humidity,
        lux,
        soil_pct,
        raw_adc
      );

    } else {

      Serial.println(
        "[SYNC] Waiting for WiFi..."
      );

    }

    Serial.println(
      "------ READING COMPLETE ------"
    );

  }

  delay(20);

}
