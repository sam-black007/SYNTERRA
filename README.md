# 🌱 SYNTERRA
### Autonomous Botanical Intelligence & AgriTech IoT Platform

**Engineering Precision Intelligence for Autonomous Agriculture.**

SYNTERRA is an enterprise-grade IoT and AI-driven precision agriculture platform. It bridges edge microcontroller sensing, closed-loop irrigation actuation, real-time agronomic telemetry fusion, and computer vision leaf pathology into an integrated laboratory console.

---

## 🏛️ System Architecture

```mermaid
flowchart TD
    subgraph Edge ["Hardware Edge Node (ESP32 USB-C)"]
        DHT["DHT11 (D32)<br/>Temp & Humidity"]
        SOIL["FC-28 (D34/D35)<br/>Soil Moisture"]
        BH["BH1750 (D21/D22)<br/>Ambient Light Lux"]
        RELAY["Relay Solenoid (D27)<br/>Irrigation Pump"]
        MGR["SensorManager Firmware<br/>6-Second Cadence"]
        DHT --> MGR
        SOIL --> MGR
        BH --> MGR
        MGR -.->|Actuate| RELAY
    end

    subgraph DualLink ["Dual-Link Telemetry Pipeline"]
        direction TB
        USB["Link A: USB Serial<br/>JSON at 115200 Baud"]
        WIFI["Link B: Wi-Fi REST<br/>HTTP POST /telemetry"]
        BRIDGE["Python Serial Bridge<br/>(serial_bridge.py)"]
        MGR -->|Cable| USB --> BRIDGE
        MGR -->|Wireless| WIFI
    end

    subgraph Backend ["SYNTERRA Server (Flask + SQLAlchemy)"]
        API["Telemetry Ingestion & Auth<br/>(X-Device-Token)"]
        FUSION["Multi-Board Telemetry Fusion"]
        VPD_ENG["VPD Psychrometric Engine"]
        CLIMATE_ENG["Climate Inference Engine"]
        IRRIG_MGR["Autonomous Irrigation Watchdog"]
        DIAG_SVC["Kindwise Crop.Health / Gemini AI"]
        DB[(SQLite / plant_doctor.db)]
        
        BRIDGE --> API
        WIFI --> API
        API --> FUSION --> DB
        FUSION --> VPD_ENG
        FUSION --> CLIMATE_ENG
        FUSION --> IRRIG_MGR
    end

    subgraph UI ["Real-Time Operations Console (React 18 + Vite)"]
        WS["Socket.IO WebSockets"]
        BANNER["Microclimate Intelligence Banner"]
        METRICS["Core Sensor Gauges & Dynamic Badges"]
        CHARTS["Recharts Dual Time-Series Analytics"]
        STUDIO["Optical Diagnostic Studio"]
        PDF["PDF Pathology Dossier Generator"]

        Backend -->|Socket.IO| WS
        WS --> BANNER
        WS --> METRICS
        WS --> CHARTS
        DIAG_SVC --> STUDIO
        DIAG_SVC --> PDF
    end
```

---

## 🔌 Hardware Pinout & Wiring (USB-C ESP32 Dev Module)

The system runs on a **Single-Board USB-C ESP32 Dev Module (Standard 30/38-Pin DevKit)** with zero pin collisions:

| Sensor / Module | Sensor Pin | ESP32 Pin on Board | Bus / Logic Type | Hardware Function & Safety Rules |
| :--- | :--- | :--- | :--- | :--- |
| **DHT11** (Canopy Climate) | `DATA / OUT` | **`D32`** | Bidirectional GPIO | Pulls line LOW for 18ms; requires bidirectional drive (cannot use GPI pins like D34/D35). |
| | `VCC` | **`3V3`** | 3.3V Power Bus | Dedicated 3.3V supply rail. |
| | `GND` | **`GND`** | Ground Bus | Common ground reference. |
| **FC-28** (Soil Moisture) | `A0` (Analog) | **`D34`** | `ADC1_CH6` | Dedicated ADC1 channel; operational simultaneously with active Wi-Fi radio. |
| | `D0` (Digital) | **`D35`** | Digital Input | Optional onboard comparator threshold alert. |
| | `VCC` | **`3V3`** | 3.3V Power Bus | Low noise sensor power rail. |
| | `GND` | **`GND`** | Ground Bus | Common ground reference. |
| **BH1750** (Canopy Lux) | `SDA` | **`D21`** | Hardware I2C SDA | Default ESP32 hardware I2C data line. |
| | `SCL` | **`D22`** | Hardware I2C SCL | Default ESP32 hardware I2C clock line. |
| | `VCC` | **`VIN` (5V)** | 5V Power Rail | Feeds the sensor's onboard 662K LDO regulator cleanly without voltage sag. |
| | `GND` | **`GND`** | Ground Bus | Common ground reference. |
| | `ADDR` | *Unconnected* | I2C Address `0x23` | Internal pull-down sets default address. |
| **Relay Module** (Pump) | `IN / Signal` | **`D27`** | Digital Output | Drives transistor switch for pump coil; normally LOW (safe OFF). |
| | `VCC` | **`VIN` (5V)** | 5V Power Rail | Dedicated coil power rail. |
| | `GND` | **`GND`** | Ground Bus | Common ground reference. |

---

## 🌤️ Environmental Climate & Condition Classification Engine

The firmware and backend continuously evaluate ambient photometric, thermal, psychrometric, and substrate metrics to classify the macro-atmospheric and microclimate states in real time:

### 1. Photometric Flux Classifications (BH1750 Lux)
* **`< 25 Lux`** &rarr; `🌙 Night / Dark` *(Transpiration paused; dark respiration active)*
* **`25 – 200 Lux`** &rarr; `🌆 Dim / Twilight` *(Low indoor light or twilight transition)*
* **`200 – 1,000 Lux`** &rarr; `☁️ Cloudy / Overcast` *(Soft diffused sunlight under cloud cover)*
* **`1,000 – 10,000 Lux`** &rarr; `⛅ Daylight / Partly Cloudy` *(Optimal daylight photosynthetic radiation)*
* **`10,000 – 25,000 Lux`** &rarr; `☀️ Sunny / Clear Sky` *(Peak clear sky solar radiation)*
* **`> 25,000 Lux`** &rarr; `🔥 Intense Direct Sunlight` *(Elevated radiation; rapid evapotranspiration)*

### 2. Substrate Moisture Classifications (FC-28 Soil Moisture)
* **`< 20 %`** &rarr; `🏜️ Critical Drought` *(Immediate autonomous irrigation triggered)*
* **`20 – 40 %`** &rarr; `⚠️ Dry (Needs Water)` *(Substrate depleted; watering cycle required)*
* **`40 – 75 %`** &rarr; `🌱 Optimal Root Moisture` *(Ideal rhizosphere oxygen & moisture balance)*
* **`> 75 %`** &rarr; `💧 Wet / Saturated` *(Roots fully hydrated)*

### 3. Thermal & Psychrometric Classifications (DHT11)
* **Temperature:** `< 16°C` Cold | `16–22°C` Mild/Cool | `22–28°C` Optimal | `28–34°C` Warm | `> 34°C` Heatwave
* **Relative Humidity:** `< 35%` Arid | `35–65%` Ideal Humidity | `65–80%` Humid/Tropical | `> 80%` Saturated Air
* **Vapor Pressure Deficit (VPD):** Calculated via psychrometric saturation curves:
  $$\text{VP}_{\text{sat}} = 0.61078 \times e^{\left(\frac{17.27 \times T}{T + 237.3}\right)}, \quad \text{VPD} = \text{VP}_{\text{sat}} \times \left(1 - \frac{\text{RH}}{100}\right)$$

---

## ⏱️ 6-Second Dual-Link Telemetry Pipeline

The node operates on a **6-second cadence (`6000 ms`)** with dual-link transmission:
1. **Link A (USB Cable Mode):** Emits structured JSON strings over Serial at `115200` baud. Consumed by `scripts/serial_bridge.py` and forwarded via HTTP POST.
2. **Link B (Wireless Hotspot Mode):** ESP32 connects directly to Wi-Fi hotspot (`jj`) and issues an HTTP POST to `http://<gateway_ip>:5000/api/sensors/telemetry` with header `X-Device-Token: plant-lab-auth-token-9981`.
3. **Multi-Board Fusion:** If multiple nodes report (e.g. ESP32-CAM optical node + USB-C sensor node), the backend automatically fuses readings so missing metrics preserve their latest verified state.

```json
{
  "device_id": "esp32-sensor-01",
  "plant_id": "test-specimen-1",
  "temperature_c": 24.8,
  "humidity_pct": 61.2,
  "soil_moisture_pct": 58.4,
  "soil_raw_adc": 2150,
  "light_lux": 1450.0,
  "light_condition": "Daylight / Partly Cloudy",
  "soil_condition": "Optimal Root Moisture",
  "temp_condition": "Optimal Plant Temp",
  "humidity_condition": "Ideal Canopy Humidity",
  "climate": "Partly Cloudy & Pleasant",
  "water_reservoir_ok": true
}
```

---

## 🚀 Quick Start Guide

### 1. Prerequisites & Environment Setup
```powershell
# Clone the repository
git clone https://github.com/sam-black007/SYNTERRA.git
cd SYNTERRA

# Create virtual environment and activate
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# Install backend dependencies
pip install -r requirements.txt

# Configure secrets
copy .env.example .env
# Set PLANT_API_KEY and DEVICE_TOKEN inside .env
```

### 2. Start the SYNTERRA Server
```powershell
# Double-click start.bat or execute:
python run.py
```
Open **`http://localhost:5000/dashboard`** to access the real-time React console.

### 3. Flash the ESP32 Firmware
1. Open `firmware/Sensor_Hardware_Diagnostic/Sensor_Hardware_Diagnostic.ino` in Arduino IDE.
2. Select Board: **ESP32 Dev Module**.
3. Install required libraries via Library Manager:
   - `DHT sensor library` by Adafruit
   - `BH1750` by Christopher Laws
4. Verify Wi-Fi credentials match your hotspot (`jj` / `123456789`).
5. Select your COM Port and click **Upload**.

### 4. Run the Serial Bridge (Optional / USB Mode)
```powershell
python scripts/serial_bridge.py
```

---

## 📡 API Reference

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/dashboard` | `GET` | **Real-Time React 18 Operations Console** |
| `/api/sensors/telemetry` | `POST` | Ingest sensor telemetry JSON (`X-Device-Token` header) |
| `/api/sensors/latest` | `GET` | Retrieve latest fused sensor readings with condition badges |
| `/api/sensors/history` | `GET` | Historical telemetry records (`?limit=50`) |
| `/api/sensors/export/csv`| `GET` | Export complete sensor history as CSV |
| `/api/diagnose` | `POST` | Upload leaf photo &rarr; Kindwise Crop.Health disease detection |
| `/api/diagnoses` | `GET` | List all historical pathology diagnoses |
| `/api/diagnosis/<id>/pdf`| `GET` | **Download Official PDF Pathology Dossier with Treatment Plan** |
| `/api/irrigation/status` | `GET` | Read solenoid pump state, countdown & safety interlocks |
| `/api/irrigation/manual` | `POST` | Execute timed manual irrigation pulse (5s–30s) |
| `/api/irrigation/emergency_stop` | `POST` | Instant solenoid pump emergency shutoff |
| `/api/camera/stream` | `GET` | Real-time optical MJPEG video stream |
| `/api/camera/capture` | `POST` | Capture frame from camera node & run AI diagnosis |

---

## 🛠️ Technology Stack

* **Embedded Firmware:** ESP32 C++ (Arduino Core), FreeRTOS, Hardware I2C Wire, DHT sensor library, BH1750.
* **Backend Services:** Python 3.12, Flask 3.0, Flask-SocketIO, SQLAlchemy ORM, SQLite.
* **Frontend Application:** React 18, Vite, Tailwind CSS, Recharts, Lucide Icons, Socket.IO Client.
* **AI & Computer Vision:** Kindwise Crop.Health API / Plant.id, ReportLab PDF generation engine.
* **Protocols & Buses:** WebSocket (WSS), REST JSON, USB-UART CDC, Hardware I2C, 12-bit SAR ADC.

---

## 📄 License & Attribution

Designed and engineered for precision autonomous agriculture. All rights reserved.
