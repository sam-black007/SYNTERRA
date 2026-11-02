"""
SYNTERRA — Telegram Agronomic Alert & Remote Control Bot Service
Connects the IoT platform to Telegram for instant microclimate alerts,
dry-run watchdog notifications, AI disease reports, and 2-way remote control.
"""

import os
import time
import requests
from flask import current_app


class TelegramBotService:
    def __init__(self, bot_token=None, chat_id=None):
        self.bot_token = bot_token or os.getenv('TELEGRAM_BOT_TOKEN')
        self.chat_id = chat_id or os.getenv('TELEGRAM_CHAT_ID')
        self.api_base = "https://api.telegram.org"
        self._last_alert_time = {}
        self._cooldown_seconds = 60  # prevent alert spamming

    @property
    def is_configured(self):
        token = self.bot_token or os.getenv('TELEGRAM_BOT_TOKEN')
        chat = self.chat_id or os.getenv('TELEGRAM_CHAT_ID')
        return bool(token and chat and token != 'your_telegram_bot_token_here')

    def send_message(self, text, parse_mode='HTML'):
        """Send formatted notification directly to configured Telegram chat."""
        token = self.bot_token or os.getenv('TELEGRAM_BOT_TOKEN')
        chat = self.chat_id or os.getenv('TELEGRAM_CHAT_ID')

        if not token or not chat or token == 'your_telegram_bot_token_here':
            # Standby simulated transmission
            return {
                'success': True,
                'simulated': True,
                'message': 'Telegram bot in standby simulation (Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to go live)',
                'preview': text
            }

        url = f"{self.api_base}/bot{token}/sendMessage"
        payload = {
            'chat_id': chat,
            'text': text,
            'parse_mode': parse_mode
        }
        try:
            resp = requests.post(url, json=payload, timeout=5.0)
            data = resp.json()
            return {
                'success': resp.status_code == 200 and data.get('ok', False),
                'simulated': False,
                'telegram_response': data
            }
        except Exception as e:
            return {'success': False, 'error': str(e), 'simulated': False}

    def send_drought_alert(self, soil_pct, threshold_pct, crop_name='Tomato'):
        """Dispatched when soil moisture drops into critical depletion."""
        now = time.time()
        if now - self._last_alert_time.get('drought', 0) < self._cooldown_seconds:
            return {'throttled': True}
        self._last_alert_time['drought'] = now

        msg = (
            f"🚨 <b>SYNTERRA // CRITICAL SOIL DROUGHT ALERT</b>\n\n"
            f"🌱 <b>Target Crop:</b> {crop_name}\n"
            f"💧 <b>Current Moisture:</b> <code>{soil_pct}%</code> (Threshold: <code>{threshold_pct}%</code>)\n"
            f"⚡ <b>Action Taken:</b> Autonomous drip pulse triggered.\n"
            f"🕒 <i>{time.strftime('%Y-%m-%d %H:%M:%S UTC')}</i>"
        )
        return self.send_message(msg)

    def send_dry_run_interlock_alert(self):
        """Dispatched when the float switch trips to prevent motor burnout."""
        msg = (
            f"⚠️ <b>SYNTERRA WATCHDOG // RESERVOIR EMPTY</b>\n\n"
            f"🛑 <b>Safety Interlock:</b> Solenoid pump relay locked OUT.\n"
            f"💡 <b>Action Required:</b> Refill system nutrient reservoir to re-arm autonomous irrigation.\n"
            f"🕒 <i>{time.strftime('%Y-%m-%d %H:%M:%S UTC')}</i>"
        )
        return self.send_message(msg)

    def send_spore_risk_alert(self, spore_index, risk_level, advisory):
        """Dispatched when microclimate sustains fungal incubation conditions."""
        msg = (
            f"🦠 <b>SYNTERRA // FUNGAL SPORE INCUBATION WARNING</b>\n\n"
            f"⚠️ <b>Risk Status:</b> {risk_level} ({spore_index}% Germination Index)\n"
            f"📋 <b>Agronomic Advisory:</b> {advisory}\n"
            f"🕒 <i>{time.strftime('%Y-%m-%d %H:%M:%S UTC')}</i>"
        )
        return self.send_message(msg)

    def send_pathology_report(self, crop_name, disease_name, confidence, active_ingredients=None):
        """Dispatched when a new leaf pathology analysis is processed."""
        actives = ", ".join(active_ingredients) if active_ingredients else "See Dossier PDF"
        msg = (
            f"🔬 <b>SYNTERRA // AI LEAF PATHOLOGY DOSSIER</b>\n\n"
            f"🌿 <b>Specimen:</b> {crop_name}\n"
            f"🦠 <b>Diagnosis:</b> <code>{disease_name}</code>\n"
            f"📊 <b>Confidence:</b> <b>{confidence}%</b>\n"
            f"🧪 <b>Active Ingredients:</b> <i>{actives}</i>\n"
            f"📄 <b>Console Dossier:</b> Record persisted to SQLite."
        )
        return self.send_message(msg)

    def execute_command(self, cmd_text):
        """Process remote 2-way commands (/status, /water <sec>, /crop <name>)."""
        clean = (cmd_text or '').strip()
        parts = clean.split()
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
                            f"🌿 <b>SYNTERRA LIVE STATUS</b>\n"
                            f"🌡️ <b>Temperature:</b> {latest.temperature_c}°C\n"
                            f"💧 <b>Humidity:</b> {latest.humidity_pct}%\n"
                            f"🌱 <b>Soil Moisture:</b> {latest.soil_moisture_pct}%\n"
                            f"☀️ <b>Photometrics:</b> {latest.light_lux} Lux\n"
                            f"🕒 <i>{latest.timestamp.strftime('%H:%M:%S')}</i>"
                        )
                    }
            except Exception:
                pass
            return {'success': True, 'command': cmd, 'reply': "Sensor telemetry standing by."}

        elif cmd in ['/water', '/irrigate']:
            sec = 10
            if len(parts) > 1 and parts[1].isdigit():
                sec = max(2, min(30, int(parts[1])))
            try:
                from app.services.irrigation_controller import irrigation_manager
                success, msg = irrigation_manager.trigger_manual_irrigation(sec)
                return {
                    'success': success,
                    'command': cmd,
                    'reply': f"💧 <b>Irrigation Command:</b> {msg} (Duration: {sec}s)"
                }
            except Exception as e:
                return {'success': False, 'command': cmd, 'reply': f"Irrigation error: {e}"}

        elif cmd == '/stop':
            try:
                from app.services.irrigation_controller import irrigation_manager
                irrigation_manager.emergency_stop()
                return {'success': True, 'command': cmd, 'reply': "🛑 <b>EMERGENCY STOP EXECUTED:</b> Pump relay halted."}
            except Exception as e:
                return {'success': False, 'command': cmd, 'reply': f"Stop error: {e}"}

        else:
            return {
                'success': True,
                'command': cmd,
                'reply': (
                    f"🤖 <b>SYNTERRA TELEGRAM COMMANDS:</b>\n"
                    f"• <code>/status</code> — Live canopy & soil telemetry\n"
                    f"• <code>/water 12</code> — Trigger 12-second drip irrigation\n"
                    f"• <code>/stop</code> — Emergency shutoff pump relay\n"
                    f"• <code>/help</code> — Command documentation"
                )
            }


telegram_bot = TelegramBotService()
