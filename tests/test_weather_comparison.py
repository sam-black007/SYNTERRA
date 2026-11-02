"""
Unit Tests for Sensor vs. Meteorological Ground-Truth Cross-Check & Comparison
"""

import sys
import unittest
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import create_app
from app.services.weather_service import weather_service


class TestWeatherComparison(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()

    def test_fetch_current_weather(self):
        """Test fetching real-time ambient weather station reference."""
        curr = weather_service.fetch_current_weather()
        self.assertTrue(curr['success'])
        self.assertIn('temperature_c', curr)
        self.assertIn('humidity_pct', curr)
        self.assertIn('provider', curr)

    def test_compare_sensor_to_weather_algorithm(self):
        """Test accuracy calculation and microclimate deviation algorithms."""
        # Simulated sensor: 26.0 C, 65.0 % RH
        res = weather_service.compare_sensor_to_weather(
            sensor_temp=26.0,
            sensor_humidity=65.0,
            device_id="esp32-test-node"
        )
        self.assertTrue(res['success'])
        self.assertIn('comparison', res)
        self.assertIn('composite_accuracy_pct', res['comparison'])
        self.assertIn('temp_accuracy_pct', res['comparison'])
        self.assertIn('humidity_accuracy_pct', res['comparison'])
        self.assertIn('calibration_status', res['comparison'])
        self.assertIn('insights', res['comparison'])

        # Verify score bounds
        score = res['comparison']['composite_accuracy_pct']
        self.assertGreaterEqual(score, 0.0)
        self.assertLessEqual(score, 100.0)

    def test_api_weather_compare_endpoint(self):
        """Test /api/weather/compare GET and POST endpoints."""
        # GET request
        r_get = self.client.get('/api/weather/compare')
        self.assertEqual(r_get.status_code, 200)
        data_get = r_get.get_json()
        self.assertTrue(data_get['success'])
        self.assertIn('sensor', data_get)
        self.assertIn('weather_station', data_get)

        # POST request with custom test telemetry
        payload = {
            'temperature_c': 25.5,
            'humidity_pct': 62.0,
            'device_id': 'esp32-custom-bench'
        }
        r_post = self.client.post('/api/weather/compare', json=payload)
        self.assertEqual(r_post.status_code, 200)
        data_post = r_post.get_json()
        self.assertTrue(data_post['success'])
        self.assertEqual(data_post['device_id'], 'esp32-custom-bench')
        self.assertEqual(data_post['sensor']['temperature_c'], 25.5)


if __name__ == '__main__':
    unittest.main()
