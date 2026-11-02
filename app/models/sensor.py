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

    @property
    def light_condition(self):
        if self.light_lux is None or self.light_lux < 0:
            return "Sensor Offline"
        lux = self.light_lux
        if lux < 25:
            return "Night / Dark"
        elif lux < 200:
            return "Dim / Twilight"
        elif lux < 1000:
            return "Cloudy / Overcast"
        elif lux < 10000:
            return "Daylight / Partly Cloudy"
        elif lux < 25000:
            return "Sunny / Clear Sky"
        else:
            return "Intense Sunlight"

    @property
    def soil_condition(self):
        if self.soil_moisture_pct is None:
            return "Offline"
        sm = self.soil_moisture_pct
        if sm < 20:
            return "Critical Dry (Drought)"
        elif sm < 40:
            return "Dry (Water Needed)"
        elif sm <= 75:
            return "Optimal Root Moisture"
        elif sm <= 90:
            return "Wet / Saturated"
        else:
            return "Waterlogged"

    @property
    def temp_condition(self):
        if self.temperature_c is None:
            return "Offline"
        t = self.temperature_c
        if t < 16:
            return "Cold"
        elif t < 22:
            return "Mild / Cool"
        elif t <= 28:
            return "Optimal Plant Temp"
        elif t <= 34:
            return "Warm"
        else:
            return "Extreme Heat"

    @property
    def humidity_condition(self):
        if self.humidity_pct is None:
            return "Offline"
        h = self.humidity_pct
        if h < 35:
            return "Arid / Dry Air"
        elif h <= 65:
            return "Ideal Canopy Humidity"
        elif h <= 80:
            return "High Humidity"
        else:
            return "Saturated / Sultry"

    @property
    def climate_summary(self):
        lux = self.light_lux if self.light_lux is not None else 0
        temp = self.temperature_c if self.temperature_c is not None else 24
        hum = self.humidity_pct if self.humidity_pct is not None else 50
        
        if lux < 25:
            return "Night (Dark & Resting)"
        elif lux >= 10000:
            if temp >= 28:
                return "Hot & Sunny"
            return "Bright & Sunny"
        elif lux >= 1000:
            if hum >= 75:
                return "Humid & Partly Cloudy"
            return "Partly Cloudy & Pleasant"
        elif lux >= 200:
            if hum >= 75:
                return "Overcast & Rainy/Humid"
            return "Cloudy / Overcast"
        else:
            return "Dim / Low Light"

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
            'light_condition': self.light_condition,
            'soil_condition': self.soil_condition,
            'temp_condition': self.temp_condition,
            'humidity_condition': self.humidity_condition,
            'climate_summary': self.climate_summary,
            'timestamp': self.timestamp.isoformat() if self.timestamp else None,
        }
