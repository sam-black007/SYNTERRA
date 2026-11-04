#!/usr/bin/env python3
"""
Inspect raw serial stream from ESP32 on COM6 and parse sensor readings.
"""
import sys
import time
import json
import serial

PORT = 'COM6'
BAUD = 115200
DURATION = 15  # seconds

print(f"Connecting to {PORT} @ {BAUD} baud...")
try:
    ser = serial.Serial(PORT, baudrate=BAUD, timeout=1)
except Exception as e:
    print(f"Error opening {PORT}: {e}")
    sys.exit(1)

print(f"Listening on {PORT} for {DURATION} seconds...\n" + "="*60)
t_end = time.time() + DURATION

raw_lines = []
json_packets = []

try:
    while time.time() < t_end:
        line = ser.readline().decode('utf-8', errors='ignore').strip()
        if line:
            print(f"ESP32 >> {line}")
            raw_lines.append(line)
            if line.startswith('{') and line.endswith('}'):
                try:
                    data = json.loads(line)
                    json_packets.append(data)
                except:
                    pass
finally:
    ser.close()
    print("="*60)

if json_packets:
    latest = json_packets[-1]
    print("\nPARSED LATEST SENSOR TELEMETRY:")
    print(f"  • Temperature:   {latest.get('temperature_c')} °C")
    print(f"  • Humidity:      {latest.get('humidity_pct')} %")
    print(f"  • Soil Moisture: {latest.get('soil_moisture_pct')} % (Raw ADC: {latest.get('soil_raw_adc')})")
    print(f"  • Light Lux:     {latest.get('light_lux', 'NOT DETECTED (None)')}")
    print(f"  • Reservoir OK:  {latest.get('water_reservoir_ok')}")
else:
    print("\nNo complete JSON packets received in the window. Check ESP32 power or baud rate.")
