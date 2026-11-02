/*
 * ==============================================================================
 * SYNTERRA — Autonomous Agricultural Intelligence
 * ESP32-S3 OV2640/OV3660/OV5640 Optical Pathology Camera Server
 * ==============================================================================
 *
 * Microcontroller: ESP32-S3 (with PSRAM enabled)
 * Camera Sensor:   OV2640, OV3660, or OV5640
 *
 * Supported Boards (Uncomment your board below):
 *   - CAMERA_MODEL_FREENOVE_ESP32S3_CAM  (Default)
 *   - CAMERA_MODEL_XIAO_ESP32S3_SENSE
 *   - CAMERA_MODEL_ESP32S3_EYE
 *   - CAMERA_MODEL_AI_THINKER (Classic ESP32 fallback)
 *
 * Endpoints Provided on LAN:
 *   - http://<ESP32_IP>/stream   — MJPEG live video stream (consumed by SYNTERRA)
 *   - http://<ESP32_IP>/capture  — Single still frame JPEG (used for AI pathology)
 *   - http://<ESP32_IP>/status   — Hardware JSON health telemetry
 *
 * Arduino IDE Compilation Settings for ESP32-S3:
 *   - Board: "ESP32S3 Dev Module" (or your specific board)
 *   - USB CDC On Boot: "Enabled"
 *   - Flash Size: "8MB" or "16MB"
 *   - Partition Scheme: "Huge APP (3MB No OTA / 1MB SPIFFS)" or "8MB with spiffs"
 *   - PSRAM: "OPI PSRAM" (Freenove) or "QSPI PSRAM" (Xiao) — MUST BE ENABLED!
 * ==============================================================================
 */

#include "esp_camera.h"
#include <WiFi.h>
#include <ESPmDNS.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <BH1750.h>
#include "esp_timer.h"
#include "img_converters.h"
#include "fb_gfx.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include "esp_http_server.h"

// ==============================================================================
// 1. Select Your Camera Hardware Model
// ==============================================================================
#define CAMERA_MODEL_FREENOVE_ESP32S3_CAM    // Default: Freenove ESP32-S3 WROOM CAM
//#define CAMERA_MODEL_XIAO_ESP32S3_SENSE      // Seeed Studio XIAO ESP32S3 Sense
//#define CAMERA_MODEL_ESP32S3_EYE             // Espressif ESP32-S3-EYE
//#define CAMERA_MODEL_AI_THINKER              // Classic ESP32-CAM (WROVER)

#include "camera_pins.h"

// ==============================================================================
// 2. WiFi Credentials (Configured for Mobile Hotspot / Local Network)
// ==============================================================================
const char* ssid = "jj";              // Windows Mobile Hotspot SSID
const char* password = "123456789";   // Hotspot Password

// Fallback host laptop IP if gateway differs
const char* fallback_server_ip = "192.168.137.10";

unsigned long lastAnnounceTime = 0;
const unsigned long announceInterval = 30000; // Heartbeat announce every 30s

BH1750 lightMeter;
bool bh1750_found = false;
unsigned long lastLuxTime = 0;
const unsigned long luxInterval = 20000;      // Telemetry update every 20s

void sendLuxToSynterra(float lux) {
  if (WiFi.status() != WL_CONNECTED) return;
  IPAddress gateway = WiFi.gatewayIP();
  String url = "http://" + gateway.toString() + ":5000/api/sensors/telemetry";
  HTTPClient http;
  http.setTimeout(2000);
  if (http.begin(url)) {
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-Token", "plant-lab-auth-token-9981");
    String payload = "{\"device_id\":\"esp32-cam-lux\",\"plant_id\":\"test-specimen-1\",\"light_lux\":" + String(lux, 1) + "}";
    int code = http.POST(payload);
    if (code == 200 || code == 201) {
      Serial.printf("  └─> [SYNTERRA LUX] Posted %5.1f Lux to dashboard (HTTP %d)\n", lux, code);
    }
    http.end();
  }
}

// Auto-register camera IP with the SYNTERRA host server
void announceToSynterra() {
  if (WiFi.status() != WL_CONNECTED) return;

  IPAddress gateway = WiFi.gatewayIP();
  String serverHosts[2] = {
    gateway.toString(),
    fallback_server_ip
  };

  for (int i = 0; i < 2; i++) {
    if (serverHosts[i].length() == 0 || serverHosts[i] == "0.0.0.0") continue;
    HTTPClient http;
    String url = "http://" + serverHosts[i] + ":5000/api/camera/register";
    http.setTimeout(1500);
    if (http.begin(url)) {
      http.addHeader("Content-Type", "application/json");
      String payload = "{\"device_id\":\"esp32-s3-cam\",\"ip\":\"" + WiFi.localIP().toString() + "\",\"port\":80}";
      int code = http.POST(payload);
      if (code > 0) {
        Serial.printf("[AUTO-DISCOVERY] Registered camera with SYNTERRA at %s (HTTP %d)\n", serverHosts[i].c_str(), code);
        http.end();
        return;
      }
      http.end();
    }
  }
}

// ==============================================================================
// Server & Stream Setup
// ==============================================================================
#define PART_BOUNDARY "123456789000000000000987654321"
static const char* _STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char* _STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char* _STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

httpd_handle_t stream_httpd = NULL;
httpd_handle_t camera_httpd = NULL;

// Handler: Stream MJPEG video
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

// Handler: Still Capture (single JPEG for AI diagnosis)
static esp_err_t capture_handler(httpd_req_t *req) {
  camera_fb_t *fb = NULL;
  esp_err_t res = ESP_OK;

  fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println(F("[CAM ERROR] Still capture failed"));
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }

  httpd_resp_set_type(req, "image/jpeg");
  httpd_resp_set_hdr(req, "Content-Disposition", "inline; filename=capture.jpg");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

  res = httpd_resp_send(req, (const char *)fb->buf, fb->len);
  esp_camera_fb_return(fb);
  return res;
}

// Handler: Hardware Status JSON
static esp_err_t status_handler(httpd_req_t *req) {
  char json_response[256];
  snprintf(json_response, sizeof(json_response),
    "{\"system\":\"SYNTERRA ESP32-S3 CAM\",\"ip\":\"%s\",\"wifi_rssi\":%d,\"free_heap\":%u,\"psram\":%s}",
    WiFi.localIP().toString().c_str(),
    WiFi.RSSI(),
    ESP.getFreeHeap(),
    psramFound() ? "true" : "false"
  );
  httpd_resp_set_type(req, "application/json");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  return httpd_resp_send(req, json_response, strlen(json_response));
}

// Start HTTP Web Servers
void startCameraServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 80;
  config.ctrl_port = 32768;

  httpd_uri_t capture_uri = {
    .uri       = "/capture",
    .method    = HTTP_GET,
    .handler   = capture_handler,
    .user_ctx  = NULL
  };

  httpd_uri_t stream_uri = {
    .uri       = "/stream",
    .method    = HTTP_GET,
    .handler   = stream_handler,
    .user_ctx  = NULL
  };

  httpd_uri_t status_uri = {
    .uri       = "/status",
    .method    = HTTP_GET,
    .handler   = status_handler,
    .user_ctx  = NULL
  };

  Serial.println(F("[HTTP] Starting camera web server on port 80..."));
  if (httpd_start(&camera_httpd, &config) == ESP_OK) {
    httpd_register_uri_handler(camera_httpd, &capture_uri);
    httpd_register_uri_handler(camera_httpd, &stream_uri);
    httpd_register_uri_handler(camera_httpd, &status_uri);
    Serial.println(F("[HTTP] Camera web server online!"));
  }
}

// ==============================================================================
// Arduino Setup
// ==============================================================================
void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0); // Disable brownout detector for camera stability

  Serial.begin(115200);
  delay(1500);
  Serial.println();
  Serial.println(F("=========================================================="));
  Serial.println(F("SYNTERRA — ESP32-S3 Optical Pathology Camera Server"));
  Serial.println(F("=========================================================="));

  // Configure Camera
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

  // PSRAM check & resolution optimization
  if (psramFound()) {
    Serial.println(F("[PSRAM] Found external PSRAM! Allocating High-Definition buffer..."));
    config.frame_size = FRAMESIZE_XGA; // 1024x768 (Optimal for Kindwise AI disease detection)
    config.jpeg_quality = 10;          // 0-63 lower means higher quality
    config.fb_count = 2;
    config.fb_location = CAMERA_FB_IN_PSRAM;
  } else {
    Serial.println(F("[WARNING] No PSRAM detected! Falling back to SVGA..."));
    config.frame_size = FRAMESIZE_SVGA; // 800x600
    config.jpeg_quality = 12;
    config.fb_count = 1;
    config.fb_location = CAMERA_FB_IN_DRAM;
  }

  // Initialize camera driver
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[ERROR] Camera initialization failed with error code: 0x%x\n", err);
    Serial.println(F("[HINT] Check camera ribbon cable seating and PSRAM board settings in Arduino IDE."));
    return;
  }
  Serial.println(F("[CAMERA] OV2640 driver initialized successfully!"));

  // Optical sensor fine-tuning for botanical pathology
  sensor_t *s = esp_camera_sensor_get();
  if (s != NULL) {
    s->set_brightness(s, 1);    // Slightly brighten leaves
    s->set_contrast(s, 1);      // Elevate contrast for lesion definition
    s->set_saturation(s, 0);    // True-color saturation
    s->set_whitebal(s, 1);      // Enable automatic white balance
    s->set_awb_gain(s, 1);
  }

  // Connect to WiFi
  Serial.printf("[WIFI] Connecting to %s", ssid);
  WiFi.begin(ssid, password);
  int retry = 0;
  while (WiFi.status() != WL_CONNECTED && retry < 25) {
    delay(500);
    Serial.print(F("."));
    retry++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.println(F("[WIFI] CONNECTED SUCCESSFULLY!"));
    Serial.printf("[WIFI] ESP32-S3 Camera IP Address: http://%s\n", WiFi.localIP().toString().c_str());
    Serial.printf("[WIFI] Gateway IP (Laptop Host):  http://%s\n", WiFi.gatewayIP().toString().c_str());
    Serial.printf("[WIFI] MJPEG Stream Endpoint:     http://%s/stream\n", WiFi.localIP().toString().c_str());
    Serial.printf("[WIFI] Still Capture Endpoint:     http://%s/capture\n", WiFi.localIP().toString().c_str());

    // 1. Enable mDNS Responder: access at http://synterra-cam.local without IP
    if (MDNS.begin("synterra-cam")) {
      MDNS.addService("http", "tcp", 80);
      Serial.println(F("[mDNS] Responder active at http://synterra-cam.local"));
    }

    // 2. Start HTTP Stream Server
    startCameraServer();

    // 3. Auto-register this camera IP with the SYNTERRA host server
    announceToSynterra();
  } else {
    Serial.println();
    Serial.println(F("[WIFI NOTICE] Hotspot not detected. Starting Standalone Diagnostic SoftAP..."));
    WiFi.softAP("SYNTERRA-CAM-TEST", "12345678");
    Serial.println(F("=========================================================="));
    Serial.println(F("[WIFI AP] Standalone Wi-Fi Access Point Online!"));
    Serial.println(F("[WIFI AP] SSID:     SYNTERRA-CAM-TEST"));
    Serial.println(F("[WIFI AP] Password: 12345678"));
    Serial.printf("[WIFI AP] Local Stream URL: http://%s/stream\n", WiFi.softAPIP().toString().c_str());
    Serial.printf("[WIFI AP] Local Capture URL: http://%s/capture\n", WiFi.softAPIP().toString().c_str());
    Serial.println(F("=========================================================="));
    startCameraServer();
  }

  // 4. Initialize BH1750 Light Sensor on G21 (SDA) and G22 (SCL)
  Serial.println(F("[INIT] Initializing BH1750 Light Meter on G21/G22..."));
  Wire.begin(21, 22);
  if (lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE)) {
    Serial.println(F("✓ [BH1750] Initialized successfully on G21/G22!"));
    bh1750_found = true;
  } else {
    Serial.println(F("✗ [BH1750] Not detected on G21/G22 (running in camera-only mode)."));
  }
}

// ==============================================================================
// Loop
// ==============================================================================
void loop() {
  unsigned long now = millis();

  // Periodic heartbeat announce to keep SYNTERRA synchronized (every 30s)
  if (now - lastAnnounceTime > announceInterval) {
    lastAnnounceTime = now;
    announceToSynterra();
  }

  // Periodic BH1750 Lux telemetry to dashboard (every 20s)
  if (bh1750_found && (now - lastLuxTime > luxInterval || lastLuxTime == 0)) {
    lastLuxTime = now;
    float lux = lightMeter.readLightLevel();
    Serial.printf("[BH1750] Light Intensity: %6.1f Lux\n", lux);
    if (lux >= 0.0) {
      sendLuxToSynterra(lux);
    }
  }

  delay(100);
}
