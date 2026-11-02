import os
from pathlib import Path
from dotenv import load_dotenv
from flask import Flask, send_from_directory, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
from flask_wtf.csrf import CSRFProtect
from flask_socketio import SocketIO

db = SQLAlchemy()
csrf = CSRFProtect()
socketio = SocketIO(cors_allowed_origins="*", async_mode="threading")

basedir = Path(__file__).resolve().parent.parent

# Load environment variables from .env
load_dotenv(basedir / '.env')

# Ensure instance directory exists
Path(basedir / 'instance').mkdir(parents=True, exist_ok=True)


def create_app():
    app = Flask(__name__, template_folder='templates', static_folder='static')
    app.config.from_mapping(
        SECRET_KEY=os.getenv('SECRET_KEY', 'dev-secret-change-me'),
        SQLALCHEMY_DATABASE_URI=f'sqlite:///{basedir / "instance" / "plant_doctor.db"}',
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        PLANT_API_KEY=os.getenv('PLANT_API_KEY', '').strip(),
        PLANT_API_BASE_URL=os.getenv('PLANT_API_BASE_URL', 'https://crop.kindwise.com/api/v1').rstrip('/'),
        DEVICE_TOKEN=os.getenv('DEVICE_TOKEN', 'plant-lab-auth-token-9981').strip(),
        ESP32_BASE_URL=os.getenv('ESP32_BASE_URL', 'http://192.168.1.150').rstrip('/'),
    )

    db.init_app(app)
    csrf.init_app(app)
    socketio.init_app(app)

    # Register blueprints
    from app.routes.main import main_bp
    from app.routes.api import api_bp

    app.register_blueprint(main_bp)
    app.register_blueprint(api_bp, url_prefix='/api')
    csrf.exempt(api_bp)  # API endpoints are used by ESP32, curl, mobile apps — no CSRF needed

    # Serve built React dashboard if present
    @app.route('/dashboard')
    @app.route('/dashboard/')
    @app.route('/dashboard/<path:path>')
    def serve_dashboard(path=''):
        dist_dir = basedir / 'frontend' / 'dist'
        if path and (dist_dir / path).exists():
            return send_from_directory(dist_dir, path)
        if (dist_dir / 'index.html').exists():
            return send_from_directory(dist_dir, 'index.html')
        return redirect(url_for('main.index'))

    # WebSocket connection handlers
    @socketio.on('connect')
    def handle_connect():
        from app.models.sensor import SensorReading
        latest = SensorReading.query.order_by(SensorReading.timestamp.desc()).first()
        if latest:
            socketio.emit('telemetry_update', latest.to_dict())

    @socketio.on('request_latest')
    def handle_request_latest():
        from app.models.sensor import SensorReading
        latest = SensorReading.query.order_by(SensorReading.timestamp.desc()).first()
        if latest:
            socketio.emit('telemetry_update', latest.to_dict())

    # Create tables
    with app.app_context():
        db.create_all()

    return app