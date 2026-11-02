import os
from app import create_app

app = create_app()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    host = os.environ.get('HOST', '0.0.0.0')
    print(f"SYNTERRA running at http://{host}:{port}")
    app.run(host=host, port=port, debug=True)