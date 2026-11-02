import base64
import io
import time
import requests
from PIL import Image
from flask import current_app


class PlantIdClient:
    """Client for crop.health / Plant.id API v1 (kindwise.com)."""

    def __init__(self, api_key=None, base_url=None):
        self.api_key = api_key or current_app.config.get('PLANT_API_KEY', '')
        # Crop.health API v1 endpoint
        self.base_url = (base_url or current_app.config.get(
            'PLANT_API_BASE_URL', 'https://crop.kindwise.com/api/v1'
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
            # Submit a tiny 1x1 pixel test image to validate key
            img = Image.new('RGB', (1, 1), color='green')
            buf = io.BytesIO()
            img.save(buf, format='JPEG')
            img_bytes = buf.getvalue()

            url = f'{self.base_url}/identification'
            headers = {'Api-Key': self.api_key}
            files = {'images': ('test.jpg', img_bytes, 'image/jpeg')}
            resp = requests.post(url, headers=headers, files=files, timeout=15)

            if resp.status_code == 201:
                return {
                    'success': True,
                    'status': 'configured',
                    'message': 'Plant.id API key is valid',
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
        """Send an image to crop.health API v1 for disease identification.

        Uses asynchronous two-step flow:
        1. POST /identification → returns access_token
        2. GET /identification/{token} → poll until finished

        Returns (success, result_dict).
        """
        if not self.is_configured():
            return False, {
                'error': 'API_KEY_MISSING',
                'message': 'Plant.id API key is not configured.',
            }

        try:
            # Step 1: Submit image
            url = f'{self.base_url}/identification'
            headers = {'Api-Key': self.api_key}
            files = {'images': (filename, image_bytes, 'image/jpeg')}
            data = {}
            if plant_details:
                data['plant_details'] = 'true'

            resp = requests.post(url, headers=headers, files=files, data=data, timeout=30)

            if resp.status_code == 401:
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
            elif resp.status_code != 201:
                return False, {
                    'error': 'API_ERROR',
                    'message': f'Plant.id API returned status {resp.status_code}: {resp.text[:200]}',
                }

            submit_data = resp.json()
            access_token = submit_data.get('access_token')
            if not access_token:
                return False, {
                    'error': 'NO_TOKEN',
                    'message': 'No access token returned from Plant.id API.',
                }

            # Step 2: Poll for results
            result_url = f'{self.base_url}/identification/{access_token}'
            for _ in range(30):  # Poll up to 60 seconds
                time.sleep(2)
                result_resp = requests.get(result_url, headers=headers, timeout=15)

                if result_resp.status_code == 200:
                    result_data = result_resp.json()
                    if result_data.get('finished'):
                        return True, result_data
                elif result_resp.status_code == 404:
                    return False, {
                        'error': 'NOT_FOUND',
                        'message': 'Identification result not found.',
                    }

            return False, {
                'error': 'TIMEOUT',
                'message': 'Plant.id identification timed out.',
            }

        except requests.RequestException as e:
            return False, {
                'error': 'NETWORK_ERROR',
                'message': f'Cannot reach Plant.id API: {str(e)}',
            }