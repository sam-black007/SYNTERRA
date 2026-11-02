import base64
import requests
from flask import current_app


class PlantIdClient:
    """Client for Plant.id API v3 (kindwise.com / plant.id)."""

    def __init__(self, api_key=None, base_url=None):
        self.api_key = api_key or current_app.config.get('PLANT_API_KEY', '')
        # Plant.id API v3 endpoint
        self.base_url = (base_url or current_app.config.get(
            'PLANT_API_BASE_URL', 'https://plant.id/api/v3'
        )).rstrip('/')

    def is_configured(self):
        return bool(self.api_key)

    def get_masked_key(self):
        if not self.api_key:
            return 'NOT CONFIGURED'
        if len(self.api_key) <= 8:
            return '***'
        return self.api_key[:4] + '*' * (len(self.api_key) - 8) + self.api_key[-4:]

    def test_connection(self):
        """Test API key without consuming identification credits."""
        if not self.is_configured():
            return {
                'success': False,
                'status': 'unconfigured',
                'message': 'Plant.id API key is not configured. Set PLANT_API_KEY in .env',
            }

        try:
            # Plant.id v3 usage_info endpoint validates key without spending credits
            url = f'{self.base_url}/usage_info'
            headers = {'Api-Key': self.api_key}
            resp = requests.get(url, headers=headers, timeout=15)

            if resp.status_code == 200:
                data = resp.json()
                return {
                    'success': True,
                    'status': 'configured',
                    'message': 'Plant.id API key is valid',
                    'usage': data,
                }
            elif resp.status_code == 401:
                return {
                    'success': False,
                    'status': 'invalid_key',
                    'message': 'Invalid Plant.id API key',
                }
            else:
                return {
                    'success': False,
                    'status': 'error',
                    'message': f'API returned status {resp.status_code}',
                }
        except requests.RequestException as e:
            return {
                'success': False,
                'status': 'network_error',
                'message': f'Cannot reach Plant.id API: {str(e)}',
            }

    def identify(self, image_bytes, filename='leaf.jpg', plant_details=True):
        """Send an image to Plant.id v3 for disease identification.

        Plant.id v3 expects JSON body with base64-encoded images.
        Returns (success, result_dict).
        """
        if not self.is_configured():
            return False, {
                'error': 'API_KEY_MISSING',
                'message': 'Plant.id API key is not configured.',
            }

        try:
            # Encode image as base64
            image_b64 = base64.b64encode(image_bytes).decode('utf-8')

            url = f'{self.base_url}/identify'
            headers = {
                'Api-Key': self.api_key,
                'Content-Type': 'application/json',
            }

            # Plant.id v3 JSON request format
            payload = {
                'images': [image_b64],
            }
            if plant_details:
                payload['plant_details'] = [
                    'common_names',
                    'url',
                    'wiki_description',
                    'taxonomy',
                    'synonyms',
                ]

            resp = requests.post(url, headers=headers, json=payload, timeout=30)

            if resp.status_code == 200:
                return True, resp.json()
            elif resp.status_code == 401:
                return False, {
                    'error': 'INVALID_KEY',
                    'message': 'Invalid Plant.id API key.',
                }
            elif resp.status_code == 402:
                return False, {
                    'error': 'QUOTA_EXCEEDED',
                    'message': 'Plant.id API quota exceeded.',
                }
            elif resp.status_code == 429:
                return False, {
                    'error': 'RATE_LIMITED',
                    'message': 'Plant.id API rate limit exceeded. Try again later.',
                }
            else:
                return False, {
                    'error': 'API_ERROR',
                    'message': f'Plant.id API returned status {resp.status_code}: {resp.text[:500]}',
                }
        except requests.RequestException as e:
            return False, {
                'error': 'NETWORK_ERROR',
                'message': f'Cannot reach Plant.id API: {str(e)}',
            }