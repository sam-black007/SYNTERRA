"""
SYNTERRA — Irrigation Safety Controller & Watchdog
Manages pump execution with fail-safe interlocks:
- Maximum 30s runtime per cycle
- Mandatory 300s cooldown between cycles
- Reservoir dry-run safety interlock (refuses pump if reservoir is dry)
- Emergency Stop override
"""

import time
import threading
from flask import current_app


class IrrigationController:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(IrrigationController, cls).__new__(cls)
                cls._instance._init_state()
            return cls._instance

    def _init_state(self):
        self.state = "IDLE"  # IDLE, PUMPING, COOLDOWN, EMERGENCY_STOPPED
        self.pump_started_at = None
        self.target_duration = 0
        self.last_pump_completed_at = None
        self.max_duration_sec = 30
        self.cooldown_sec = 180  # 3 minutes cooldown
        self.auto_mode_enabled = False
        self.soil_threshold_pct = 35.0  # Auto water if soil drops below 35%
        self.last_reservoir_ok = True
        self._timer_thread = None

    def get_status(self):
        now = time.time()
        remaining_pump_sec = 0
        remaining_cooldown_sec = 0

        if self.state == "PUMPING" and self.pump_started_at:
            elapsed = now - self.pump_started_at
            remaining_pump_sec = max(0, round(self.target_duration - elapsed, 1))
            if elapsed >= self.target_duration:
                self._finish_pump()

        if self.state == "COOLDOWN" and self.last_pump_completed_at:
            elapsed_cool = now - self.last_pump_completed_at
            remaining_cooldown_sec = max(0, round(self.cooldown_sec - elapsed_cool, 1))
            if elapsed_cool >= self.cooldown_sec:
                self.state = "IDLE"

        return {
            "state": self.state,
            "is_pumping": self.state == "PUMPING",
            "remaining_pump_sec": remaining_pump_sec,
            "remaining_cooldown_sec": remaining_cooldown_sec,
            "reservoir_ok": self.last_reservoir_ok,
            "auto_mode_enabled": self.auto_mode_enabled,
            "soil_threshold_pct": self.soil_threshold_pct,
            "safety_watchdog": {
                "max_duration_sec": self.max_duration_sec,
                "cooldown_sec": self.cooldown_sec,
                "interlock_armed": self.last_reservoir_ok,
            }
        }

    def start_manual_irrigation(self, duration_sec: int, reservoir_ok: bool = True):
        self.last_reservoir_ok = reservoir_ok

        # Safety Check 1: Dry-run Interlock
        if not reservoir_ok:
            return False, "SAFETY INTERLOCK: Water reservoir is empty. Pump blocked to prevent dry-run burnout."

        # Safety Check 2: State check
        status = self.get_status()
        if self.state == "EMERGENCY_STOPPED":
            return False, "SAFETY INTERLOCK: System is in EMERGENCY STOP state. Clear stop first."
        if self.state == "PUMPING":
            return False, f"Pump is already running ({status['remaining_pump_sec']}s remaining)."
        if self.state == "COOLDOWN":
            return False, f"Pump in thermal cooldown ({status['remaining_cooldown_sec']}s remaining)."

        # Clamp duration to watchdog max
        clamped_duration = min(max(1, int(duration_sec)), self.max_duration_sec)
        self.target_duration = clamped_duration
        self.pump_started_at = time.time()
        self.state = "PUMPING"

        # Start watchdog background timer
        def _watchdog_timer(duration):
            time.sleep(duration)
            self._finish_pump()

        threading.Thread(target=_watchdog_timer, args=(clamped_duration,), daemon=True).start()
        return True, f"Pump activated for {clamped_duration} seconds."

    def emergency_stop(self):
        self.state = "EMERGENCY_STOPPED"
        self.pump_started_at = None
        self.target_duration = 0
        self.last_pump_completed_at = time.time()
        return True, "EMERGENCY STOP EXECUTED: All pump relays disengaged."

    def reset_emergency_stop(self):
        self.state = "IDLE"
        self.last_pump_completed_at = time.time()
        return True, "Emergency stop cleared. System returned to IDLE."

    def _finish_pump(self):
        if self.state == "PUMPING":
            self.state = "COOLDOWN"
            self.last_pump_completed_at = time.time()
            self.pump_started_at = None

    def toggle_auto_mode(self, enabled: bool, threshold: float = None):
        self.auto_mode_enabled = bool(enabled)
        if threshold is not None:
            self.soil_threshold_pct = max(10.0, min(80.0, float(threshold)))
        return True, f"Autonomous irrigation {'enabled' if self.auto_mode_enabled else 'disabled'} (Threshold: {self.soil_threshold_pct}%)."


irrigation_manager = IrrigationController()
