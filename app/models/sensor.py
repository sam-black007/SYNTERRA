from datetime import datetime, timezone
from app import db


class SensorReading(db.Model):
    __tablename__ = 'sensor_readings'

    id = db.Column(db.Integer, primary_key=True)
    device_id = db.Column(db.String(50), nullable=False, default='esp32-sensor-01')
    plant_id = db.Column(db.String(50), nullable=True)
    temperature_c = db.Column(db.Float, nullable=True)
    humidity_pct = db.Column(db.Float, nullable=True)
    light_lux = db.Column(db.Float, nullable=True)
    soil_moisture_pct = db.Column(db.Float, nullable=True)
    soil_raw_adc = db.Column(db.Integer, nullable=True)
    water_reservoir_ok = db.Column(db.Boolean, default=True, nullable=True)
    timestamp = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), index=True)

    def to_dict(self):
        return {
            'id': self.id,
            'device_id': self.device_id,
            'plant_id': self.plant_id,
            'temperature_c': round(self.temperature_c, 2) if self.temperature_c is not None else None,
            'humidity_pct': round(self.humidity_pct, 2) if self.humidity_pct is not None else None,
            'light_lux': round(self.light_lux, 2) if self.light_lux is not None else None,
            'soil_moisture_pct': round(self.soil_moisture_pct, 2) if self.soil_moisture_pct is not None else None,
            'soil_raw_adc': self.soil_raw_adc,
            'water_reservoir_ok': self.water_reservoir_ok,
            'timestamp': self.timestamp.isoformat() if self.timestamp else None,
        }
