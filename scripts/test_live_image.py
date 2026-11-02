#!/usr/bin/env python3
"""
SYNTERRA — Real Image Live Diagnosis Test
Sends a real botanical leaf photograph to the live SYNTERRA server and Kindwise API.
"""

import io
import time
import requests
from PIL import Image

SERVER_URL = "http://127.0.0.1:5000/api/diagnose"


def run_live_image_test():
    print("=" * 72)
    print("SYNTERRA — REAL IMAGE LIVE DIAGNOSIS TEST")
    print(f"Server Target: {SERVER_URL}")
    print("=" * 72)

    # 1. Load and optimize image for upload (max 1024x1024)
    from pathlib import Path
    sample_path = Path(__file__).resolve().parent.parent / "tests" / "samples" / "tomato_blight.jpg"
    if not sample_path.exists():
        sample_path = Path("test_leaf.jpg")

    print(f"\n[1/3] Loading real tomato leaf photograph ({sample_path.name})...")
    img = Image.open(sample_path)
    img.thumbnail((1024, 1024))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    image_bytes = buf.getvalue()
    print(f"      Image dimensions: {img.size} | Encoded size: {len(image_bytes)/1024:.1f} KB")

    # 2. Transmit to live server endpoint
    print("\n[2/3] Transmitting image to live /api/diagnose endpoint...")
    t0 = time.time()
    resp = requests.post(
        SERVER_URL,
        files={"image": ("tomato_blight_sample.jpg", image_bytes, "image/jpeg")},
        data={"plant_name": "Tomato"},
        timeout=30,
    )
    latency = time.time() - t0

    if resp.status_code != 200:
        print(f"\n[ERROR] Request failed with HTTP {resp.status_code}: {resp.text}")
        return

    data = resp.json()
    raw = data.get("raw", {}).get("result", {})

    print(f"      Request completed in {latency:.2f} seconds! (HTTP {resp.status_code})")

    # 3. Print parsed pathology results
    print("\n[3/3] Parsed Pathology Results:")
    print("-" * 72)
    print(f"Plant Species:         {data.get('diagnosis', {}).get('plant_name')}")
    print(f"Top Pathology:         {data.get('disease_name')}")
    print(f"Confidence Score:      {data.get('confidence'):.2f}%")
    print(f"Diagnosis Record ID:   #{data.get('diagnosis', {}).get('id')}")
    print(f"Created Timestamp:     {data.get('diagnosis', {}).get('created_at')}")

    # Crop identification
    crop_list = raw.get("crop", {}).get("suggestions", [])
    if crop_list:
        print("\nCrop Model Identification:")
        for c in crop_list[:3]:
            print(f"  * {c.get('name')} ({c.get('scientific_name')}) — {c.get('probability', 0)*100:.1f}%")

    # Disease classification ranked list
    disease_list = raw.get("disease", {}).get("suggestions", [])
    if disease_list:
        print("\nPathology Classification Ranking:")
        for idx, d in enumerate(disease_list[:5], 1):
            prob = d.get('probability', 0) * 100
            print(f"  {idx}. {d.get('name')} ({d.get('scientific_name')}) — {prob:.1f}%")

    # Check similar images returned by model
    if disease_list and disease_list[0].get("similar_images"):
        sim_imgs = disease_list[0].get("similar_images")
        print(f"\nVisual Reference Matches: {len(sim_imgs)} similar photos returned by Kindwise")

    print("\n" + "=" * 72)
    print("LIVE DIAGNOSIS TEST: SUCCESSFUL")
    print("=" * 72)


if __name__ == "__main__":
    run_live_image_test()
