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

# Run the Flask backend
python run.py
```

Open `http://localhost:5000`

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
| `/api/sensors/telemetry` | POST | Ingest ESP32 telemetry (`X-Device-Token` auth) |
| `/api/sensors/latest` | GET | Get most recent sensor reading |
| `/api/sensors/history` | GET | Get historical sensor readings (`?limit=50`) |

## Real-Time React Dashboard

Built with React 18, Vite, Tailwind CSS, Recharts, and Flask-SocketIO:
- **Live WebSocket Streaming**: Metrics update automatically as telemetry packets arrive over USB Serial or HTTP.
- **Dynamic Gauges**: Air Temperature, Relative Humidity, Soil Moisture (FC-28), Ambient Light (BH1750), and Reservoir Interlock Status.
- **Dual Time-Series Charts**: Micro-climate curves and root-zone/photometrics tracking.
- Access directly at: **`http://localhost:5000/dashboard`**

## Hardware & Telemetry Bridge

### 1. ESP32-S3 Firmware
Located at `firmware/ESP32_Sensor_Client/ESP32_Sensor_Client.ino`:
- **DHT11**: Temperature & humidity on GPIO 2
- **BH1750**: Ambient light (lux) on I2C (SDA GPIO 4, SCL GPIO 5)
- **FC-28**: Soil moisture on GPIO 1 (Analog AO) and GPIO 40 (DO)
- **Water Reservoir Switch**: GPIO 41
- Emits structured JSON strings over Serial at 115200 baud every 10 seconds.
- Built-in `SIMULATION_MODE` toggle for bench testing without attached hardware.

### 2. Serial Bridge
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
