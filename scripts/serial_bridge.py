#!/usr/bin/env python3
"""
SYNTERRA — Serial Bridge Script
Reads JSON telemetry strings emitted over USB Serial by ESP32-S3 and forwards
them via HTTP POST to the SYNTERRA backend (/api/sensors/telemetry).
"""

import os
import sys
import time
import json
import random
import logging
import argparse
from pathlib import Path

import requests

try:
    import serial
    import serial.tools.list_ports
    HAS_SERIAL = True
except ImportError:
    HAS_SERIAL = False

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('serial_bridge')

# Load .env if present
PROJECT_ROOT = Path(__file__).resolve().parent.parent
env_file = PROJECT_ROOT / '.env'
if env_file.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(env_file)
    except ImportError:
        pass

DEFAULT_URL = os.getenv('SYNTERRA_API_URL', 'http://localhost:5000/api/sensors/telemetry')
DEFAULT_TOKEN = os.getenv('DEVICE_TOKEN', 'plant-lab-auth-token-9981')
DEFAULT_BAUD = 115200


def list_serial_ports():
    """List all available serial COM ports."""
    if not HAS_SERIAL:
        logger.warning("pyserial is not installed. Run: pip install pyserial")
        return []
    ports = serial.tools.list_ports.comports()
    return ports


def auto_detect_esp32_port():
    """Attempt to detect typical ESP32 / USB-UART chip identifiers."""
    ports = list_serial_ports()
    if not ports:
        return None

    keywords = ['ch340', 'cp210', 'ftdi', 'esp32', 'usb serial', 'silicon labs']
    for p in ports:
        desc = (p.description or '').lower() + ' ' + (p.manufacturer or '').lower()
        if any(k in desc for k in keywords):
            return p.device

    # Return first available port if only one exists
    if len(ports) == 1:
        return ports[0].device
    return None


def forward_telemetry(payload: dict, url: str, token: str) -> bool:
    """Send telemetry JSON to the backend API."""
    headers = {
        'Content-Type': 'application/json',
        'X-Device-Token': token,
    }
    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=5)
        if resp.status_code in (200, 201):
            logger.info(
                f"[POST OK {resp.status_code}] Temp: {payload.get('temperature_c')}C | "
                f"Hum: {payload.get('humidity_pct')}% | Soil: {payload.get('soil_moisture_pct')}% | "
                f"Lux: {payload.get('light_lux')} lx"
            )
            return True
        else:
            logger.warning(f"[POST FAILED {resp.status_code}] {resp.text}")
            return False
    except requests.RequestException as e:
        logger.error(f"[NETWORK ERROR] Failed to reach {url}: {e}")
        return False


def run_simulation(url: str, token: str, interval: float):
    """Generate realistic synthetic sensor readings for testing without hardware."""
    logger.info("Starting SIMULATION mode (transmitting synthetic ESP32 readings)...")
    logger.info(f"Target: {url} | Interval: {interval}s")

    temp = 24.0
    hum = 60.0
    soil = 65.0
    lux = 500.0

    while True:
        try:
            # Subtle random walk
            temp += random.uniform(-0.3, 0.3)
            hum += random.uniform(-0.5, 0.5)
            soil += random.uniform(-0.2, 0.2)
            lux += random.uniform(-15.0, 15.0)

            # Clamp within realistic botanical bounds
            temp = max(15.0, min(38.0, temp))
            hum = max(30.0, min(95.0, hum))
            soil = max(10.0, min(95.0, soil))
            lux = max(50.0, min(25000.0, lux))

            payload = {
                'device_id': 'esp32-sim-01',
                'plant_id': 'test-specimen-1',
                'temperature_c': round(temp, 2),
                'humidity_pct': round(hum, 2),
                'light_lux': round(lux, 1),
                'soil_moisture_pct': round(soil, 2),
                'soil_raw_adc': int(3200 - (soil * 20)),
                'water_reservoir_ok': True,
            }

            forward_telemetry(payload, url, token)
            time.sleep(interval)
        except KeyboardInterrupt:
            logger.info("Simulation stopped by user.")
            break


def run_bridge(port: str, baud: int, url: str, token: str):
    """Open serial port and bridge incoming JSON lines to the API."""
    if not HAS_SERIAL:
        logger.error("pyserial is required to run the serial bridge. Install with 'pip install pyserial'")
        sys.exit(1)

    logger.info(f"Connecting to Serial Port {port} @ {baud} baud...")
    logger.info(f"Forwarding to: {url}")

    while True:
        try:
            with serial.Serial(port, baudrate=baud, timeout=2) as ser:
                logger.info(f"Serial port {port} connected successfully! Listening for telemetry...")
                buffer = ""

                while True:
                    line = ser.readline().decode('utf-8', errors='ignore').strip()
                    if not line:
                        continue

                    # Filter out non-JSON debug logs
                    if not (line.startswith('{') and line.endswith('}')):
                        logger.debug(f"[RAW SERIAL] {line}")
                        continue

                    try:
                        payload = json.loads(line)
                        forward_telemetry(payload, url, token)
                    except json.JSONDecodeError:
                        logger.warning(f"Could not parse JSON: {line}")

        except serial.SerialException as e:
            logger.error(f"Serial port error on {port}: {e}. Retrying in 5 seconds...")
            time.sleep(5)
        except KeyboardInterrupt:
            logger.info("Bridge stopped by user.")
            break


def main():
    parser = argparse.ArgumentParser(description="SYNTERRA ESP32-S3 Serial to HTTP Telemetry Bridge")
    parser.add_argument('--port', type=str, help="Serial COM port (e.g. COM3 or /dev/ttyUSB0)")
    parser.add_argument('--baud', type=int, default=DEFAULT_BAUD, help=f"Baud rate (default: {DEFAULT_BAUD})")
    parser.add_argument('--url', type=str, default=DEFAULT_URL, help=f"Backend telemetry URL (default: {DEFAULT_URL})")
    parser.add_argument('--token', type=str, default=DEFAULT_TOKEN, help="Device token (default from .env)")
    parser.add_argument('--mock', action='store_true', help="Run synthetic simulation without hardware")
    parser.add_argument('--interval', type=float, default=10.0, help="Simulation loop interval in seconds (default: 10)")
    parser.add_argument('--list-ports', action='store_true', help="List detected serial ports and exit")

    args = parser.parse_args()

    if args.list_ports:
        ports = list_serial_ports()
        if not ports:
            print("No serial ports detected.")
        else:
            print("Available Serial Ports:")
            for p in ports:
                print(f"  {p.device} - {p.description} (hwid: {p.hwid})")
        return

    if args.mock:
        run_simulation(args.url, args.token, args.interval)
        return

    port = args.port
    if not port:
        port = auto_detect_esp32_port()
        if port:
            logger.info(f"Auto-detected serial port: {port}")
        else:
            ports = list_serial_ports()
            if ports:
                logger.warning(f"Multiple or unknown ports found: {[p.device for p in ports]}. Specify --port.")
                sys.exit(1)
            else:
                logger.warning("No physical serial ports detected! You can test using simulation mode: python scripts/serial_bridge.py --mock")
                sys.exit(1)

    run_bridge(port, args.baud, args.url, args.token)


if __name__ == '__main__':
    main()
