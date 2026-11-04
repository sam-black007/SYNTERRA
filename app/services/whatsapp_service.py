"""
SYNTERRA — WhatsApp Agronomic Alert & Farm Notification Service
Supports CallMeBot API (instant free personal WhatsApp) and Twilio WhatsApp API
for critical drought triggers, reservoir dry-run watchdog alarms, and AI disease detections.
"""

import os
import time
import urllib.parse
import requests
import logging

logger = logging.getLogger('whatsapp_service')


class WhatsAppService:
    def __init__(self, phone=None, api_key=None, provider=None):
        self.phone = phone or os.getenv('WHATSAPP_PHONE')
        self.api_key = api_key or os.getenv('CALLMEBOT_API_KEY') or os.getenv('WHATSAPP_API_KEY')
        self.provider = provider or os.getenv('WHATSAPP_PROVIDER', 'callmebot')  # 'callmebot' | 'twilio'
        
        # Twilio optional credentials
        self.twilio_sid = os.getenv('TWILIO_ACCOUNT_SID')
        self.twilio_token = os.getenv('TWILIO_AUTH_TOKEN')
        self.twilio_from = os.getenv('TWILIO_WHATSAPP_FROM', 'whatsapp:+14155238886')

        self._last_alert_time = {}
        self._cooldown_seconds = 60  # prevent alert spamming

    @property
    def is_configured(self):
        phone = self.phone or os.getenv('WHATSAPP_PHONE')
        api_key = self.api_key or os.getenv('CALLMEBOT_API_KEY') or os.getenv('WHATSAPP_API_KEY')
        has_callmebot = bool(phone and api_key)
        has_twilio = bool(phone and self.twilio_sid and self.twilio_token)
        return has_callmebot or has_twilio

    def get_status(self):
        """Returns connection state and masked credentials."""
        phone = self.phone or os.getenv('WHATSAPP_PHONE')
        api_key = self.api_key or os.getenv('CALLMEBOT_API_KEY') or os.getenv('WHATSAPP_API_KEY')
        masked_phone = f"...{phone[-4:]}" if phone and len(phone) >= 4 else None
        
        return {
            'success': True,
            'configured': self.is_configured,
            'provider': self.provider,
            'phone_masked': masked_phone,
            'mode': 'LIVE' if self.is_configured else 'SIMULATED STANDBY',
            'callmebot_ready': bool(phone and api_key),
            'twilio_ready': bool(phone and self.twilio_sid and self.twilio_token)
        }

    def send_message(self, text):
        """
        Send a notification to WhatsApp.
        Falls back to clean simulation preview when credentials are not yet set.
        """
        phone = self.phone or os.getenv('WHATSAPP_PHONE')
        api_key = self.api_key or os.getenv('CALLMEBOT_API_KEY') or os.getenv('WHATSAPP_API_KEY')

        # 1. Simulation fallback if unconfigured
        if not self.is_configured:
            return {
                'success': True,
                'simulated': True,
                'provider': 'simulation',
                'message': 'WhatsApp alert in standby simulation (Set WHATSAPP_PHONE and CALLMEBOT_API_KEY in .env to go live)',
                'preview': text
            }

        # Clean phone format: ensure international digits
        clean_phone = phone.replace('+', '').replace(' ', '').replace('-', '').strip()

        # 2. CallMeBot Delivery
        if self.provider == 'callmebot' or api_key:
            try:
                encoded_msg = urllib.parse.quote(text)
                url = f"https://api.callmebot.com/whatsapp.php?phone={clean_phone}&text={encoded_msg}&apikey={api_key}"
                resp = requests.get(url, timeout=10.0)
                
                # CallMeBot returns HTTP 200 with HTML or message confirmation
                success = (resp.status_code == 200) and ("Message queued" in resp.text or "ok" in resp.text.lower())
                return {
                    'success': resp.status_code == 200,
                    'simulated': False,
                    'provider': 'callmebot',
                    'status_code': resp.status_code,
                    'response': resp.text[:200]
                }
            except Exception as e:
                logger.error(f"CallMeBot WhatsApp dispatch error: {e}")
                return {'success': False, 'error': str(e), 'simulated': False}

        # 3. Twilio Delivery
        if self.twilio_sid and self.twilio_token:
            try:
                from twilio.rest import Client
                client = Client(self.twilio_sid, self.twilio_token)
                dest = f"whatsapp:+{clean_phone}" if not clean_phone.startswith('whatsapp:') else clean_phone
                msg = client.messages.create(
                    from_=self.twilio_from,
                    to=dest,
                    body=text
                )
                return {
                    'success': True,
                    'simulated': False,
                    'provider': 'twilio',
                    'sid': msg.sid
                }
            except Exception as e:
                logger.error(f"Twilio WhatsApp dispatch error: {e}")
                return {'success': False, 'error': str(e), 'simulated': False}

        return {'success': False, 'error': 'No valid WhatsApp provider configuration found.'}

    def send_drought_alert(self, soil_pct, threshold_pct, crop_name='Tomato'):
        """Dispatched when soil moisture drops below critical threshold."""
        now = time.time()
        last = self._last_alert_time.get('drought', 0)
        if (now - last) < self._cooldown_seconds:
            return {'success': True, 'suppressed': True, 'reason': 'Cooldown active'}

        self._last_alert_time['drought'] = now
        text = (
            f"🚨 *SYNTERRA CRITICAL ALERT*\n\n"
            f"🌱 *Crop:* {crop_name}\n"
            f"💧 *Soil Moisture:* {soil_pct:.1f}% (Critical threshold: {threshold_pct:.1f}%)\n"
            f"⚠️ *Status:* Severe Rhizosphere Desiccation\n"
            f"⚡ *Action:* Irrigation pulse armed & engaged.\n"
            f"🕒 _{time.strftime('%Y-%m-%d %H:%M:%S')}_"
        )
        return self.send_message(text)

    def send_reservoir_alert(self, crop_name='Tomato'):
        """Dispatched when reservoir float switch detects empty water supply."""
        now = time.time()
        last = self._last_alert_time.get('reservoir', 0)
        if (now - last) < self._cooldown_seconds:
            return {'success': True, 'suppressed': True, 'reason': 'Cooldown active'}

        self._last_alert_time['reservoir'] = now
        text = (
            f"⚠️ *SYNTERRA INTERLOCK TRIP*\n\n"
            f"🚫 *Water Reservoir Depleted!*\n"
            f"🌱 *Zone:* {crop_name}\n"
            f"🔒 *Interlock:* Solenoid cut to prevent dry-run motor burnout.\n"
            f"⚡ *Action Required:* Refill water tank immediately to restore automated drip cycles.\n"
            f"🕒 _{time.strftime('%Y-%m-%d %H:%M:%S')}_"
        )
        return self.send_message(text)

    def send_pathology_alert(self, crop_name, disease, confidence, active_ingredients=None):
        """Dispatched when computer vision identifies an infectious pathogen."""
        ingredients_str = ", ".join(active_ingredients) if active_ingredients else "Consult Agronomist"
        text = (
            f"🔬 *SYNTERRA AI PATHOLOGY ALERT*\n\n"
            f"🌱 *Specimen:* {crop_name}\n"
            f"🦠 *Diagnosis:* {disease}\n"
            f"📊 *Confidence:* {confidence:.1f}%\n"
            f"💊 *Remediation MOA:* {ingredients_str}\n"
            f"📄 Clinical Dossier recorded in database.\n"
            f"🕒 _{time.strftime('%Y-%m-%d %H:%M:%S')}_"
        )
        return self.send_message(text)

    def execute_command(self, cmd_text):
        """Executes 2-way remote farm command (/status, /water <sec>, /stop, /help)."""
        cmd_text = (cmd_text or '').strip()
        parts = cmd_text.split()
        cmd = parts[0].lower() if parts else '/help'

        if cmd == '/status':
            try:
                from app.models.sensor import SensorReading
                latest = SensorReading.query.order_by(SensorReading.timestamp.desc()).first()
                if latest:
                    return {
                        'success': True,
                        'command': cmd,
                        'reply': (
                            f"🌿 *SYNTERRA LIVE STATUS*\n"
                            f"🌡️ *Temperature:* {latest.temperature_c:.1f}°C\n"
                            f"💧 *Humidity:* {latest.humidity_pct:.1f}%\n"
                            f"🌱 *Soil Moisture:* {latest.soil_moisture_pct:.1f}%\n"
                            f"☀️ *Photometrics:* {latest.light_lux:.1f} Lux\n"
                            f"🕒 _{latest.timestamp.strftime('%H:%M:%S') if latest.timestamp else 'Live'}_"
                        )
                    }
            except Exception as e:
                pass
            return {
                'success': True,
                'command': cmd,
                'reply': "🌿 *SYNTERRA STATUS*: Microcontroller online, waiting for telemetry packet."
            }

        elif cmd.startswith('/water'):
            duration = 12
            if len(parts) > 1 and parts[1].isdigit():
                duration = min(30, max(3, int(parts[1])))
            try:
                from app.services.irrigation_controller import irrigation_manager
                success = irrigation_manager.trigger_manual_irrigation(duration)
                if success:
                    return {
                        'success': True,
                        'command': cmd,
                        'reply': f"⚡ *IRRIGATION ENGAGED*: Energizing solenoid pump for *{duration} seconds* on relay D27."
                    }
                else:
                    return {
                        'success': False,
                        'command': cmd,
                        'reply': "⚠️ *IRRIGATION BLOCKED*: Reservoir float switch reports dry, or safety interlock active."
                    }
            except Exception as e:
                return {'success': False, 'command': cmd, 'reply': f"Failed to pulse pump: {e}"}

        elif cmd == '/stop':
            try:
                from app.services.irrigation_controller import irrigation_manager
                irrigation_manager.emergency_stop()
                return {
                    'success': True,
                    'command': cmd,
                    'reply': "🛑 *EMERGENCY STOP ENGAGED*: Relay power cut in <100ms. Pump disabled."
                }
            except Exception as e:
                return {'success': False, 'command': cmd, 'reply': f"Emergency stop error: {e}"}

        else:
            return {
                'success': True,
                'command': cmd,
                'reply': (
                    "📖 *SYNTERRA REMOTE COMMAND MANUAL*\n\n"
                    "• `/status` - Read live canopy telemetry, VPD & light lux\n"
                    "• `/water <seconds>` - Trigger emergency drip cycle (e.g. `/water 12`)\n"
                    "• `/stop` - Immediate emergency pump shutoff\n"
                    "• `/help` - Show this command manual"
                )
            }


whatsapp_bot = WhatsAppService()
