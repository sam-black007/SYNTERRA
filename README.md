# 🌱 SYNTERRA
### Autonomous Botanical Intelligence & AgriTech IoT Platform

**Engineering Precision Intelligence for Autonomous Agriculture.**

SYNTERRA is an enterprise-grade IoT and AI-driven precision agriculture platform. It bridges edge microcontroller sensing, closed-loop irrigation actuation, real-time agronomic telemetry fusion, and computer vision leaf pathology into an integrated laboratory console.

<p align="center">
  <img src="docs/images/dashboard_live.png" alt="SYNTERRA Real-Time Laboratory Console" width="95%" style="border-radius: 14px; box-shadow: 0 10px 40px rgba(0,0,0,0.6);" />
</p>

---

## 🏛️ System Architecture

SYNTERRA orchestrates four decoupled tiers: Edge Sensing & Actuation, Dual-Link Telemetry Ingestion, Ingestion & Multi-Board Telemetry Fusion, and the Real-Time React Operations Console.

```mermaid
flowchart TD
    subgraph Edge ["1. Hardware Edge Node (ESP32 USB-C)"]
        DHT["DHT11 (D32)<br/>Canopy Temp & Humidity"]
        SOIL["FC-28 (D34/D35)<br/>Substrate Moisture ADC"]
        BH["BH1750 (D21/D22)<br/>Ambient Photometric Lux"]
        RELAY["Relay Solenoid (D27)<br/>Irrigation Pump Control"]
        MGR["SensorManager Firmware<br/>6-Second Cadence Engine"]
        
        DHT --> MGR
        SOIL --> MGR
        BH --> MGR
        MGR -.->|Actuate 5V/12V Pump| RELAY
    end

    subgraph DualLink ["2. Dual-Link Telemetry Pipeline"]
        direction TB
        USB["Link A: USB Serial<br/>JSON at 115200 Baud"]
        WIFI["Link B: Wi-Fi REST<br/>Direct HTTP POST"]
        BRIDGE["Python Serial Bridge<br/>(serial_bridge.py)"]
        
        MGR -->|Cable Mode| USB --> BRIDGE
        MGR -->|Wireless Mode| WIFI
    end

    subgraph Backend ["3. Enterprise Server (Flask + SQLAlchemy)"]
        API["Telemetry Ingestion & Auth<br/>(X-Device-Token)"]
        FUSION["Multi-Board Telemetry Fusion Engine"]
        VPD_ENG["Agronomic VPD Psychrometric Engine"]
        CLIMATE_ENG["Microclimate Classification Engine"]
        IRRIG_MGR["Closed-Loop Irrigation Watchdog"]
        DIAG_SVC["Kindwise Crop.Health / Gemini Vision AI"]
        DB[(SQLite / plant_doctor.db)]
        
        BRIDGE --> API
        WIFI --> API
        API --> FUSION --> DB
        FUSION --> VPD_ENG
        FUSION --> CLIMATE_ENG
        FUSION --> IRRIG_MGR
    end

    subgraph UI ["4. Real-Time Operations Console (React 18 + Vite)"]
        WS["Socket.IO WebSocket Bus"]
        BANNER["Canopy Microclimate Intelligence Banner"]
        METRICS["Core Metric Gauges & Live Condition Badges"]
        CHARTS["Recharts Dual Time-Series Analytics"]
        STUDIO["Optical Pathology Studio"]
        PDF["PDF Clinical Dossier Generator"]

        Backend -->|Socket.IO Events| WS
        WS --> BANNER
        WS --> METRICS
        WS --> CHARTS
        DIAG_SVC --> STUDIO
        DIAG_SVC --> PDF
    end
```

---

## ⚡ Edge Microcontroller Signal & Firmware Flow

The firmware on the USB-C ESP32 Dev Module is architected as an object-oriented `SensorManager` that handles non-blocking multi-sensor sampling, brownout rejection, 5-sample analog noise filtering, dynamic climate classification, and dual dispatch:

```mermaid
flowchart LR
    subgraph SensoryInputs ["Sensory Input Bus"]
        D32["D32: DHT11<br/>18ms Bidirectional Pulse"]
        D34["D34: FC-28<br/>5-Sample 12-bit ADC1"]
        D21_22["D21/D22: BH1750<br/>Hardware I2C (Wire)"]
    end

    subgraph MCU ["ESP32 Node (SensorManager)"]
        ACQ["Synchronous Acquisition (readAll)"]
        CALIB["Calibration & Noise Filtering"]
        INFER["Climate & Weather Inference Engine"]
        FMT["JSON Serialization (toJSON)"]
        
        SensoryInputs --> ACQ --> CALIB --> INFER --> FMT
    end

    subgraph Dispatch ["Dual-Link Output (Every 6 Seconds)"]
        LINK_A["Link A: USB Serial CDC<br/>115200 Baud JSON String"]
        LINK_B["Link B: Direct Wi-Fi REST<br/>HTTP POST /api/sensors/telemetry"]
        
        FMT --> LINK_A
        FMT --> LINK_B
    end
```

---

## 💧 Closed-Loop Autonomous Irrigation Flowchart

SYNTERRA implements an automated closed-loop irrigation policy with safety watchdogs, dry-run reservoir interlocks, and emergency cutoff mechanisms:

```mermaid
flowchart TD
    START(["Telemetry Ingestion Cycle"]) --> READ["Evaluate Substrate Moisture & Reservoir Status"]
    READ --> EVAL{"Autonomous Mode Enabled?"}
    EVAL -- No / Manual --> IDLE["System in Standby (Awaiting Manual Trigger)"]
    EVAL -- Yes --> CHECK_SOIL{"Soil Moisture < Threshold %?"}
    CHECK_SOIL -- No --> HEALTHY["Substrate Moisture Nominal (Pump OFF)"]
    CHECK_SOIL -- Yes --> CHECK_RES{"Water Reservoir Interlock OK?"}
    CHECK_RES -- No --> LOCKOUT["Safety Interlock Tripped<br/>Inhibit Pump & Alert Operator"]
    CHECK_RES -- Yes --> PUMP_ON["Energize Relay IN (D27)<br/>Engage 12-Second Irrigation Pulse"]
    PUMP_ON --> WATCHDOG{"Runtime > Max Timeout?"}
    WATCHDOG -- Timeout Reached --> PUMP_OFF["De-energize Relay (Safe State OFF)<br/>Log Event to Historical Database"]
    WATCHDOG -- Operator Cutoff --> ESTOP["Instant Cutoff via /emergency_stop"]
    ESTOP --> PUMP_OFF
```

---

## 🔬 AI Computer Vision Leaf Pathology Pipeline

When a leaf frame is acquired from the optical studio or live camera stream, SYNTERRA runs multi-stage clinical diagnostic analysis:

```mermaid
flowchart TD
    IMG_IN(["Optical Frame Acquisition<br/>(ESP32-CAM Stream / File Upload)"]) --> PREPROC["Image Normalization & Validation"]
    PREPROC --> API_DISPATCH["Kindwise Crop.Health / Gemini Vision Engine"]
    
    subgraph Inference ["AI Clinical Pathology Inference"]
        SPECIES["Taxonomic Crop Species Identification"]
        PATHOLOGY["Pathology Detection & Confidence Scoring"]
        SEVERITY["Agronomic Severity Assessment"]
        
        API_DISPATCH --> SPECIES
        API_DISPATCH --> PATHOLOGY
        API_DISPATCH --> SEVERITY
    end
    
    SPECIES --> AGG["Formulate Clinical Dossier"]
    PATHOLOGY --> AGG
    SEVERITY --> AGG
    
    AGG --> STORE[(Persist in SQLite Database)]
    AGG --> EMIT["Emit Socket.IO Event (diagnosis_update)"]
    AGG --> PDF_GEN["Compile Official PDF Clinical Dossier<br/>(Active Ingredients & Treatment Advisory)"]
    
    EMIT --> UI_CONSOLE["Live React Diagnostic Console"]
    PDF_GEN --> PDF_OUT["Downloadable Dossier Document"]
```

---

## 🔌 Hardware Setup & Pin Mapping

<p align="center">
  <img src="docs/images/esp32_hardware_setup.jpg" alt="SYNTERRA ESP32 Hardware Node" width="380px" style="border-radius: 12px; box-shadow: 0 6px 25px rgba(0,0,0,0.5);" />
</p>

The system operates on a single **USB-C ESP32 Dev Module (Standard 30/38-Pin DevKit)** with zero pin collisions:

| Sensor / Actuator | Module Pin | ESP32 Pin on Board | Bus / Logic Type | Hardware Function & Safety Rules |
| :--- | :--- | :--- | :--- | :--- |
| **DHT11** (Canopy Climate) | `DATA / OUT` | **`D32`** | Bidirectional GPIO | Pulls line LOW for 18ms; requires bidirectional drive (cannot use input-only GPI pins like D34/D35). |
| | `VCC` | **`3V3`** | 3.3V Power Bus | Dedicated 3.3V low-noise rail. |
| | `GND` | **`GND`** | Ground Bus | Common system ground. |
| **FC-28** (Soil Moisture) | `A0` (Analog) | **`D34`** | `ADC1_CH6` | Dedicated ADC1 channel; operational simultaneously with active Wi-Fi radio. |
| | `D0` (Digital) | **`D35`** | Digital Input | Optional onboard comparator threshold alert. |
| | `VCC` | **`3V3`** | 3.3V Power Bus | Low noise sensor power rail. |
| | `GND` | **`GND`** | Ground Bus | Common system ground. |
| **BH1750** (Canopy Lux) | `SDA` | **`D21`** | Hardware I2C SDA | Default ESP32 hardware I2C data line. |
| | `SCL` | **`D22`** | Hardware I2C SCL | Default ESP32 hardware I2C clock line. |
| | `VCC` | **`VIN` (5V)** | 5V Power Rail | Feeds the sensor's onboard 662K LDO regulator cleanly without voltage sag. |
| | `GND` | **`GND`** | Ground Bus | Common system ground. |
| | `ADDR` | *Unconnected* | I2C Address `0x23` | Default I2C address. |
| **Relay Module** (Pump) | `IN / Signal` | **`D27`** | Digital Output | Drives transistor switch for pump coil; normally LOW (safe OFF). |
| | `VCC` | **`VIN` (5V)** | 5V Power Rail | Dedicated coil power rail. |
| | `GND` | **`GND`** | Ground Bus | Common system ground. |

---

## 🌤️ Environmental Climate & Condition Classification Engine

The firmware and backend continuously evaluate ambient photometric, thermal, psychrometric, and substrate metrics to classify macro-atmospheric and microclimate states in real time:

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

## 🍅 Multi-Crop Botanical Profiles (Smart Species Adaptation)

SYNTERRA automatically reconfigures autonomous watering thresholds, target VPD limits, and photoperiod goals based on the active crop:

| Species Preset | Scientific Name | Category | Temp Target | Moisture Target | Auto-Watering Trigger | Target DLI | Optimal VPD |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **🍅 Tomato** | *Solanum lycopersicum* | Fruiting Solanaceae | $20–26^\circ\text{C}$ | $50–70\%$ | **$45\%$** | $16.0\text{ mol/m}^2/\text{d}$ | $0.8–1.2\text{ kPa}$ |
| **🌿 Sweet Basil** | *Ocimum basilicum* | Culinary Herb | $20–25^\circ\text{C}$ | $60–80\%$ | **$55\%$** | $12.0\text{ mol/m}^2/\text{d}$ | $0.7–1.1\text{ kPa}$ |
| **🍓 Strawberry** | *Fragaria × ananassa* | Berry Crop | $18–24^\circ\text{C}$ | $55–70\%$ | **$50\%$** | $14.0\text{ mol/m}^2/\text{d}$ | $0.6–1.0\text{ kPa}$ |
| **🥬 Lettuce** | *Lactuca sativa* | Leafy Green | $15–21^\circ\text{C}$ | $65–85\%$ | **$60\%$** | $10.0\text{ mol/m}^2/\text{d}$ | $0.5–0.9\text{ kPa}$ |
| **🌵 Succulent** | *Aloe barbadensis* | Xerophytic Succulent | $21–32^\circ\text{C}$ | $15–35\%$ | **$18\%$** | $18.0\text{ mol/m}^2/\text{d}$ | $1.2–1.6\text{ kPa}$ |
| **🪴 Monstera** | *Monstera deliciosa* | Tropical Aroid | $20–28^\circ\text{C}$ | $40–60\%$ | **$35\%$** | $8.0\text{ mol/m}^2/\text{d}$ | $0.6–1.0\text{ kPa}$ |

---

## ☀️ Daily Light Integral (DLI) & Photoperiod Accumulator Engine

Rather than evaluating instantaneous Lux in isolation, SYNTERRA tracks **Daily Light Integral (DLI)**—the cumulative photosynthetic photon flux delivered over a 24-hour cycle:

$$\text{PPFD} \approx \frac{\text{Lux}}{54} \quad (\mu\text{mol} \cdot \text{m}^{-2} \cdot \text{s}^{-1})$$

$$\text{DLI} = \sum_{i} \left( \text{PPFD}_i \times \Delta t_i \right) \times 10^{-6} \quad (\text{mol} \cdot \text{m}^{-2} \cdot \text{d}^{-1})$$

* **Photoperiod Tracker:** Continuously integrates active daylight duration ($\text{Lux} \ge 200$) vs. species target photoperiod.
* **Photometric Gauge:** Displays real-time progress toward the crop's daily photon quota ($16\text{ mol/m}^2/\text{d}$ for Tomato).

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
| `/api/sensors/dli` | `GET` | **Calculate cumulative Daily Light Integral (DLI) & photoperiod** |
| `/api/crops/profiles` | `GET` | List botanical species presets with custom targets |
| `/api/crops/active` | `GET/POST`| Get or switch active crop preset (auto-calibrates irrigation) |
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
