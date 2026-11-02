import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.weather_service import weather_service

def test():
    print("Testing SYNTERRA 5-Day Weather Service...")
    res = weather_service.fetch_5day_forecast(force_refresh=True)
    assert res['success'] is True
    print("Location:", res['location']['city'], res['location']['region'], res['location']['country'])
    print("Overall Risk:", res['overall_risk'])
    print("Advisory:", res['overall_advisory'])
    print("Irrigation Rec:", res['irrigation_recommendation'])
    assert len(res['forecast']) == 5
    for day in res['forecast']:
        print(f" -> {day['day_name']} ({day['date_display']}): {day['condition']} | {day['temp_min']}C to {day['temp_max']}C | Rain: {day['precip_prob']}% | Risk: {day['risk_level']}")
    print("[SUCCESS] Weather Service verified perfectly!")

if __name__ == '__main__':
    test()
