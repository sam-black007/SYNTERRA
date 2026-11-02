# SYNTERRA
### Agricultural Intelligence &mdash; Plant Disease Detection

**Engineering Intelligence for a Growing World.**

Minimal, production-ready Flask backend with **real Plant.id API** disease detection. No demo mode, no simulated diagnoses &mdash; every result comes from the Plant.id / Kindwise crop.health API.

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
# Edit .env and add your Plant.id API key: PLANT_API_KEY=your_key_here

# Run
python run.py
```

Open `http://localhost:5000`

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Dashboard with recent diagnoses |
| `/pathology` | GET/POST | Upload leaf image for real disease detection |
| `/diagnosis/<id>` | GET | View saved diagnosis result |
| `/integrations` | GET | Configure & test Plant.id API key |
| `/api/health` | GET | Health check |
| `/api/integrations/plantid/status` | GET | Check if API key is configured |
| `/api/integrations/plantid/test` | POST | Validate API key (no credits consumed) |
| `/api/diagnose` | POST | Upload image → real Plant.id diagnosis |
| `/api/diagnoses` | GET | List all saved diagnoses |
| `/api/diagnosis/<id>` | GET | Get single diagnosis as JSON |

## Getting a Plant.id API Key

1. Sign up at [plant.id](https://plant.id) or [kindwise.com](https://kindwise.com)
2. Create an API key in your dashboard
3. Add it to `.env`: `PLANT_API_KEY=your_key_here`
4. Test the connection at `/integrations`

## Tech Stack

- Flask 3 + Flask-SQLAlchemy + Flask-WTF
- python-dotenv, requests
- SQLite database
- Vanilla HTML/CSS (no build step)

## What's Included

- Real Plant.id disease identification (no fakes)
- API key validation without consuming credits
- Diagnosis history stored in SQLite
- Image upload + result display
- Raw API response saved for debugging

---

**SYNTERRA — Engineering Intelligence for a Growing World.**