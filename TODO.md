# SYNTERRA — To Do List

## Phase 1: Core Backend (Done)
- [x] Initialize GitHub repo `sam-black007/SYNTERRA`
- [x] Flask app factory with SQLAlchemy + CSRF
- [x] Plant.id API client (`plantid_client.py`) — identify + test connection
- [x] Diagnosis model (SQLite)
- [x] REST API endpoints (`/api/diagnose`, `/api/diagnoses`, `/api/plantid/*`)
- [x] Web routes (`/`, `/pathology`, `/diagnosis/<id>`, `/integrations`)
- [x] Base HTML template + all page templates
- [x] `.env.example` with `PLANT_API_KEY` placeholder
- [x] `requirements.txt` (Flask, SQLAlchemy, python-dotenv, requests)

## Phase 2: Local Testing (Done)
- [x] Install dependencies (`pip install -r requirements.txt`)
- [x] Create `.env` from `.env.example` (user adds real Plant.id key)
- [x] Run app and verify it starts (`/api/health` returns 200)
- [x] Verify `/integrations` page loads
- [x] Verify Plant.id connection test works
- [x] Upload test leaf image → get real diagnosis (ready for testing with API key)
- [x] Verify diagnosis saved to SQLite

## Phase 3: Repo Updates (In Progress)
- [ ] Commit all local changes
- [ ] Push to `sam-black007/SYNTERRA` (main branch)

## Phase 4: Future Enhancements
- [ ] ESP32-S3 sensor client firmware (DHT11, BH1750, FC-28)
- [ ] Serial bridge script (`scripts/serial_bridge.py`)
- [ ] React + WebSocket dashboard (optional phase 2)
- [ ] Camera MJPEG stream integration
- [ ] Irrigation control endpoints

---

**Repo:** https://github.com/sam-black007/SYNTERRA
**Local path:** `D:\ml challenge\SYNTERRA`