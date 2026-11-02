"""
SYNTERRA — Camera Service & MJPEG Streamer
Supports ESP32-CAM / OV2640 MJPEG streams or generates an optical laboratory
HUD viewfinder with crosshairs and telemetry overlay for bench testing.
"""

import io
import os
import time
import requests
from PIL import Image, ImageDraw


class CameraService:
    def __init__(self, esp32_cam_url=None):
        self.esp32_cam_url = esp32_cam_url
        self.width = 640
        self.height = 480
        self._last_probe_time = 0
        self._is_hardware_available = False
        self._probe_cooldown_seconds = 8.0

    @property
    def target_cam_url(self):
        if self.esp32_cam_url:
            return self.esp32_cam_url.rstrip('/')
        try:
            from flask import current_app
            url = current_app.config.get('ESP32_CAM_URL', current_app.config.get('ESP32_BASE_URL', ''))
            if url:
                return url.rstrip('/')
        except Exception:
            env_url = os.getenv('ESP32_CAM_URL', os.getenv('ESP32_BASE_URL', ''))
            if env_url:
                return env_url.rstrip('/')
        return 'http://synterra-cam.local'

    def set_camera_url(self, url):
        """Manually or dynamically bind active camera URL."""
        if not url:
            self.esp32_cam_url = None
            return
        clean = url.strip()
        if not clean.startswith('http://') and not clean.startswith('https://'):
            clean = f"http://{clean}"
        self.esp32_cam_url = clean.rstrip('/')
        self.check_hardware_online(force=True)

    @staticmethod
    def get_network_info():
        """Retrieve local host IP addresses for mobile hotspot and LAN adapters."""
        import socket
        try:
            hostname = socket.gethostname()
            _, _, ips = socket.gethostbyname_ex(hostname)
            valid_ips = [ip for ip in ips if not ip.startswith('127.')]
            return {
                'hostname': hostname,
                'ips': valid_ips,
                'default_ip': valid_ips[0] if valid_ips else '127.0.0.1'
            }
        except Exception:
            return {'hostname': 'unknown', 'ips': ['127.0.0.1'], 'default_ip': '127.0.0.1'}

    def discover_camera(self):
        """Auto-discover ESP32-S3 camera via mDNS or rapid multi-threaded subnet sweep."""
        import concurrent.futures

        # 1. Try mDNS first
        try:
            r = requests.get('http://synterra-cam.local/status', timeout=(0.4, 0.7))
            if r.status_code == 200 and 'SYNTERRA' in r.text:
                self.set_camera_url('http://synterra-cam.local')
                return {'found': True, 'method': 'mDNS', 'url': 'http://synterra-cam.local', 'data': r.json()}
        except Exception:
            pass

        # 2. Get local subnets from network interfaces (including Windows Hotspot 192.168.137)
        net = self.get_network_info()
        subnets = set()
        for ip in net.get('ips', []):
            parts = ip.split('.')
            if len(parts) == 4:
                subnets.add(f"{parts[0]}.{parts[1]}.{parts[2]}")
        subnets.add('192.168.137')

        def _check_ip(ip_str):
            try:
                res = requests.get(f"http://{ip_str}/status", timeout=(0.12, 0.22))
                if res.status_code == 200 and 'SYNTERRA' in res.text:
                    return ip_str, res.json()
            except Exception:
                pass
            return None

        # Build candidate IPs across detected subnets
        candidate_ips = []
        for subnet in subnets:
            for host_num in range(1, 255):
                candidate_ips.append(f"{subnet}.{host_num}")

        with concurrent.futures.ThreadPoolExecutor(max_workers=60) as executor:
            future_to_ip = {executor.submit(_check_ip, ip): ip for ip in candidate_ips}
            for future in concurrent.futures.as_completed(future_to_ip):
                result = future.result()
                if result:
                    found_ip, data = result
                    found_url = f"http://{found_ip}"
                    self.set_camera_url(found_url)
                    executor.shutdown(wait=False, cancel_futures=True)
                    return {'found': True, 'method': 'subnet_sweep', 'url': found_url, 'data': data}

        return {'found': False, 'message': 'No SYNTERRA ESP32-S3 Camera discovered on local network'}

    def check_hardware_online(self, force=False):
        """Quick health probe with circuit breaker to avoid hanging on unreachable LAN IPs."""
        url = self.target_cam_url
        if not url:
            self._is_hardware_available = False
            return False

        now = time.time()
        if not force and not self._is_hardware_available and (now - self._last_probe_time < self._probe_cooldown_seconds):
            return False

        self._last_probe_time = now
        try:
            resp = requests.get(f"{url}/status", timeout=(0.4, 0.7))
            self._is_hardware_available = (resp.status_code == 200)
            return self._is_hardware_available
        except Exception:
            self._is_hardware_available = False
            return False

    def generate_synthetic_frame(self, telemetry=None):
        """Generate high-contrast Ag-Tech HUD camera frame."""
        img = Image.new('RGB', (self.width, self.height), color=(18, 28, 22))
        draw = ImageDraw.Draw(img)

        # Draw grid
        for x in range(40, self.width, 40):
            draw.line([(x, 0), (x, self.height)], fill=(25, 42, 32), width=1)
        for y in range(40, self.height, 40):
            draw.line([(0, y), (self.width, y)], fill=(25, 42, 32), width=1)

        # Draw simulated plant specimen silhouette in center
        cx, cy = self.width // 2, self.height // 2
        draw.line([(cx, cy + 120), (cx, cy - 20)], fill=(34, 139, 34), width=6)
        draw.polygon([(cx, cy + 30), (cx - 90, cy), (cx, cy - 40)], fill=(46, 125, 50))
        draw.polygon([(cx, cy + 10), (cx + 90, cy - 20), (cx, cy - 60)], fill=(56, 142, 60))
        draw.polygon([(cx, cy - 20), (cx - 60, cy - 80), (cx, cy - 110)], fill=(76, 175, 80))
        draw.polygon([(cx, cy - 40), (cx + 60, cy - 90), (cx, cy - 130)], fill=(67, 160, 71))

        # Viewfinder Reticle / Crosshairs
        draw.line([(cx - 40, cy), (cx + 40, cy)], fill=(0, 255, 128), width=1)
        draw.line([(cx, cy - 40), (cx, cy + 40)], fill=(0, 255, 128), width=1)
        draw.rectangle([(cx - 80, cy - 80), (cx + 80, cy + 80)], outline=(0, 255, 128), width=1)

        # HUD Text Overlay
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        cam_source = "ESP32-S3 LIVE" if self._is_hardware_available else "SYNTHETIC HUD // OV2640"
        draw.text((15, 15), f"SYNTERRA OPTICAL HUD // {cam_source}", fill=(0, 255, 128))
        draw.text((15, 32), f"REC: {timestamp} UTC  |  FPS: 15.0", fill=(180, 220, 190))

        if telemetry:
            temp = telemetry.get('temperature_c', '--')
            hum = telemetry.get('humidity_pct', '--')
            lux = telemetry.get('light_lux', '--')
            soil = telemetry.get('soil_moisture_pct', '--')
            telemetry_str = f"T: {temp}C | RH: {hum}% | LUX: {lux} | SOIL: {soil}%"
            draw.text((15, self.height - 30), telemetry_str, fill=(0, 255, 128))
        else:
            draw.text((15, self.height - 30), "SYS: LIVE TELEMETRY ARMED", fill=(0, 255, 128))

        buf = io.BytesIO()
        img.save(buf, format='JPEG', quality=80)
        return buf.getvalue()

    def capture_frame(self, telemetry=None):
        """Capture a single frame as JPEG bytes (from hardware or fallback)."""
        url = self.target_cam_url
        if url and self.check_hardware_online():
            try:
                resp = requests.get(f"{url}/capture", timeout=(0.8, 2.5))
                if resp.status_code == 200 and len(resp.content) > 1000:
                    return resp.content
            except Exception:
                self._is_hardware_available = False
                self._last_probe_time = time.time()
        return self.generate_synthetic_frame(telemetry)

    def mjpeg_generator(self, telemetry_getter=None):
        """Yield multipart MJPEG stream frames with seamless hardware proxy."""
        url = self.target_cam_url
        if url and self.check_hardware_online():
            try:
                # Proxy directly from ESP32-S3 hardware stream if online
                stream_resp = requests.get(f"{url}/stream", stream=True, timeout=(1.0, 3.0))
                if stream_resp.status_code == 200:
                    for chunk in stream_resp.iter_content(chunk_size=2048):
                        if chunk:
                            yield chunk
                    return
            except Exception:
                self._is_hardware_available = False
                self._last_probe_time = time.time()

        # Fallback to local HUD generator (zero-delay generation)
        while True:
            telem = telemetry_getter() if telemetry_getter else None
            frame = self.generate_synthetic_frame(telem)
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
            time.sleep(0.08)


camera_service = CameraService()
