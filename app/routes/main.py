from flask import Blueprint, render_template, request, redirect, url_for, flash, current_app
from app import db
from app.models.diagnosis import Diagnosis
from app.services.plantid_client import PlantIdClient

main_bp = Blueprint('main', __name__)


@main_bp.route('/')
def index():
    client = PlantIdClient()
    recent = Diagnosis.query.order_by(Diagnosis.created_at.desc()).limit(10).all()
    return render_template('index.html',
                           is_configured=client.is_configured(),
                           masked_key=client.get_masked_key(),
                           recent=recent)


@main_bp.route('/pathology', methods=['GET', 'POST'])
def pathology():
    client = PlantIdClient()

    if not client.is_configured():
        flash('Plant.id API key not configured. Please go to Integrations and set PLANT_API_KEY.', 'error')
        return redirect(url_for('main.integrations'))

    if request.method == 'POST':
        if 'image' not in request.files:
            flash('No image file uploaded.', 'error')
            return redirect(request.url)

        file = request.files['image']
        if file.filename == '':
            flash('No image selected.', 'error')
            return redirect(request.url)

        plant_name = request.form.get('plant_name', 'Unknown plant')

        image_bytes = file.read()
        success, result = client.identify(image_bytes, filename=file.filename or 'leaf.jpg')

        if not success:
            flash(f"Diagnosis failed: {result.get('message', 'Unknown error')}", 'error')
            return redirect(request.url)

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

        # Auto-fill plant name if user left default
        if (not plant_name or plant_name in ('Unknown', 'Unknown plant', '')) and crop_name:
            plant_name = crop_name

        # Save to database
        diag = Diagnosis(
            plant_name=plant_name,
            disease_name=disease_name or 'Healthy / No Disease Detected',
            confidence=confidence,
            image_url=file.filename or 'uploaded.jpg',
            raw_response=str(result)[:5000],
        )
        db.session.add(diag)
        db.session.commit()

        if disease_name:
            flash(f'Diagnosis complete: {disease_name} ({confidence:.1f}% confidence)', 'success')
        else:
            flash(f'Diagnosis complete: {plant_name} appears healthy with no specific disease identified.', 'success')

        return redirect(url_for('main.diagnosis_detail', diag_id=diag.id))

    return render_template('pathology.html')


@main_bp.route('/diagnosis/<int:diag_id>')
def diagnosis_detail(diag_id):
    diag = Diagnosis.query.get_or_404(diag_id)
    return render_template('diagnosis_detail.html', diag=diag)


@main_bp.route('/integrations')
def integrations():
    client = PlantIdClient()
    status = client.test_connection() if client.is_configured() else {
        'success': False,
        'status': 'unconfigured',
        'message': 'API key not configured',
    }
    return render_template('integrations.html',
                           is_configured=client.is_configured(),
                           masked_key=client.get_masked_key(),
                           status=status)