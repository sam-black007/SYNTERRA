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

        # Parse Plant.id response
        disease_name = None
        confidence = None
        try:
            classifications = result.get('classifications', [])
            if classifications:
                top = classifications[0]
                disease_name = top.get('name')
                confidence = top.get('probability', 0) * 100
        except Exception:
            pass

        # Save to database
        diag = Diagnosis(
            plant_name=plant_name,
            disease_name=disease_name,
            confidence=confidence,
            image_url=file.filename or 'uploaded.jpg',
            raw_response=str(result)[:5000],
        )
        db.session.add(diag)
        db.session.commit()

        flash(f'Diagnosis complete: {disease_name or "Unknown"} ({confidence:.1f}% confidence)' if disease_name else 'Diagnosis completed but no disease identified.', 'success')
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