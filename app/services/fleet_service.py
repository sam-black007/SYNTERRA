"""
SYNTERRA — Multi-Zone Greenhouse Fleet Management Service
Manages distributed multi-node hardware topology across multiple greenhouse bays,
hydroponic racks, and propagation nurseries.
"""

from app.models.sensor import SensorReading
from app.services.crop_profiles import CROP_PROFILES


class FleetManagementService:
    def __init__(self):
        self.active_zone_id = 'zone-1'
        self.zones = {
            'zone-1': {
                'id': 'zone-1',
                'name': 'Canopy Bay Alpha (Live Hardware Node)',
                'device_id': 'esp32-hardware-node',
                'type': 'Physical MCU (USB-C ESP32)',
                'crop_key': 'tomato',
                'location': 'Main Cultivation Bench',
                'status': 'ONLINE',
                'is_physical': True
            },
            'zone-2': {
                'id': 'zone-2',
                'name': 'Propagation Nursery',
                'device_id': 'esp32-nursery-node',
                'type': 'Precision Microclimate Node',
                'crop_key': 'basil',
                'location': 'Nursery Rack Tier 2',
                'status': 'ONLINE',
                'is_physical': False
            },
            'zone-3': {
                'id': 'zone-3',
                'name': 'Hydroponic NFT Gutter',
                'device_id': 'esp32-hydro-node',
                'type': 'Nutrient Film Channel Node',
                'crop_key': 'lettuce',
                'location': 'Hydroponic Channel A',
                'status': 'ONLINE',
                'is_physical': False
            }
        }

    def get_all_zones(self, latest_telemetry=None):
        """Returns all configured zones with active crop profile & live metrics."""
        result = []
        for zid, z in self.zones.items():
            crop = CROP_PROFILES.get(z['crop_key'], CROP_PROFILES['tomato'])
            if zid == 'zone-1' and latest_telemetry:
                telem = {
                    'temperature_c': latest_telemetry.get('temperature_c', 24.2),
                    'humidity_pct': latest_telemetry.get('humidity_pct', 62.0),
                    'soil_moisture_pct': latest_telemetry.get('soil_moisture_pct', 55.0),
                    'light_lux': latest_telemetry.get('light_lux', 1250),
                }
            elif zid == 'zone-2':
                telem = {
                    'temperature_c': 23.1,
                    'humidity_pct': 68.5,
                    'soil_moisture_pct': 62.0,
                    'light_lux': 850,
                }
            else:
                telem = {
                    'temperature_c': 19.4,
                    'humidity_pct': 72.0,
                    'soil_moisture_pct': 68.0,
                    'light_lux': 620,
                }

            result.append({
                **z,
                'is_active': (zid == self.active_zone_id),
                'crop_name': crop['name'],
                'crop_icon': crop['icon'],
                'telemetry': telem,
                'target_moisture_pct': crop['watering_threshold_pct']
            })
        return result

    def set_active_zone(self, zone_id):
        """Switches active console zone."""
        if zone_id in self.zones:
            self.active_zone_id = zone_id
            return True, self.zones[zone_id]
        return False, None


fleet_service = FleetManagementService()
