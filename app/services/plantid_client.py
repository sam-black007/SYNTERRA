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
        """Test API key without consuming identification credits using /usage_info."""
        if not self.is_configured():
            return {
                'success': False,
                'status': 'unconfigured',
                'message': 'Plant.id / Kindwise API key is not configured. Set PLANT_API_KEY in .env',
            }

        try:
            url = f'{self.base_url}/usage_info'
            headers = {'Api-Key': self.api_key}
            resp = requests.get(url, headers=headers, timeout=10)

            if resp.status_code == 200:
                data = resp.json()
                remaining = data.get('remaining', {}).get('total')
                return {
                    'success': True,
                    'status': 'configured',
                    'message': f'API key is valid ({remaining} credits remaining)' if remaining is not None else 'API key is valid',
                    'usage': data,
                }
            elif resp.status_code == 401:
                return {
                    'success': False,
                    'status': 'invalid_key',
                    'message': 'Invalid API key.',
                }
            else:
                return {
                    'success': False,
                    'status': 'error',
                    'message': f'API returned status {resp.status_code}: {resp.text[:150]}',
                }
        except requests.RequestException as e:
            return {
                'success': False,
                'status': 'network_error',
                'message': f'Cannot reach Kindwise API: {str(e)}',
            }

    def identify(self, image_bytes, filename='leaf.jpg'):
        """Send an image to crop.health API v1 for disease identification.

        Handles both synchronous (immediate result) and asynchronous (polling)
        Kindwise crop.health responses.

        Returns (success, result_dict).
        """
        if not self.is_configured():
            return False, {
                'error': 'API_KEY_MISSING',
                'message': 'Plant.id / Kindwise API key is not configured.',
            }

        try:
            # Step 1: Submit image
            url = f'{self.base_url}/identification'
            headers = {'Api-Key': self.api_key}
            files = {'images': (filename, image_bytes, 'image/jpeg')}
            data = {'similar_images': 'true'}

            resp = requests.post(url, headers=headers, files=files, data=data, timeout=30)

            if resp.status_code == 401:
                return False, {
                    'error': 'INVALID_KEY',
                    'message': 'Invalid Kindwise API key.',
                }
            elif resp.status_code == 402:
                return False, {
                    'error': 'QUOTA_EXCEEDED',
                    'message': 'Kindwise API quota exceeded.',
                }
            elif resp.status_code == 429:
                return False, {
                    'error': 'RATE_LIMITED',
                    'message': 'Kindwise API rate limit exceeded. Try again later.',
                }
            elif resp.status_code not in (200, 201):
                return False, {
                    'error': 'API_ERROR',
                    'message': f'Kindwise API returned status {resp.status_code}: {resp.text[:200]}',
                }

            submit_data = resp.json()

            # Fast path: If result is returned immediately (synchronous default)
            if submit_data.get('status') == 'COMPLETED' or submit_data.get('result') is not None:
                return True, submit_data

            access_token = submit_data.get('access_token')
            if not access_token:
                return False, {
                    'error': 'NO_TOKEN',
                    'message': 'No access token or result returned from Kindwise API.',
                }

            # Step 2: Poll for results (if queued asynchronously)
            result_url = f'{self.base_url}/identification/{access_token}'
            for _ in range(15):  # Poll up to 30 seconds
                time.sleep(1.5)
                result_resp = requests.get(result_url, headers=headers, timeout=15)

                if result_resp.status_code == 200:
                    result_data = result_resp.json()
                    # Kindwise status is "COMPLETED" and diagnosis is stored in "result"
                    if result_data.get('status') == 'COMPLETED' or result_data.get('result') is not None:
                        return True, result_data
                    elif result_data.get('status') == 'FAILED':
                        return False, {
                            'error': 'PROCESSING_FAILED',
                            'message': 'Kindwise analysis failed on this image.',
                        }
                elif result_resp.status_code == 404:
                    return False, {
                        'error': 'NOT_FOUND',
                        'message': 'Identification result not found.',
                    }

            return False, {
                'error': 'TIMEOUT',
                'message': 'Kindwise identification timed out.',
            }

        except requests.RequestException as e:
            return False, {
                'error': 'NETWORK_ERROR',
                'message': f'Cannot reach Kindwise API: {str(e)}',
            }