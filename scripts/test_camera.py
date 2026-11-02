import requests
import time

def test_camera():
    print("Testing SYNTERRA Camera Endpoints...")
    t0 = time.time()
    res = requests.get('http://127.0.0.1:5000/api/camera/snapshot', timeout=3)
    snap_dur = round(time.time() - t0, 3)
    print(f"Snapshot test: status={res.status_code}, bytes={len(res.content)}, duration={snap_dur}s")
    assert res.status_code == 200
    assert len(res.content) > 5000
    assert 'image/jpeg' in res.headers.get('Content-Type', '')

    t0 = time.time()
    resp = requests.get('http://127.0.0.1:5000/api/camera/stream', stream=True, timeout=3)
    print(f"Stream connect: status={resp.status_code}, content-type={resp.headers.get('Content-Type')}")
    assert resp.status_code == 200

    data = b""
    for chunk in resp.iter_content(chunk_size=2048):
        data += chunk
        if len(data) >= 30000:
            break
    stream_dur = round(time.time() - t0, 3)
    resp.close()
    print(f"Stream test: received {len(data)} bytes in {stream_dur}s (~{round(len(data)/(stream_dur*1024), 1)} KB/s)")

    print("[SUCCESS] All camera streaming & snapshot checks passed perfectly!")

if __name__ == '__main__':
    test_camera()
