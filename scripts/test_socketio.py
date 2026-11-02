#!/usr/bin/env python3
"""
SYNTERRA — Socket.IO Live Telemetry Broadcast Verification
Tests WebSocket events and real-time broadcast when new sensor telemetry arrives.
"""

import time
import socketio
import requests

SERVER_URL = "http://127.0.0.1:5000"

sio = socketio.Client()
received_events = []


@sio.on('connect')
def on_connect():
    print("[SOCKET] Connected to SYNTERRA WebSocket gateway!")


@sio.on('telemetry_update')
def on_telemetry(data):
    print(f"[SOCKET EVENT] Received telemetry_update -> Temp: {data.get('temperature_c')}C | Hum: {data.get('humidity_pct')}% | Soil: {data.get('soil_moisture_pct')}% | Lux: {data.get('light_lux')}")
    received_events.append(data)


@sio.on('disconnect')
def on_disconnect():
    print("[SOCKET] Disconnected from gateway.")


def main():
    print("Testing Socket.IO live connection...")
    try:
        sio.connect(SERVER_URL, transports=['websocket', 'polling'])
        time.sleep(1)

        # Trigger telemetry POST over HTTP
        print("Posting telemetry over HTTP to trigger WebSocket broadcast...")
        payload = {
            'device_id': 'esp32-socket-test',
            'plant_id': 'specimen-ws',
            'temperature_c': 25.5,
            'humidity_pct': 63.0,
            'soil_moisture_pct': 72.0,
            'light_lux': 620.0,
            'water_reservoir_ok': True,
        }
        res = requests.post(
            f"{SERVER_URL}/api/sensors/telemetry",
            json=payload,
            headers={'X-Device-Token': 'plant-lab-auth-token-9981'},
            timeout=5,
        )
        print(f"HTTP POST Status: {res.status_code}")

        # Wait for broadcast delivery
        time.sleep(2)

        sio.disconnect()

        if received_events:
            print(f"\nSUCCESS: Received {len(received_events)} WebSocket events in real-time!")
        else:
            print("\nWARNING: No events captured.")

    except Exception as e:
        print(f"SocketIO test error: {e}")


if __name__ == '__main__':
    main()
