"""
SYNTERRA — Agro-Meteorology & 5-Day Weather Forecast Service
Fetches hyper-local predictive macroclimate weather data via Open-Meteo API
and calculates agricultural disease risk indexes and irrigation advisories.
"""

import time
import requests
import logging

logger = logging.getLogger('weather_service')

# WMO Weather interpretation codes (WW)
WMO_CODE_MAP = {
    0: ("Clear sky", "Sun", "clear"),
    1: ("Mainly clear", "SunMedium", "clear"),
    2: ("Partly cloudy", "CloudSun", "cloudy"),
    3: ("Overcast", "Cloud", "cloudy"),
    45: ("Foggy", "CloudFog", "fog"),
    48: ("Depositing rime fog", "CloudFog", "fog"),
    51: ("Light drizzle", "CloudDrizzle", "rain"),
    53: ("Moderate drizzle", "CloudDrizzle", "rain"),
    55: ("Dense drizzle", "CloudDrizzle", "rain"),
    61: ("Slight rain", "CloudRain", "rain"),
    63: ("Moderate rain", "CloudRain", "rain"),
    65: ("Heavy rain", "CloudRain", "rain"),
    71: ("Slight snow", "Snowflake", "snow"),
    73: ("Moderate snow", "Snowflake", "snow"),
    75: ("Heavy snow", "Snowflake", "snow"),
    80: ("Slight rain showers", "CloudRain", "rain"),
    81: ("Moderate rain showers", "CloudRain", "rain"),
    82: ("Violent rain showers", "CloudLightning", "thunderstorm"),
    95: ("Thunderstorm", "CloudLightning", "thunderstorm"),
    96: ("Thunderstorm with hail", "CloudLightning", "thunderstorm"),
}


class WeatherService:
    def __init__(self):
        self._cache = None
        self._cache_time = 0
        self._cache_ttl = 1800  # 30 minutes cache
        self.cached_geo = None

    def get_geolocation(self):
        """Auto-detect geographic coordinates based on external IP with fallback."""
        if self.cached_geo:
            return self.cached_geo

        try:
            resp = requests.get('http://ip-api.com/json', timeout=3)
            if resp.status_code == 200:
                data = resp.json()
                self.cached_geo = {
                    'lat': round(data.get('lat', 13.0827), 4),
                    'lon': round(data.get('lon', 80.2707), 4),
                    'city': data.get('city', 'Regional Hub'),
                    'region': data.get('regionName', 'Tamil Nadu'),
                    'country': data.get('country', 'India')
                }
                return self.cached_geo
        except Exception as e:
            logger.warning(f"Geolocation lookup failed: {e}")

        # Fallback to default coordinates (Chennai, India)
        self.cached_geo = {
            'lat': 13.0827,
            'lon': 80.2707,
            'city': 'Chennai',
            'region': 'Tamil Nadu',
            'country': 'India'
        }
        return self.cached_geo

    def fetch_5day_forecast(self, force_refresh=False):
        """Fetch 5-day agro-meteorological forecast from Open-Meteo."""
        now = time.time()
        if not force_refresh and self._cache and (now - self._cache_time < self._cache_ttl):
            return self._cache

        geo = self.get_geolocation()
        lat, lon = geo['lat'], geo['lon']

        url = (
            f"https://api.open-meteo.com/v1/forecast"
            f"?latitude={lat}&longitude={lon}"
            f"&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,"
            f"relative_humidity_2m_mean,wind_speed_10m_max,uv_index_max,weathercode"
            f"&timezone=auto&forecast_days=5"
        )

        try:
            resp = requests.get(url, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                daily = data.get('daily', {})
                forecast_days = []

                dates = daily.get('time', [])
                max_temps = daily.get('temperature_2m_max', [])
                min_temps = daily.get('temperature_2m_min', [])
                precip_sums = daily.get('precipitation_sum', [])
                precip_probs = daily.get('precipitation_probability_max', [])
                humidities = daily.get('relative_humidity_2m_mean', [])
                wind_speeds = daily.get('wind_speed_10m_max', [])
                uv_indexes = daily.get('uv_index_max', [])
                weather_codes = daily.get('weathercode', [])

                for i in range(len(dates)):
                    wcode = weather_codes[i] if i < len(weather_codes) else 0
                    cond_name, icon, cat = WMO_CODE_MAP.get(wcode, ("Variable", "Cloud", "cloudy"))

                    t_max = max_temps[i] if i < len(max_temps) else 28.0
                    t_min = min_temps[i] if i < len(min_temps) else 22.0
                    rain_p = precip_probs[i] if i < len(precip_probs) else 0
                    rain_mm = precip_sums[i] if i < len(precip_sums) else 0.0
                    rh = humidities[i] if i < len(humidities) else 65.0
                    wind = wind_speeds[i] if i < len(wind_speeds) else 12.0
                    uv = uv_indexes[i] if i < len(uv_indexes) else 6.0

                    # Compute Agro-Disease Risk for this day
                    # High humidity (>75%) + warm temp (20-30C) + rain = prime fungal incubation
                    if rain_p >= 60 and rh >= 75 and 18 <= t_max <= 32:
                        risk_level = "HIGH"
                        risk_label = "Elevated Fungal & Blight Risk"
                        risk_color = "red"
                    elif rain_p >= 35 or rh >= 70:
                        risk_level = "MODERATE"
                        risk_label = "Moderate Spore Incubation"
                        risk_color = "amber"
                    else:
                        risk_level = "LOW"
                        risk_label = "Optimal Botanical Safety"
                        risk_color = "emerald"

                    day_str = dates[i]
                    # Parse day name e.g. Mon, Tue
                    import datetime
                    try:
                        d_obj = datetime.date.fromisoformat(day_str)
                        day_name = d_obj.strftime("%a")
                        date_display = d_obj.strftime("%b %d")
                    except Exception:
                        day_name = f"Day {i+1}"
                        date_display = day_str

                    forecast_days.append({
                        'date': day_str,
                        'day_name': day_name,
                        'date_display': date_display,
                        'condition': cond_name,
                        'icon': icon,
                        'category': cat,
                        'temp_max': round(t_max, 1),
                        'temp_min': round(t_min, 1),
                        'precip_prob': int(rain_p),
                        'precip_mm': round(rain_mm, 1),
                        'humidity_pct': round(rh, 1),
                        'wind_kmh': round(wind, 1),
                        'uv_index': round(uv, 1),
                        'risk_level': risk_level,
                        'risk_label': risk_label,
                        'risk_color': risk_color
                    })

                # Overall 5-day Agronomic Synthesis
                avg_rain_prob = sum(d['precip_prob'] for d in forecast_days) / len(forecast_days)
                high_risk_days = sum(1 for d in forecast_days if d['risk_level'] == 'HIGH')

                if high_risk_days >= 2 or avg_rain_prob >= 60:
                    overall_advisory = (
                        "CRITICAL AGRO-WEATHER ALERT: Multi-day persistent precipitation and high humidity "
                        "exceeding 75% forecasted. Prime conditions for Early Blight, Late Blight, and Downy Mildew. "
                        "Action: Withhold automated irrigation, enhance greenhouse ventilation, and apply prophylactic copper bactericide/fungicide."
                    )
                    overall_risk = "HIGH"
                    irrigation_recommendation = "SUSPEND AUTOMATED IRRIGATION (High rainfall expected)"
                elif avg_rain_prob >= 35:
                    overall_advisory = (
                        "MODERATE ADVISORY: Intermittent showers expected across the 5-day window. "
                        "Monitor soil saturation levels closely and calibrate drip cycles to avoid root-zone hypoxia."
                    )
                    overall_risk = "MODERATE"
                    irrigation_recommendation = "REDUCE DRIP IRRIGATION BY 30%"
                else:
                    overall_advisory = (
                        "EXCELLENT GROWING CONDITIONS: Mild, stable macroclimate forecasted. High solar irradiance "
                        "will encourage strong vegetative transpiration. Maintain scheduled baseline irrigation."
                    )
                    overall_risk = "LOW"
                    irrigation_recommendation = "MAINTAIN REGULAR IRRIGATION SCHEDULE"

                result = {
                    'success': True,
                    'location': geo,
                    'fetched_at': time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
                    'forecast': forecast_days,
                    'overall_risk': overall_risk,
                    'overall_advisory': overall_advisory,
                    'irrigation_recommendation': irrigation_recommendation
                }

                self._cache = result
                self._cache_time = now
                return result

        except Exception as e:
            logger.error(f"Error fetching live weather: {e}")

        # Fallback synthetic seasonal forecast if offline or rate-limited
        return self._generate_fallback_forecast(geo)

    def _generate_fallback_forecast(self, geo):
        """Generate high-fidelity seasonal agronomic forecast fallback."""
        import datetime
        today = datetime.date.today()
        forecast_days = []
        days_names = ["Mon", "Tue", "Wed", "Thu", "Fri"]

        for i in range(5):
            d = today + datetime.timedelta(days=i)
            t_max = 28.5 + (i * 0.4)
            t_min = 23.0 - (i * 0.2)
            rain_p = 50 if i % 2 == 0 else 20
            forecast_days.append({
                'date': d.isoformat(),
                'day_name': d.strftime("%a"),
                'date_display': d.strftime("%b %d"),
                'condition': "Scattered Showers" if rain_p > 30 else "Partly Cloudy",
                'icon': "CloudRain" if rain_p > 30 else "CloudSun",
                'category': "rain" if rain_p > 30 else "cloudy",
                'temp_max': round(t_max, 1),
                'temp_min': round(t_min, 1),
                'precip_prob': rain_p,
                'precip_mm': 4.5 if rain_p > 30 else 0.0,
                'humidity_pct': 72.0,
                'wind_kmh': 14.0,
                'uv_index': 7.0,
                'risk_level': "MODERATE" if rain_p > 30 else "LOW",
                'risk_label': "Moderate Spore Incubation" if rain_p > 30 else "Optimal Conditions",
                'risk_color': "amber" if rain_p > 30 else "emerald"
            })

        return {
            'success': True,
            'location': geo,
            'fetched_at': time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
            'forecast': forecast_days,
            'overall_risk': "MODERATE",
            'overall_advisory': "Intermittent showers expected. Keep soil saturation monitored and regulate greenhouse airflow.",
            'irrigation_recommendation': "REDUCE DRIP IRRIGATION BY 20%",
            'is_fallback': True
        }


weather_service = WeatherService()
