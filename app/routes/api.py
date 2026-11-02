import io
import csv
import base64
from flask import Blueprint, jsonify, request, current_app, Response
from app import db, socketio
from app.models.diagnosis import Diagnosis
from app.models.sensor import SensorReading
from app.services.plantid_client import PlantIdClient
from app.services.irrigation_controller import irrigation_manager
from app.services.camera_service import camera_service
from app.services.weather_service import weather_service

api_bp = Blueprint('api', __name__)


@api_bp.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'healthy', 'service': 'SYNTERRA'}), 200


@api_bp.route('/integrations/plantid/status', methods=['GET'])
def plantid_status():
    client = PlantIdClient()
    return jsonify({
        'configured': client.is_configured(),
        'masked_key': client.get_masked_key(),
    }), 200


@api_bp.route('/integrations/plantid/test', methods=['POST'])
def plantid_test():
    client = PlantIdClient()
    result = client.test_connection()
    return jsonify(result), (200 if result.get('success') else 400)


@api_bp.route('/diagnose', methods=['POST'])
def diagnose():
    """Upload an image and get real Plant.id disease detection."""
    client = PlantIdClient()

    if not client.is_configured():
        return jsonify({
            'success': False,
            'error': 'API_KEY_MISSING',
            'message': 'Plant.id API key is not configured.',
        }), 400

    if 'image' not in request.files:
        return jsonify({'success': False, 'error': 'NO_IMAGE', 'message': 'No image file provided'}), 400

    file = request.files['image']
    if file.filename == '':
        return jsonify({'success': False, 'error': 'NO_IMAGE', 'message': 'No image selected'}), 400

    image_bytes = file.read()
    success, result = client.identify(image_bytes, filename=file.filename or 'leaf.jpg')

    if not success:
        return jsonify({'success': False, 'error': result.get('error', 'UNKNOWN'), 'message': result.get('message', 'Diagnosis failed')}), 400

    # Parse crop.health v1 response (crop & disease suggestions)
    disease_name = None
    confidence = None
    crop_name = None
    try:
        result_data = result.get('result', {})

        # 1. Identify crop species if detected
        crop_suggestions = result_data.get('crop', {}).get('suggestions', [])
        if crop_suggestions:
            crop_name = crop_suggestions[0].get('name')

        # 2. Identify disease / pathology if detected
        disease = result_data.get('disease', {})
        suggestions = disease.get('suggestions', [])
        if suggestions:
            top = suggestions[0]
            disease_name = top.get('name')
            confidence = top.get('probability', 0) * 100
    except Exception as e:
        current_app.logger.error(f"Error parsing diagnosis: {e}")

    plant_name = request.form.get('plant_name')
    if (not plant_name or plant_name in ('Unknown', 'Unknown plant', '')) and crop_name:
        plant_name = crop_name
    elif not plant_name:
        plant_name = 'Unknown'

    # Save
    diag = Diagnosis(
        plant_name=plant_name,
        disease_name=disease_name or 'Healthy / No Disease Detected',
        confidence=confidence,
        image_url=file.filename or 'uploaded.jpg',
        raw_response=str(result)[:5000],
    )
    db.session.add(diag)
    db.session.commit()

    try:
        socketio.emit('diagnosis_update', diag.to_dict())
    except Exception as e:
        current_app.logger.warning(f"SocketIO diagnosis emit warning: {e}")

    return jsonify({
        'success': True,
        'diagnosis': diag.to_dict(),
        'disease_name': disease_name,
        'confidence': confidence,
        'raw': result,
    }), 200


@api_bp.route('/diagnoses', methods=['GET'])
def list_diagnoses():
    diagnoses = Diagnosis.query.order_by(Diagnosis.created_at.desc()).all()
    return jsonify([d.to_dict() for d in diagnoses]), 200


@api_bp.route('/diagnosis/<int:diag_id>', methods=['GET'])
def get_diagnosis(diag_id):
    diag = Diagnosis.query.get_or_404(diag_id)
    return jsonify(diag.to_dict()), 200


@api_bp.route('/diagnosis/<int:diag_id>/pdf', methods=['GET'])
def get_diagnosis_pdf(diag_id):
    """Generate and return official PDF pathology dossier."""
    diag = Diagnosis.query.get_or_404(diag_id)
    latest_telem = SensorReading.query.order_by(SensorReading.timestamp.desc()).first()
    telem_dict = latest_telem.to_dict() if latest_telem else None

    from app.services.pdf_generator import generate_diagnosis_pdf
    pdf_bytes = generate_diagnosis_pdf(diag, telem_dict)

    return Response(
        pdf_bytes,
        mimetype="application/pdf",
        headers={"Content-Disposition": f"inline; filename=synterra_dossier_{diag_id}.pdf"}
    )


# ============================================================================
# ESP32 Sensor Telemetry Endpoints
# ============================================================================

def _verify_device_token():
    expected_token = current_app.config.get('DEVICE_TOKEN', '')
    if not expected_token:
        return True  # If no token configured, allow in dev mode

    auth_header = request.headers.get('X-Device-Token', '')
    if not auth_header and request.headers.get('Authorization', '').startswith('Bearer '):
        auth_header = request.headers.get('Authorization')[7:].strip()

    return auth_header == expected_token


@api_bp.route('/sensors/telemetry', methods=['POST'])
def receive_telemetry():
    """Ingest sensor telemetry from ESP32 or serial bridge."""
    if not _verify_device_token():
        return jsonify({
            'success': False,
            'error': 'UNAUTHORIZED',
            'message': 'Invalid or missing X-Device-Token header.',
        }), 401

    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({
            'success': False,
            'error': 'INVALID_JSON',
            'message': 'Request body must be valid JSON.',
        }), 400

    def _get_field(keys, default=None):
        for k in keys:
            if k in payload and payload[k] is not None:
                return payload[k]
        return default

    reading = SensorReading(
        device_id=_get_field(['device_id'], 'esp32-sensor-01'),
        plant_id=_get_field(['plant_id']),
        temperature_c=_get_field(['temperature_c', 'temperature', 'temp']),
        humidity_pct=_get_field(['humidity_pct', 'humidity']),
        light_lux=_get_field(['light_lux', 'lux', 'light']),
        soil_moisture_pct=_get_field(['soil_moisture_pct', 'soil_moisture', 'soil_pct']),
        soil_raw_adc=_get_field(['soil_raw_adc', 'soil_adc', 'raw_adc']),
        water_reservoir_ok=_get_field(['water_reservoir_ok', 'water_ok', 'reservoir_ok'], True),
    )

    db.session.add(reading)
    db.session.commit()

    # Autonomous Irrigation Rule Engine: Auto-trigger pump if soil is below threshold
    if irrigation_manager.auto_mode_enabled and reading.soil_moisture_pct is not None:
        if reading.soil_moisture_pct < irrigation_manager.soil_threshold_pct:
            irrigation_manager.start_manual_irrigation(12, reservoir_ok=reading.water_reservoir_ok)

    try:
        socketio.emit('telemetry_update', reading.to_dict())
        socketio.emit('irrigation_update', irrigation_manager.get_status())
    except Exception as e:
        current_app.logger.warning(f"SocketIO telemetry emit warning: {e}")

    return jsonify({
        'success': True,
        'message': 'Telemetry recorded successfully.',
        'reading': reading.to_dict(),
    }), 201


@api_bp.route('/sensors/latest', methods=['GET'])
def get_latest_telemetry():
    """Get the most recent sensor reading."""
    device_id = request.args.get('device_id')
    query = SensorReading.query
    if device_id:
        query = query.filter_by(device_id=device_id)

    latest = query.order_by(SensorReading.timestamp.desc()).first()
    if not latest:
        return jsonify({'success': True, 'reading': None}), 200

    return jsonify({'success': True, 'reading': latest.to_dict()}), 200


@api_bp.route('/sensors/history', methods=['GET'])
def get_sensor_history():
    """Get historical sensor readings with optional limit."""
    try:
        limit = min(int(request.args.get('limit', 50)), 500)
    except ValueError:
        limit = 50

    device_id = request.args.get('device_id')
    query = SensorReading.query
    if device_id:
        query = query.filter_by(device_id=device_id)

    readings = query.order_by(SensorReading.timestamp.desc()).limit(limit).all()
    return jsonify({
        'success': True,
        'count': len(readings),
        'readings': [r.to_dict() for r in readings],
    }), 200


@api_bp.route('/sensors/export/csv', methods=['GET'])
def export_sensor_csv():
    """Export all telemetry readings as CSV."""
    readings = SensorReading.query.order_by(SensorReading.timestamp.asc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        'ID', 'Timestamp (UTC)', 'Device ID', 'Plant ID',
        'Temperature (C)', 'Humidity (%)', 'Light (Lux)',
        'Soil Moisture (%)', 'Soil Raw ADC', 'Reservoir OK'
    ])

    for r in readings:
        writer.writerow([
            r.id,
            r.timestamp.isoformat() if r.timestamp else '',
            r.device_id,
            r.plant_id or '',
            r.temperature_c if r.temperature_c is not None else '',
            r.humidity_pct if r.humidity_pct is not None else '',
            r.light_lux if r.light_lux is not None else '',
            r.soil_moisture_pct if r.soil_moisture_pct is not None else '',
            r.soil_raw_adc if r.soil_raw_adc is not None else '',
            'TRUE' if r.water_reservoir_ok else 'FALSE'
        ])

    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=synterra_telemetry_export.csv"}
    )


# ============================================================================
# Autonomous Irrigation Control Endpoints
# ============================================================================

@api_bp.route('/irrigation/status', methods=['GET'])
def get_irrigation_status():
    """Retrieve live pump watchdog status."""
    return jsonify({'success': True, 'irrigation': irrigation_manager.get_status()}), 200


@api_bp.route('/irrigation/manual', methods=['POST'])
def trigger_manual_irrigation():
    """Trigger manual drip irrigation cycle with safety watchdog."""
    data = request.get_json(silent=True) or {}
    duration = int(data.get('duration_sec', 10))

    # Read latest reservoir status from latest sensor telemetry
    latest = SensorReading.query.order_by(SensorReading.timestamp.desc()).first()
    reservoir_ok = latest.water_reservoir_ok if latest else True

    success, message = irrigation_manager.start_manual_irrigation(duration, reservoir_ok=reservoir_ok)

    # Broadcast irrigation status
    try:
        socketio.emit('irrigation_update', irrigation_manager.get_status())
    except Exception:
        pass

    return jsonify({
        'success': success,
        'message': message,
        'irrigation': irrigation_manager.get_status()
    }), (200 if success else 400)


@api_bp.route('/irrigation/emergency_stop', methods=['POST'])
def emergency_stop_irrigation():
    """Emergency cut-off to disengage pump relays immediately."""
    success, message = irrigation_manager.emergency_stop()
    try:
        socketio.emit('irrigation_update', irrigation_manager.get_status())
    except Exception:
        pass
    return jsonify({'success': success, 'message': message, 'irrigation': irrigation_manager.get_status()}), 200


@api_bp.route('/irrigation/reset_stop', methods=['POST'])
def reset_emergency_stop():
    """Clear emergency stop condition."""
    success, message = irrigation_manager.reset_emergency_stop()
    try:
        socketio.emit('irrigation_update', irrigation_manager.get_status())
    except Exception:
        pass
    return jsonify({'success': success, 'message': message, 'irrigation': irrigation_manager.get_status()}), 200


@api_bp.route('/irrigation/auto_config', methods=['POST'])
def configure_auto_irrigation():
    """Toggle automated soil-threshold irrigation rules."""
    data = request.get_json(silent=True) or {}
    enabled = data.get('enabled', False)
    threshold = data.get('soil_threshold_pct')

    success, message = irrigation_manager.toggle_auto_mode(enabled, threshold)
    try:
        socketio.emit('irrigation_update', irrigation_manager.get_status())
    except Exception:
        pass
    return jsonify({'success': success, 'message': message, 'irrigation': irrigation_manager.get_status()}), 200


# ============================================================================
# Camera Streaming & One-Click Live Diagnosis
# ============================================================================

@api_bp.route('/camera/stream')
def camera_stream():
    """Proxy live MJPEG video stream with telemetry HUD overlay."""
    app = current_app._get_current_object()

    def _get_latest_telem():
        try:
            with app.app_context():
                latest = SensorReading.query.order_by(SensorReading.timestamp.desc()).first()
                return latest.to_dict() if latest else None
        except Exception:
            return None

    return Response(
        camera_service.mjpeg_generator(_get_latest_telem),
        mimetype='multipart/x-mixed-replace; boundary=frame'
    )


@api_bp.route('/camera/snapshot', methods=['GET'])
def camera_snapshot():
    """Return a single live JPEG snapshot frame directly."""
    latest = SensorReading.query.order_by(SensorReading.timestamp.desc()).first()
    telem = latest.to_dict() if latest else None
    frame_bytes = camera_service.capture_frame(telem)
    return Response(frame_bytes, mimetype='image/jpeg')


@api_bp.route('/camera/capture', methods=['GET', 'POST'])
def camera_capture_and_diagnose():
    """Snap live camera frame. GET returns JPEG snapshot, POST pipes into Kindwise AI pathology."""
    latest = SensorReading.query.order_by(SensorReading.timestamp.desc()).first()
    telem = latest.to_dict() if latest else None

    # Capture frame bytes
    frame_bytes = camera_service.capture_frame(telem)

    if request.method == 'GET':
        return Response(frame_bytes, mimetype='image/jpeg')

    # Execute Kindwise pathology
    client = PlantIdClient()
    success, result = client.identify(frame_bytes, filename='camera_snap.jpg')

    disease_name = None
    confidence = None
    crop_name = None
    if success:
        result_data = result.get('result', {})
        crops = result_data.get('crop', {}).get('suggestions', [])
        if crops:
            crop_name = crops[0].get('name')
        diseases = result_data.get('disease', {}).get('suggestions', [])
        if diseases:
            disease_name = diseases[0].get('name')
            confidence = diseases[0].get('probability', 0) * 100

        diag = Diagnosis(
            plant_name=crop_name or 'Camera Specimen',
            disease_name=disease_name or 'Healthy / No Disease Detected',
            confidence=confidence,
            image_url='camera_live_capture.jpg',
            raw_response=str(result)[:5000]
        )
        db.session.add(diag)
        db.session.commit()

        try:
            socketio.emit('diagnosis_update', diag.to_dict())
        except Exception:
            pass

        diag_dict = diag.to_dict()
    else:
        diag_dict = None

    thumbnail_b64 = base64.b64encode(frame_bytes).decode('utf-8')

    return jsonify({
        'success': success,
        'message': 'Camera frame analyzed successfully' if success else 'Diagnosis failed',
        'diagnosis': diag_dict,
        'thumbnail_b64': f"data:image/jpeg;base64,{thumbnail_b64}",
        'crop_name': crop_name,
        'disease_name': disease_name,
        'confidence': confidence,
        'raw': result if success else None
    }), (200 if success else 400)


# ============================================================================
# Dynamic Device Discovery & Network Auto-Configuration
# ============================================================================

@api_bp.route('/camera/register', methods=['POST'])
def register_camera():
    """Receives auto-registration heartbeat from ESP32-S3."""
    import time
    data = request.get_json(silent=True) or {}
    cam_ip = data.get('ip') or request.remote_addr
    port = data.get('port', 80)
    device_id = data.get('device_id', 'esp32-s3-cam')

    target_url = f"http://{cam_ip}:{port}"
    camera_service.set_camera_url(target_url)

    try:
        socketio.emit('camera_status', {
            'connected': True,
            'url': target_url,
            'device_id': device_id,
            'method': 'auto_registration'
        })
    except Exception:
        pass

    return jsonify({
        'status': 'registered',
        'device_id': device_id,
        'camera_url': target_url,
        'server_time': int(time.time())
    }), 200


@api_bp.route('/camera/status', methods=['GET'])
def camera_status():
    """Returns current active camera target URL, online status, and mode."""
    online = camera_service.check_hardware_online(force=False)
    net_info = camera_service.get_network_info()
    return jsonify({
        'camera_url': camera_service.target_cam_url,
        'hardware_online': online,
        'mode': 'ESP32-S3 LIVE' if online else 'SYNTHETIC HUD',
        'host_network': net_info
    }), 200


@api_bp.route('/camera/configure', methods=['POST'])
def configure_camera():
    """Manually update or override the camera target URL from UI or CLI."""
    data = request.get_json(silent=True) or {}
    cam_url = data.get('camera_url')
    if not cam_url:
        return jsonify({'error': 'camera_url is required'}), 400

    camera_service.set_camera_url(cam_url)
    online = camera_service.check_hardware_online(force=True)

    try:
        socketio.emit('camera_status', {
            'connected': online,
            'url': camera_service.target_cam_url,
            'method': 'manual_config'
        })
    except Exception:
        pass

    return jsonify({
        'success': True,
        'camera_url': camera_service.target_cam_url,
        'hardware_online': online
    }), 200


@api_bp.route('/camera/discover', methods=['POST'])
def discover_camera():
    """Trigger LAN subnet sweep and mDNS discovery for ESP32-S3 camera."""
    result = camera_service.discover_camera()
    if result.get('found'):
        try:
            socketio.emit('camera_status', {
                'connected': True,
                'url': result.get('url'),
                'method': result.get('method')
            })
        except Exception:
            pass
        return jsonify({
            'success': True,
            'message': f"Discovered ESP32-S3 camera at {result.get('url')} via {result.get('method')}",
            'discovery': result
        }), 200
    else:
        return jsonify({
            'success': False,
            'message': result.get('message', 'Camera not found on local network'),
            'discovery': result
        }), 404


@api_bp.route('/system/network', methods=['GET'])
def system_network():
    """List host IP addresses, gateway interfaces, and mDNS endpoints."""
    net_info = camera_service.get_network_info()
    return jsonify({
        'host_network': net_info,
        'default_gateway_hint': '192.168.137.1 (Mobile Hotspot)' if any('192.168.137' in ip for ip in net_info.get('ips', [])) else None,
        'mdns_camera': 'http://synterra-cam.local',
        'active_camera_url': camera_service.target_cam_url,
        'active_camera_online': camera_service.check_hardware_online()
    }), 200


# ============================================================================
# 5-Day Agro-Meteorology & Weather Forecasting
# ============================================================================

@api_bp.route('/weather/forecast', methods=['GET'])
def get_weather_forecast():
    """Retrieve 5-day predictive agro-meteorological weather forecast and risk advisory."""
    force = request.args.get('refresh', '').lower() in ['1', 'true', 'yes']
    forecast_data = weather_service.fetch_5day_forecast(force_refresh=force)
    return jsonify(forecast_data), 200


@api_bp.route('/weather/refresh', methods=['POST'])
def refresh_weather_forecast():
    """Force an immediate refresh of the 5-day weather forecast."""
    forecast_data = weather_service.fetch_5day_forecast(force_refresh=True)
    return jsonify(forecast_data), 200


