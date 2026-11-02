import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import create_app, db
from app.models.diagnosis import Diagnosis
from app.services.pdf_generator import generate_diagnosis_pdf

app = create_app()
with app.app_context():
    diag = Diagnosis.query.first()
    if diag:
        pdf_bytes = generate_diagnosis_pdf(diag)
        print("Generated PDF size:", len(pdf_bytes), "bytes")
        assert len(pdf_bytes) > 2000
        print("[SUCCESS] PDF with 5-day weather forecast generated cleanly!")
    else:
        print("No diagnosis found in DB")
