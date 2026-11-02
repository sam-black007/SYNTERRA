from datetime import datetime, timezone
from app import db


class Diagnosis(db.Model):
    __tablename__ = 'diagnoses'

    id = db.Column(db.Integer, primary_key=True)
    plant_name = db.Column(db.String(100), nullable=False, default='Unknown')
    disease_name = db.Column(db.String(200), nullable=True)
    confidence = db.Column(db.Float, nullable=True)
    image_url = db.Column(db.String(500), nullable=True)
    raw_response = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    def to_dict(self):
        return {
            'id': self.id,
            'plant_name': self.plant_name,
            'disease_name': self.disease_name,
            'confidence': self.confidence,
            'image_url': self.image_url,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }