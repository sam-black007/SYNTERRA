/*
 * ==============================================================================
 * SYNTERRA — Autonomous Agricultural Intelligence
 * ESP32-S3 All-In-One Unified Station Firmware (Camera + Sensors)
 * ==============================================================================
 *
 * Microcontroller: ESP32-S3 (with PSRAM enabled)
 * Camera Sensor:   OV2640, OV3660, or OV5640
 * Microclimate:    DHT11, BH1750 (I2C), FC-28 Soil Moisture, Float Switch
 *
 * This single unified sketch runs BOTH the live optical video stream AND
 * the environmental telemetry pipeline on a single ESP32-S3 board!
 *
 * Board Selection (Uncomment your board below):
 *   - CAMERA_MODEL_FREENOVE_ESP32S3_CAM  (Default)
 *   - CAMERA_MODEL_XIAO_ESP32S3_SENSE
 *   - CAMERA_MODEL_ESP32S3_EYE
 *   - CAMERA_MODEL_AI_THINKER (Classic ESP32 fallback)
 *
 * Sensor Pinout (Mapped to non-conflicting pins free from camera):
 *   - DHT11 (Temp/Humidity): GPIO 42 (or GPIO 2 on boards without flash LED)
 *   - FC-28 Soil Moisture:   GPIO 1  (ADC1 Channel 0)
 *   - Water Level Switch:    GPIO 41 (Internal Pullup; LOW = Dry, HIGH = OK)
 *   - BH1750 Light Meter:    I2C (SDA = GPIO 21, SCL = GPIO 47)
 *
 * Arduino IDE Compilation Settings for ESP32-S3:
 *   - Board: "ESP32S3 Dev Module" (or your specific board)
 *   - USB CDC On Boot: "Enabled"
 *   - Flash Size: "8MB" or "16MB"
 *   - Partition Scheme: "Huge APP (3MB No OTA / 1MB SPIFFS)"
 *   - PSRAM: "OPI PSRAM" (Freenove) or "QSPI PSRAM" (Xiao) — MUST BE ENABLED!
 * ==============================================================================
 */

#include "esp_camera.h"
#include <WiFi.h>
#include <ESPmDNS.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <DHT.h>
#include <BH1750.h>
#include <ArduinoJson.h>
#include "esp_timer.h"
#include "img_converters.h"
#include "fb_gfx.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include "esp_http_server.h"

// ==============================================================================
// 1. Select Camera Hardware Model
// ==============================================================================
#define CAMERA_MODEL_FREENOVE_ESP32S3_CAM    // Default: Freenove ESP32-S3 WROOM CAM
//#define CAMERA_MODEL_XIAO_ESP32S3_SENSE      // Seeed Studio XIAO ESP32S3 Sense
//#define CAMERA_MODEL_ESP32S3_EYE             // Espressif ESP32-S3-EYE
//#define CAMERA_MODEL_AI_THINKER              // Classic ESP32-CAM (WROVER)

#include "camera_pins.h"

// ==============================================================================
// 2. WiFi & Server Credentials
// ==============================================================================
const char* ssid = "jj";                               // Windows Mobile Hotspot
const char* password = "123456789";                    // 2.4 GHz Band
const char* device_token = "plant-lab-auth-token-9981"; // Validated by SYNTERRA .env
const char* fallback_server_ip = "192.168.137.10";     // Secondary laptop host IP

#define DEVICE_ID             "esp32-unified-01"
#define PLANT_ID              "specimen-alpha"
#define TELEMETRY_INTERVAL_MS 10000                   // 10 seconds

// Set to true if testing on desk without physical DHT/soil sensors plugged in
// When true: camera is 100% REAL optical video, sensors emit realistic data.
// When false: reads real physical ADC & DHT pins.
#define SENSOR_SIMULATION_MODE false

// ==============================================================================
// 3. Non-Conflicting Sensor Pin Assignments
// ==============================================================================
#if defined(CAMERA_MODEL_XIAO_ESP32S3_SENSE)
  #define PIN_DHT             1    // D0 / GPIO 1
  #define PIN_SOIL_ANALOG     2    // D1 / GPIO 2 (ADC)
  #define PIN_WATER_RESERVOIR 3    // D2 / GPIO 3
  #define PIN_I2C_SDA         5    // D4 / GPIO 5
  #define PIN_I2C_SCL         6    // D5 / GPIO 6
#else
  // Freenove ESP32-S3 WROOM CAM default free pins
  #define PIN_DHT             42   // GPIO 42 (or GPIO 2)
  #define PIN_SOIL_ANALOG     1    // GPIO 1 (ADC1_CH0)
  #define PIN_WATER_RESERVOIR 41   // GPIO 41
  #define PIN_I2C_SDA         21   // GPIO 21
  #define PIN_I2C_SCL         47   // GPIO 47
#endif

#define DHTTYPE               DHT11
const int SOIL_DRY_ADC = 3400;     // Raw ADC value in air (dry)
const int SOIL_WET_ADC = 1300;     // Raw ADC value in water (submerged)

// ==============================================================================
// Sensor & HTTP Server Instances
// ==============================================================================
DHT dht(PIN_DHT, DHTTYPE);
BH1750 lightMeter;
bool bh1750_available = false;

httpd_handle_t camera_httpd = NULL;
#define PART_BOUNDARY "123456789000000000000987654321"
static const char* _STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char* _STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char* _STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

unsigned long last_telemetry_time = 0;
unsigned long last_announce_time = 0;

// Simulation variables
float sim_temp = 24.5;
float sim_hum = 58.0;
float sim_soil = 64.0;
float sim_lux = 450.0;

// ==============================================================================
// HTTP Handlers: Live MJPEG Stream, Snapshot, Status
// ==============================================================================
static esp_err_t stream_handler(httpd_req_t *req) {
  camera_fb_t *fb = NULL;
  esp_err_t res = ESP_OK;
  size_t _jpg_buf_len = 0;
  uint8_t * _jpg_buf = NULL;
  char part_buf[64];

  res = httpd_resp_set_type(req, _STREAM_CONTENT_TYPE);
  if (res != ESP_OK) return res;
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

  while (true) {
    fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println(F("[CAM ERROR] Camera capture failed during stream"));
      res = ESP_FAIL;
    } else {
      _jpg_buf_len = fb->len;
      _jpg_buf = fb->buf;
    }

    if (res == ESP_OK) {
      size_t hlen = snprintf((char *)part_buf, 64, _STREAM_PART, _jpg_buf_len);
      res = httpd_resp_send_chunk(req, (const char *)part_buf, hlen);
    }
    if (res == ESP_OK) {
      res = httpd_resp_send_chunk(req, (const char *)_jpg_buf, _jpg_buf_len);
    }
    if (res == ESP_OK) {
      res = httpd_resp_send_chunk(req, _STREAM_BOUNDARY, strlen(_STREAM_BOUNDARY));
    }
    if (fb) {
      esp_camera_fb_return(fb);
      fb = NULL;
      _jpg_buf = NULL;
    } else if (res != ESP_OK) {
      break;
    }
  }
  return res;
}

static esp_err_t capture_handler(httpd_req_t *req) {
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println(F("[CAM ERROR] Still capture failed"));
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }
  httpd_resp_set_type(req, "image/jpeg");
  httpd_resp_set_hdr(req, "Content-Disposition", "inline; filename=capture.jpg");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  esp_err_t res = httpd_resp_send(req, (const char *)fb->buf, fb->len);
  esp_camera_fb_return(fb);
  return res;
}

static esp_err_t status_handler(httpd_req_t *req) {
  char json_response[256];
  snprintf(json_response, sizeof(json_response),
    "{\"system\":\"SYNTERRA ESP32-S3 CAM\",\"node\":\"unified\",\"ip\":\"%s\",\"wifi_rssi\":%d,\"free_heap\":%u,\"psram\":%s}",
    WiFi.localIP().toString().c_str(),
    WiFi.RSSI(),
    ESP.getFreeHeap(),
    psramFound() ? "true" : "false"
  );
  httpd_resp_set_type(req, "application/json");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  return httpd_resp_send(req, json_response, strlen(json_response));
}

void startCameraServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 80;
  config.ctrl_port = 32768;

  httpd_uri_t capture_uri = { .uri = "/capture", .method = HTTP_GET, .handler = capture_handler, .user_ctx = NULL };
  httpd_uri_t stream_uri  = { .uri = "/stream",  .method = HTTP_GET, .handler = stream_handler,  .user_ctx = NULL };
  httpd_uri_t status_uri  = { .uri = "/status",  .method = HTTP_GET, .handler = status_handler,  .user_ctx = NULL };

  if (httpd_start(&camera_httpd, &config) == ESP_OK) {
    httpd_register_uri_handler(camera_httpd, &capture_uri);
    httpd_register_uri_handler(camera_httpd, &stream_uri);
    httpd_register_uri_handler(camera_httpd, &status_uri);
    Serial.println(F("[HTTP] Camera server online on port 80"));
  }
}

// ==============================================================================
// Auto-Discovery: Announce IP to SYNTERRA Laptop Host
// ==============================================================================
void announceCameraToHost() {
  if (WiFi.status() != WL_CONNECTED) return;
  IPAddress gateway = WiFi.gatewayIP();
  String hosts[2] = { gateway.toString(), fallback_server_ip };

  for (int i = 0; i < 2; i++) {
    if (hosts[i].length() == 0 || hosts[i] == "0.0.0.0") continue;
    HTTPClient http;
    String url = "http://" + hosts[i] + ":5000/api/camera/register";
    http.setTimeout(1200);
    if (http.begin(url)) {
      http.addHeader("Content-Type", "application/json");
      String payload = "{\"device_id\":\"" + String(DEVICE_ID) + "\",\"ip\":\"" + WiFi.localIP().toString() + "\",\"port\":80}";
      int code = http.POST(payload);
      if (code > 0) {
        Serial.printf("[AUTO-DISCOVERY] Registered camera with %s:5000 (HTTP %d)\n", hosts[i].c_str(), code);
        http.end();
        return;
      }
      http.end();
    }
  }
}

// ==============================================================================
// Wireless Telemetry Emission to Flask Backend
// ==============================================================================
void sendTelemetryToHost(const String& jsonPayload) {
  if (WiFi.status() != WL_CONNECTED) return;
  IPAddress gateway = WiFi.gatewayIP();
  String hosts[2] = { gateway.toString(), fallback_server_ip };

  for (int i = 0; i < 2; i++) {
    if (hosts[i].length() == 0 || hosts[i] == "0.0.0.0") continue;
    HTTPClient http;
    String url = "http://" + hosts[i] + ":5000/api/sensors/telemetry";
    http.setTimeout(1200);
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

// ==============================================================================
// Setup
// ==============================================================================
void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0); // Disable brownout reset for optical stability

  Serial.begin(115200);
  delay(1500);
  Serial.println();
  Serial.println(F("=========================================================="));
  Serial.println(F("SYNTERRA — ESP32-S3 All-in-One Unified Station"));
  Serial.println(F("=========================================================="));

  // 1. Configure Optical Camera
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode    = CAMERA_GRAB_LATEST;

  if (psramFound()) {
    Serial.println(F("[PSRAM] Found external PSRAM! Allocating High-Definition buffer..."));
    config.frame_size = FRAMESIZE_XGA; // 1024x768
    config.jpeg_quality = 10;
    config.fb_count = 2;
    config.fb_location = CAMERA_FB_IN_PSRAM;
  } else {
    Serial.println(F("[WARNING] No PSRAM! Falling back to SVGA..."));
    config.frame_size = FRAMESIZE_SVGA; // 800x600
    config.jpeg_quality = 12;
    config.fb_count = 1;
    config.fb_location = CAMERA_FB_IN_DRAM;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[ERROR] Camera init failed: 0x%x. Check camera ribbon seating.\n", err);
  } else {
    Serial.println(F("[CAMERA] OV2640 optical sensor online!"));
    sensor_t *s = esp_camera_sensor_get();
    if (s != NULL) {
      s->set_brightness(s, 1);
      s->set_contrast(s, 1);
      s->set_whitebal(s, 1);
      s->set_awb_gain(s, 1);
    }
  }

  // 2. Configure Environmental Sensors
  if (!SENSOR_SIMULATION_MODE) {
    dht.begin();
    Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
    Wire.setTimeOut(30);
    if (lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE)) {
      bh1750_available = true;
      Serial.println(F("[SENSORS] BH1750 Light Meter online!"));
    }
    pinMode(PIN_SOIL_ANALOG, INPUT);
    pinMode(PIN_WATER_RESERVOIR, INPUT_PULLUP);
    analogReadResolution(12);
  }

  // 3. Connect to Hotspot / Wi-Fi
  Serial.printf("[WIFI] Connecting to %s", ssid);
  WiFi.begin(ssid, password);
  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 20) {
    delay(400);
    Serial.print(F("."));
    retries++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.println(F("[WIFI] CONNECTED SUCCESSFULLY!"));
    Serial.printf("[WIFI] Camera IP Address:     http://%s\n", WiFi.localIP().toString().c_str());
    Serial.printf("[WIFI] Gateway (Laptop Host): http://%s\n", WiFi.gatewayIP().toString().c_str());
    Serial.printf("[WIFI] MJPEG Stream Endpoint: http://%s/stream\n", WiFi.localIP().toString().c_str());
    Serial.printf("[WIFI] Still Capture:        http://%s/capture\n", WiFi.localIP().toString().c_str());

    // mDNS Responder (access without IP)
    if (MDNS.begin("synterra-cam")) {
      MDNS.addService("http", "tcp", 80);
      Serial.println(F("[mDNS] Responder active at http://synterra-cam.local"));
    }

    startCameraServer();
    announceCameraToHost();
  } else {
    Serial.println();
    Serial.println(F("[WIFI] No connection. Running standalone on USB Serial."));
  }

  Serial.println(F("SYNTERRA Unified Station Ready."));
}

// ==============================================================================
// Main Loop (Non-blocking sensor reading + telemetry)
// ==============================================================================
void loop() {
  unsigned long now = millis();

  // Periodic Telemetry Ingestion (every 10s)
  if (now - last_telemetry_time >= TELEMETRY_INTERVAL_MS || last_telemetry_time == 0) {
    last_telemetry_time = now;

    float temperature_c = 0.0;
    float humidity_pct = 0.0;
    float light_lux = 0.0;
    int soil_raw_adc = 0;
    float soil_moisture_pct = 0.0;
    bool water_reservoir_ok = true;

    if (SENSOR_SIMULATION_MODE) {
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
      temperature_c = dht.readTemperature();
      humidity_pct = dht.readHumidity();
      if (isnan(temperature_c) || isnan(humidity_pct)) {
        temperature_c = 24.0;
        humidity_pct = 60.0;
      }

      if (bh1750_available) {
        light_lux = lightMeter.readLightLevel();
        if (light_lux < 0) light_lux = 0.0;
      } else {
        light_lux = 500.0;
      }

      long adc_accumulator = 0;
      for (int i = 0; i < 8; i++) {
        adc_accumulator += analogRead(PIN_SOIL_ANALOG);
        delay(4);
      }
      soil_raw_adc = adc_accumulator / 8;
      float mapped_pct = (float)(SOIL_DRY_ADC - soil_raw_adc) / (float)(SOIL_DRY_ADC - SOIL_WET_ADC) * 100.0;
      soil_moisture_pct = constrain(mapped_pct, 0.0, 100.0);
      water_reservoir_ok = (digitalRead(PIN_WATER_RESERVOIR) == HIGH);
    }

    // Construct JSON
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

    // 1. Emit to USB Serial (for USB monitoring or serial bridge)
    Serial.println(jsonString);

    // 2. Emit Wirelessly over Wi-Fi to SYNTERRA Backend
    sendTelemetryToHost(jsonString);
  }

  // Periodic Heartbeat Registration (every 30s)
  if (now - last_announce_time > 30000) {
    last_announce_time = now;
    announceCameraToHost();
  }

  delay(20);
}
