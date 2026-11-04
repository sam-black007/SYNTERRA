import os
import io
import csv
import json
import base64
from datetime import datetime, timezone
from flask import Blueprint, jsonify, request, current_app, Response
from app import db, socketio
from app.models.diagnosis import Diagnosis
from app.models.sensor import SensorReading
from app.services.plantid_client import PlantIdClient
from app.services.irrigation_controller import irrigation_manager
from app.services.camera_service import camera_service
from app.services.weather_service import weather_service
from app.services.soil_geospatial_service import soil_geospatial_service
from app.services.gbif_service import gbif_service
from app.services.multimodal_vision_service import multimodal_vision_service
from app.services.agronomic_analytics_service import agronomic_analytics
from app.services.telegram_bot_service import telegram_bot
from app.services.whatsapp_service import whatsapp_bot
from app.services.fleet_service import fleet_service

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

    # Multi-Board Telemetry Fusion: If multiple ESP32s send partial readings,
    # preserve the latest known values for omitted metrics
    latest_prev = SensorReading.query.order_by(SensorReading.timestamp.desc()).first()

    temp_val = _get_field(['temperature_c', 'temperature', 'temp'])
    if temp_val is None and latest_prev:
        temp_val = latest_prev.temperature_c

    hum_val = _get_field(['humidity_pct', 'humidity'])
    if hum_val is None and latest_prev:
        hum_val = latest_prev.humidity_pct

    lux_val = _get_field(['light_lux', 'lux', 'light'])
    if lux_val is None and latest_prev:
        lux_val = latest_prev.light_lux

    soil_val = _get_field(['soil_moisture_pct', 'soil_moisture', 'soil_pct'])
    if soil_val is None and latest_prev:
        soil_val = latest_prev.soil_moisture_pct

    soil_adc_val = _get_field(['soil_raw_adc', 'soil_adc', 'raw_adc'])
    if soil_adc_val is None and latest_prev:
        soil_adc_val = latest_prev.soil_raw_adc

    reading = SensorReading(
        device_id=_get_field(['device_id'], 'esp32-sensor-01'),
        plant_id=_get_field(['plant_id']),
        temperature_c=temp_val,
        humidity_pct=hum_val,
        light_lux=lux_val,
        soil_moisture_pct=soil_val,
        soil_raw_adc=soil_adc_val,
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
# Botanical Crop Profiles & Photoperiod DLI Accumulator
# ============================================================================

CROP_PROFILES = {
    'tomato': {
        'key': 'tomato',
        'name': 'Cherry / Beefsteak Tomato',
        'scientific_name': 'Solanum lycopersicum',
        'category': 'Fruiting Solanaceae',
        'target_temp_c': [20.0, 26.0],
        'target_humidity_pct': [55.0, 70.0],
        'target_soil_pct': [50.0, 70.0],
        'watering_threshold_pct': 45.0,
        'target_dli_mol': 16.0,
        'photoperiod_hours': 14.0,
        'optimal_vpd_kpa': [0.8, 1.2],
        'icon': '🍅',
        'notes': 'High light demand; requires balanced calcium to avoid blossom end rot.',
    },
    'basil': {
        'key': 'basil',
        'name': 'Genovese Sweet Basil',
        'scientific_name': 'Ocimum basilicum',
        'category': 'Culinary Herb',
        'target_temp_c': [20.0, 25.0],
        'target_humidity_pct': [50.0, 65.0],
        'target_soil_pct': [60.0, 80.0],
        'watering_threshold_pct': 55.0,
        'target_dli_mol': 12.0,
        'photoperiod_hours': 12.0,
        'optimal_vpd_kpa': [0.7, 1.1],
        'icon': '🌿',
        'notes': 'Prefers consistent rhizosphere moisture and warm ambient air.',
    },
    'strawberry': {
        'key': 'strawberry',
        'name': 'Eversweet Strawberry',
        'scientific_name': 'Fragaria × ananassa',
        'category': 'Berry Crop',
        'target_temp_c': [18.0, 24.0],
        'target_humidity_pct': [60.0, 75.0],
        'target_soil_pct': [55.0, 70.0],
        'watering_threshold_pct': 50.0,
        'target_dli_mol': 14.0,
        'photoperiod_hours': 12.0,
        'optimal_vpd_kpa': [0.6, 1.0],
        'icon': '🍓',
        'notes': 'Requires high crown aeration and balanced solar radiation.',
    },
    'lettuce': {
        'key': 'lettuce',
        'name': 'Butterhead Lettuce',
        'scientific_name': 'Lactuca sativa',
        'category': 'Leafy Green',
        'target_temp_c': [15.0, 21.0],
        'target_humidity_pct': [50.0, 70.0],
        'target_soil_pct': [65.0, 85.0],
        'watering_threshold_pct': 60.0,
        'target_dli_mol': 10.0,
        'photoperiod_hours': 12.0,
        'optimal_vpd_kpa': [0.5, 0.9],
        'icon': '🥬',
        'notes': 'Cool-season crop; elevated heat causes bolting and tip burn.',
    },
    'succulent': {
        'key': 'succulent',
        'name': 'Desert Aloe / Echeveria',
        'scientific_name': 'Aloe barbadensis',
        'category': 'Xerophytic Succulent',
        'target_temp_c': [21.0, 32.0],
        'target_humidity_pct': [30.0, 50.0],
        'target_soil_pct': [15.0, 35.0],
        'watering_threshold_pct': 18.0,
        'target_dli_mol': 18.0,
        'photoperiod_hours': 10.0,
        'optimal_vpd_kpa': [1.2, 1.6],
        'icon': '🌵',
        'notes': 'Requires deep soak-and-dry irrigation cycles and low humidity.',
    },
    'monstera': {
        'key': 'monstera',
        'name': 'Swiss Cheese Plant',
        'scientific_name': 'Monstera deliciosa',
        'category': 'Tropical Aroid',
        'target_temp_c': [20.0, 28.0],
        'target_humidity_pct': [60.0, 80.0],
        'target_soil_pct': [40.0, 60.0],
        'watering_threshold_pct': 35.0,
        'target_dli_mol': 8.0,
        'photoperiod_hours': 10.0,
        'optimal_vpd_kpa': [0.6, 1.0],
        'icon': '🪴',
        'notes': 'Thrives in warm, humid microclimates with indirect light.',
    }
}

ACTIVE_CROP_KEY = 'tomato'


@api_bp.route('/crops/profiles', methods=['GET'])
def list_crop_profiles():
    """Retrieve full catalog of botanical crop profiles."""
    return jsonify({
        'success': True,
        'active_crop_key': ACTIVE_CROP_KEY,
        'profiles': list(CROP_PROFILES.values()),
    }), 200


@api_bp.route('/crops/active', methods=['GET', 'POST'])
def manage_active_crop():
    """Get or configure active botanical species profile."""
    global ACTIVE_CROP_KEY
    if request.method == 'POST':
        payload = request.get_json(silent=True) or {}
        crop_key = payload.get('crop_key', '').lower().strip()
        if crop_key in CROP_PROFILES:
            ACTIVE_CROP_KEY = crop_key
            profile = CROP_PROFILES[crop_key]
            # Automatically synchronize autonomous irrigation threshold to crop's optimal root requirement
            irrigation_manager.configure_auto_mode(
                enabled=irrigation_manager.auto_mode_enabled,
                threshold_pct=profile['watering_threshold_pct']
            )
            try:
                socketio.emit('crop_profile_update', {
                    'active_crop': profile,
                    'watering_threshold_pct': profile['watering_threshold_pct']
                })
            except Exception as e:
                current_app.logger.warning(f"SocketIO crop update warning: {e}")
            return jsonify({
                'success': True,
                'message': f"Active crop switched to {profile['name']}",
                'active_crop': profile,
            }), 200
        return jsonify({'success': False, 'error': 'INVALID_CROP', 'message': f"Unknown crop key '{crop_key}'"}), 400

    profile = CROP_PROFILES.get(ACTIVE_CROP_KEY, CROP_PROFILES['tomato'])
    return jsonify({'success': True, 'active_crop': profile}), 200


@api_bp.route('/sensors/dli', methods=['GET'])
def get_daily_light_integral():
    """Calculate accumulated Daily Light Integral (DLI) & photoperiod for today."""
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    readings = SensorReading.query.filter(
        SensorReading.timestamp >= today_start,
        SensorReading.light_lux.isnot(None)
    ).order_by(SensorReading.timestamp.asc()).all()

    # If few readings exist today, pull recent telemetry history
    if len(readings) < 5:
        readings = SensorReading.query.filter(
            SensorReading.light_lux.isnot(None)
        ).order_by(SensorReading.timestamp.desc()).limit(150).all()
        readings.reverse()

    accumulated_dli = 0.0
    active_photoperiod_seconds = 0.0
    latest_lux = 0.0

    for i in range(len(readings)):
        r = readings[i]
        lux = max(0.0, r.light_lux or 0.0)
        latest_lux = lux
        ppfd = lux / 54.0  # ~54 Lux per umol/m2/s for broad-spectrum sunlight
        
        if i < len(readings) - 1:
            dt = (readings[i+1].timestamp - r.timestamp).total_seconds()
            dt = max(1.0, min(dt, 60.0))
        else:
            dt = 6.0  # 6-second cadence
        
        accumulated_dli += ppfd * dt * 1e-6
        if lux >= 200.0:  # Active daylight threshold
            active_photoperiod_seconds += dt

    crop = CROP_PROFILES.get(ACTIVE_CROP_KEY, CROP_PROFILES['tomato'])
    target_dli = crop['target_dli_mol']
    progress_pct = round(min(100.0, (accumulated_dli / target_dli) * 100.0), 1) if target_dli > 0 else 0.0

    return jsonify({
        'success': True,
        'date': today_start.strftime('%Y-%m-%d'),
        'accumulated_dli': round(accumulated_dli, 2),
        'target_dli': target_dli,
        'progress_pct': progress_pct,
        'photoperiod_hours': round(active_photoperiod_seconds / 3600.0, 1),
        'photoperiod_target_hours': crop['photoperiod_hours'],
        'current_lux': latest_lux,
        'current_ppfd': round(latest_lux / 54.0, 1),
        'active_crop': crop,
    }), 200


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


@api_bp.route('/weather/compare', methods=['GET', 'POST'])
def compare_sensor_weather():
    """Compare real on-site hardware sensor readings against external meteorological ground-truth."""
    sensor_temp = None
    sensor_hum = None
    device_id = None

    if request.method == 'POST':
        data = request.get_json() or {}
        sensor_temp = data.get('temperature_c')
        sensor_hum = data.get('humidity_pct')
        device_id = data.get('device_id')
    else:
        t_arg = request.args.get('temp')
        h_arg = request.args.get('hum')
        if t_arg is not None:
            try:
                sensor_temp = float(t_arg)
            except ValueError:
                pass
        if h_arg is not None:
            try:
                sensor_hum = float(h_arg)
            except ValueError:
                pass

    comparison = weather_service.compare_sensor_to_weather(
        sensor_temp=sensor_temp,
        sensor_humidity=sensor_hum,
        device_id=device_id
    )
    return jsonify(comparison), 200


# ============================================================================
# AI Agronomist & Botanical Copilot Chatbot
# ============================================================================

@api_bp.route('/chat', methods=['POST'])
def chat():
    """Interactive agronomic consulting endpoint with live microclimate & pathology context."""
    from app.services.chatbot_service import chatbot_service
    data = request.get_json() or {}
    message = data.get('message', '').strip()
    history = data.get('history', [])

    if not message:
        return jsonify({
            'success': False,
            'error': 'EMPTY_MESSAGE',
            'reply': 'Please provide an agronomic question or request.'
        }), 400

    response = chatbot_service.ask(message, conversation_history=history)
    return jsonify(response), 200


@api_bp.route('/chat/suggestions', methods=['GET'])
def chat_suggestions():
    """Retrieve dynamic, context-aware prompt suggestions."""
    from app.services.chatbot_service import chatbot_service
    suggestions = chatbot_service.get_smart_suggestions()
    context = chatbot_service.get_context_snapshot()
    return jsonify({
        'success': True,
        'suggestions': suggestions,
        'context': context
    }), 200


# ============================================================================
# Advanced Geospatial, Biodiversity, Solar & Multimodal AI APIs
# ============================================================================

@api_bp.route('/soil/geospatial', methods=['GET'])
def get_soil_geospatial():
    """Query ISRIC SoilGrids for native soil texture, pH, bulk density & drainage capacity."""
    try:
        lat = float(request.args.get('lat', 13.0827))
        lon = float(request.args.get('lon', 80.2707))
    except (ValueError, TypeError):
        lat, lon = 13.0827, 80.2707
    profile = soil_geospatial_service.get_soil_profile(lat, lon)
    return jsonify(profile), 200


@api_bp.route('/biodiversity/species', methods=['GET'])
def get_biodiversity_species():
    """Query Global Biodiversity Information Facility (GBIF) for canonical taxonomy."""
    query_name = request.args.get('name', '').strip()
    if not query_name:
        # Default to current active crop name
        crop = CROP_PROFILES.get(ACTIVE_CROP_KEY, CROP_PROFILES['tomato'])
        query_name = crop.get('scientific_name', 'Solanum lycopersicum')
    result = gbif_service.match_species(query_name)
    return jsonify(result), 200


@api_bp.route('/weather/solar', methods=['GET'])
def get_solar_weather():
    """Query Open-Meteo for real-time solar irradiance (DNI, GHI) and outdoor soil temperature."""
    try:
        lat = float(request.args.get('lat', 13.0827)) if request.args.get('lat') else None
        lon = float(request.args.get('lon', 80.2707)) if request.args.get('lon') else None
    except (ValueError, TypeError):
        lat, lon = None, None
    solar = weather_service.fetch_solar_radiation(lat, lon)
    return jsonify(solar), 200


@api_bp.route('/diagnose/multimodal', methods=['POST'])
def diagnose_multimodal():
    """Multimodal Vision AI diagnosis analyzing biological diseases & abiotic nutritional disorders."""
    image_bytes = None
    filename = "leaf.jpg"
    plant_name = request.form.get('plant_name') or request.args.get('plant_name') or "Specimen"

    if 'image' in request.files:
        file = request.files['image']
        if file.filename:
            filename = file.filename
        image_bytes = file.read()
    else:
        payload = request.get_json(silent=True) or {}
        b64 = payload.get('image_base64')
        if b64:
            if ',' in b64:
                b64 = b64.split(',', 1)[1]
            image_bytes = base64.b64decode(b64)
            plant_name = payload.get('plant_name', plant_name)

    if not image_bytes:
        return jsonify({
            'success': False,
            'error': 'NO_IMAGE',
            'message': 'No leaf image provided for multimodal diagnosis'
        }), 400

    result = multimodal_vision_service.diagnose_image(image_bytes, filename=filename, crop_context=plant_name)

    # Persist in SQLite Diagnosis log
    try:
        diag = Diagnosis(
            plant_name=result.get('crop_identified', plant_name),
            disease_name=result.get('primary_diagnosis', 'Healthy / No Disease Detected'),
            confidence=float(result.get('confidence_percentage', 85)),
            image_url=filename,
            raw_response=json.dumps(result)[:5000],
        )
        db.session.add(diag)
        db.session.commit()
        try:
            socketio.emit('diagnosis_update', diag.to_dict())
        except Exception as e:
            current_app.logger.warning(f"SocketIO diagnosis emit warning: {e}")
        result['diagnosis_id'] = diag.id
    except Exception as e:
        current_app.logger.error(f"Error saving multimodal diagnosis: {e}")

    return jsonify(result), 200

# ============================================================================
# Advanced Agronomic Biophysics, Fleet Management & Telegram Alerts
# ============================================================================

@api_bp.route('/agronomy/analytics', methods=['GET'])
def get_agronomic_analytics():
    """Returns FAO-56 ET0, water depletion forecaster, fungal spore risk, and GDD phenology."""
    latest = SensorReading.query.order_by(SensorReading.timestamp.desc()).first()
    telem = latest.to_dict() if latest else None
    crop_key = request.args.get('crop_key', ACTIVE_CROP_KEY)
    analytics = agronomic_analytics.get_full_analytics(telem, crop_key=crop_key)
    return jsonify(analytics), 200


@api_bp.route('/fleet/zones', methods=['GET'])
def get_fleet_zones():
    """Retrieve all greenhouse bays and hydroponic racks in multi-node fleet."""
    latest = SensorReading.query.order_by(SensorReading.timestamp.desc()).first()
    telem = latest.to_dict() if latest else None
    zones = fleet_service.get_all_zones(telem)
    return jsonify({
        'success': True,
        'active_zone_id': fleet_service.active_zone_id,
        'zones': zones
    }), 200


@api_bp.route('/fleet/select', methods=['POST'])
def select_fleet_zone():
    """Switch active console greenhouse zone."""
    data = request.get_json(silent=True) or {}
    zone_id = data.get('zone_id')
    success, zone = fleet_service.set_active_zone(zone_id)
    if success:
        return jsonify({'success': True, 'active_zone': zone}), 200
    return jsonify({'success': False, 'message': f'Zone {zone_id} not found'}), 404


@api_bp.route('/telegram/status', methods=['GET'])
def get_telegram_status():
    """Check Telegram bot configuration and connectivity state."""
    return jsonify({
        'success': True,
        'configured': telegram_bot.is_configured,
        'bot_token_masked': '••••••••' if telegram_bot.bot_token else None,
        'chat_id': telegram_bot.chat_id if telegram_bot.chat_id else None,
        'mode': 'LIVE' if telegram_bot.is_configured else 'SIMULATED STANDBY'
    }), 200


@api_bp.route('/telegram/test', methods=['POST'])
def send_telegram_test():
    """Send test alert pulse to Telegram."""
    latest = SensorReading.query.order_by(SensorReading.timestamp.desc()).first()
    t = latest.temperature_c if latest else 24.2
    h = latest.humidity_pct if latest else 62.0
    s = latest.soil_moisture_pct if latest else 55.0
    l = latest.light_lux if latest else 1250
    test_msg = (
        f"🌿 <b>SYNTERRA // TEST TELEGRAM ALERT PULSE</b>\n\n"
        f"✅ <b>Status:</b> Telemetry Link Online\n"
        f"🌡️ <b>Temp:</b> {t}°C | <b>RH:</b> {h}%\n"
        f"🌱 <b>Soil:</b> {s}% | <b>Lux:</b> {l}\n"
        f"🕒 <i>{datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}</i>"
    )
    res = telegram_bot.send_message(test_msg)
    return jsonify(res), 200


@api_bp.route('/telegram/command', methods=['POST'])
def execute_telegram_command():
    """Execute remote command (/status, /water <sec>, /stop, /help)."""
    data = request.get_json(silent=True) or {}
    command = data.get('command', '/status')
    result = telegram_bot.execute_command(command)
    return jsonify(result), 200



# ============================================================================
# WhatsApp Farm Manager & Instant Notification Endpoints
# ============================================================================

@api_bp.route('/whatsapp/status', methods=['GET'])
def get_whatsapp_status():
    """Check WhatsApp notification gateway status."""
    return jsonify(whatsapp_bot.get_status()), 200


@api_bp.route('/whatsapp/test', methods=['POST'])
def send_whatsapp_test():
    """Send test alert pulse to WhatsApp."""
    latest = SensorReading.query.order_by(SensorReading.timestamp.desc()).first()
    t = latest.temperature_c if latest else 24.2
    h = latest.humidity_pct if latest else 62.0
    s = latest.soil_moisture_pct if latest else 55.0
    l = latest.light_lux if latest else 1250
    test_msg = (
        f"🌿 *SYNTERRA // TEST WHATSAPP ALERT PULSE*\n\n"
        f"✅ *Status:* Telemetry Gateway Online\n"
        f"🌡️ *Temp:* {t}°C | *RH:* {h}%\n"
        f"🌱 *Soil:* {s}% | *Lux:* {l}\n"
        f"🕒 _{datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}_"
    )
    res = whatsapp_bot.send_message(test_msg)
    return jsonify(res), 200


@api_bp.route('/whatsapp/command', methods=['POST'])
def execute_whatsapp_command():
    """Execute remote command via WhatsApp (/status, /water <sec>, /stop, /help)."""
    data = request.get_json(silent=True) or {}
    command = data.get('command', '/status')
    result = whatsapp_bot.execute_command(command)
    return jsonify(result), 200


@api_bp.route('/whatsapp/config', methods=['POST'])
def configure_whatsapp():
    """Update runtime phone number and CallMeBot API key."""
    data = request.get_json(silent=True) or {}
    phone = data.get('phone', '').strip()
    api_key = data.get('api_key', '').strip()
    if phone:
        whatsapp_bot.phone = phone
        os.environ['WHATSAPP_PHONE'] = phone
    if api_key:
        whatsapp_bot.api_key = api_key
        os.environ['CALLMEBOT_API_KEY'] = api_key
    return jsonify({
        'success': True,
        'message': 'WhatsApp credentials updated successfully!',
        'status': whatsapp_bot.get_status()
    }), 200
