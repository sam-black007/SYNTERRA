import os
from pathlib import Path
from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_wtf.csrf import CSRFProtect

db = SQLAlchemy()
csrf = CSRFProtect()

basedir = Path(__file__).resolve().parent.parent

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
    )

    db.init_app(app)
    csrf.init_app(app)

    # Register blueprints
    from app.routes.main import main_bp
    from app.routes.api import api_bp

    app.register_blueprint(main_bp)
    app.register_blueprint(api_bp, url_prefix='/api')
    csrf.exempt(api_bp)  # API endpoints are used by ESP32, curl, mobile apps — no CSRF needed

    # Create tables
    with app.app_context():
        db.create_all()

    return app