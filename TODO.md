# SYNTERRA — To Do List

## Phase 1: Core Backend (Done)
- [x] Initialize GitHub repo `sam-black007/SYNTERRA`
- [x] Flask app factory with SQLAlchemy + CSRF
- [x] Plant.id API client (`plantid_client.py`) — identify + test connection
- [x] Diagnosis model (SQLite)
- [x] REST API endpoints (`/api/diagnose`, `/api/diagnoses`, `/api/plantid/*`)
- [x] CSRF exemption for API blueprint
- [x] CSRF token in web forms
- [x] Web routes (`/`, `/pathology`, `/diagnosis/<id>`, `/integrations`)
- [x] Base HTML template + all page templates
- [x] `.env.example` with `PLANT_API_KEY` placeholder
- [x] `requirements.txt` (Flask, SQLAlchemy, python-dotenv, requests)

## Phase 2: Local Testing (Done)
- [x] Install dependencies
- [x] Configure `.env` with real Plant.id key (not committed to GitHub)
- [x] Verify app starts (`/api/health` returns 200)
- [x] Verify Plant.id connection test works (64 credits remaining)
- [x] Verify CSRF fix — API endpoints work, web forms protected
- [x] Ready for image upload diagnosis testing

## Phase 3: Repo Updates (Done)
- [x] Commit all local changes
- [x] Push to `sam-black007/SYNTERRA` (main branch)

## Phase 4: Future Enhancements
- [ ] ESP32-S3 sensor client firmware (DHT11, BH1750, FC-28)
- [ ] Serial bridge script (`scripts/serial_bridge.py`)
- [ ] React + WebSocket dashboard
- [ ] Camera MJPEG stream integration
- [ ] Irrigation control endpoints

---

**Repo:** https://github.com/sam-black007/SYNTERRA
**Local path:** `D:\ml challenge\SYNTERRA`
**API Key:** Configured locally in `.env` (gitignored, 64 credits remaining)