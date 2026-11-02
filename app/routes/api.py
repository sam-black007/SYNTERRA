from flask import Blueprint, jsonify, request, current_app
from app import db
from app.models.diagnosis import Diagnosis
from app.services.plantid_client import PlantIdClient

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

    # Parse crop.health v1 response (disease suggestions under result.disease.suggestions)
    disease_name = None
    confidence = None
    try:
        result_data = result.get('result', {})
        disease = result_data.get('disease', {})
        suggestions = disease.get('suggestions', [])
        if suggestions:
            top = suggestions[0]
            disease_name = top.get('name')
            confidence = top.get('probability', 0) * 100
    except Exception:
        pass

    # Save
    diag = Diagnosis(
        plant_name=request.form.get('plant_name', 'Unknown'),
        disease_name=disease_name,
        confidence=confidence,
        image_url=file.filename or 'uploaded.jpg',
        raw_response=str(result)[:5000],
    )
    db.session.add(diag)
    db.session.commit()

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