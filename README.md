# SYNTERRA
### Agricultural Intelligence &mdash; Plant Disease Detection & Autonomous Monitoring

**Engineering Intelligence for a Growing World.**

Minimal, production-ready Flask backend with **real Kindwise crop.health / Plant.id API** disease detection, ESP32-S3 sensor client firmware, and USB serial telemetry ingestion.

## Quick Start

```powershell
# Clone
git clone https://github.com/sam-black007/SYNTERRA.git
cd SYNTERRA

# Create virtual environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# Install dependencies
pip install -r requirements.txt

# Configure API key
copy .env.example .env
# Edit .env and configure your PLANT_API_KEY and DEVICE_TOKEN

## Quick Start (One-Click)

On Windows, double-click **`start.bat`** (or run `.\start.ps1` in PowerShell). It automatically checks the virtual environment, starts the server, and opens your browser to the Live Console.

### Or Run with Docker:
```bash
docker compose up -d --build
```
Open `http://localhost:5000/dashboard`

```powershell
# Manual Start:
git clone https://github.com/sam-black007/SYNTERRA.git
cd SYNTERRA
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
python run.py
```

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/dashboard` | GET | **React + WebSocket Real-Time Laboratory Console** |
| `/` | GET | Classic dashboard with recent diagnoses |
| `/pathology` | GET/POST | Upload leaf image for real disease detection |
| `/diagnosis/<id>` | GET | View saved diagnosis result |
| `/integrations` | GET | Configure & test Plant.id API key |
| `/api/health` | GET | Health check |
| `/api/integrations/plantid/status` | GET | Check if API key is configured |
| `/api/integrations/plantid/test` | POST | Validate API key (no credits consumed) |
| `/api/diagnose` | POST | Upload image → real Plant.id diagnosis |
| `/api/diagnoses` | GET | List all saved diagnoses |
| `/api/diagnosis/<id>` | GET | Get single diagnosis as JSON |
| `/api/diagnosis/<id>/pdf` | GET | **Download Official PDF Pathology Dossier with Treatment Advisory** |
| `/api/sensors/telemetry` | POST | Ingest ESP32 telemetry (`X-Device-Token` auth) |
| `/api/sensors/latest` | GET | Get most recent sensor reading |
| `/api/sensors/history` | GET | Get historical sensor readings (`?limit=50`) |
| `/api/sensors/export/csv` | GET | Download complete telemetry history as CSV |
| `/api/camera/stream` | GET | Live MJPEG optical stream with HUD overlay |
| `/api/camera/capture` | POST | Snap camera frame & run Kindwise AI diagnosis |
| `/api/irrigation/status` | GET | Live pump state, countdown & safety watchdog |
| `/api/irrigation/manual` | POST | Execute manual irrigation (5s–30s) |
| `/api/irrigation/emergency_stop` | POST | Instant safety emergency cutoff |
| `/api/irrigation/auto_config` | POST | Configure autonomous soil threshold rules |

## Real-Time React Dashboard

Built with React 18, Vite, Tailwind CSS, Recharts, and Flask-SocketIO:
- **Live WebSocket Streaming**: Metrics update automatically as telemetry packets arrive over USB Serial or HTTP.
- **Dynamic Gauges**: Air Temperature, Relative Humidity, Soil Moisture (FC-28), Ambient Light (BH1750), and Reservoir Interlock Status.
- **Dual Time-Series Charts**: Micro-climate curves and root-zone/photometrics tracking.
- Access directly at: **`http://localhost:5000/dashboard`**

## Hardware & Telemetry Bridge

### 1. ESP32-S3 Sensor Client Firmware
Located at `firmware/ESP32_Sensor_Client/ESP32_Sensor_Client.ino`:
- **DHT11**: Temperature & humidity on GPIO 2
- **BH1750**: Ambient light (lux) on I2C (SDA GPIO 4, SCL GPIO 5)
- **FC-28**: Soil moisture on GPIO 1 (Analog AO) and GPIO 40 (DO)
- **Water Reservoir Switch**: GPIO 41
- Emits structured JSON strings over Serial at 115200 baud every 10 seconds.
- Built-in `SIMULATION_MODE` toggle for bench testing without attached hardware.

### 2. ESP32-S3 Camera Server Firmware
Located at `firmware/ESP32_S3_Camera_Server/ESP32_S3_Camera_Server.ino` & `camera_pins.h`:
- **Supported Hardware**: Freenove ESP32-S3 WROOM CAM, Seeed Xiao ESP32S3 Sense, ESP32-S3-EYE, and AI-Thinker OV2640/OV3660/OV5640.
- **Endpoints**:
  - `http://<ESP32_IP>/stream` &mdash; High-performance MJPEG live stream.
  - `http://<ESP32_IP>/capture` &mdash; High-resolution JPEG snapshot for Kindwise AI disease detection.
- **Arduino IDE Settings**:
  - Board: *ESP32S3 Dev Module*
  - PSRAM: *OPI PSRAM* (or *QSPI PSRAM* for Xiao Sense) &mdash; **MUST BE ENABLED!**
  - Partition Scheme: *Huge APP (3MB No OTA)*

### 3. ESP32-S3 All-in-One Unified Station (Single Board Mode)
Located at `firmware/ESP32_S3_Unified_Station/ESP32_S3_Unified_Station.ino` & `camera_pins.h`:
- **The Ultimate Single-Code Solution**: Runs BOTH the live optical video stream (`/stream`), high-resolution leaf capture (`/capture`), and the environmental sensor readings (DHT11, light, soil moisture, water level) simultaneously on one ESP32-S3 board!
- **Zero-Conflict Pin Routing**:
  - DHT11: GPIO 42 (or GPIO 1 on Xiao Sense)
  - FC-28 Soil Moisture: GPIO 1 (ADC1_CH0)
  - Water Level Switch: GPIO 41
  - BH1750 Light: I2C (SDA GPIO 21, SCL GPIO 47)
- **Pre-Configured Wi-Fi**: Mobile Hotspot `jj` / `123456789`.
- **Auto-Discovery**: Resolves at `http://synterra-cam.local` and auto-registers with the laptop server gateway.

### 4. Serial Bridge
Run the Python serial bridge to forward ESP32 USB telemetry directly into the Flask API:
```powershell
# Auto-detects connected ESP32 COM port and forwards telemetry
python scripts/serial_bridge.py

# Or test without hardware in synthetic mock mode:
python scripts/serial_bridge.py --mock
```

## Testing & System Verification

Run full-stack monitoring checks against your live running server:
```powershell
# 1. Full-stack system health & endpoint latency check
python scripts/monitor_test.py

# 2. End-to-end real image diagnosis with Kindwise Crop.health API
python scripts/test_live_image.py
```

## Getting a Plant.id / Crop.health API Key

1. Sign up at [plant.id](https://plant.id) or [kindwise.com](https://kindwise.com)
2. Create an API key in your Kindwise dashboard
3. Add it to `.env`: `PLANT_API_KEY=your_key_here`
4. Test the connection at `/integrations` or `POST /api/integrations/plantid/test`

## Tech Stack

- Flask 3 + Flask-SQLAlchemy + Flask-WTF
- python-dotenv, requests, Pillow, pyserial
- SQLite database (`instance/plant_doctor.db`)
- ESP32-S3 Arduino C++ firmware

---

**SYNTERRA — Engineering Intelligence for a Growing World.**
