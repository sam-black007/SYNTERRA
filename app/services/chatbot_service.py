"""
SYNTERRA — AI Agronomist & Botanical Copilot Service
Provides context-aware agronomic consulting, plant pathology remediation,
VPD microclimate optimization, and predictive irrigation intelligence.
Integrates live canopy telemetry, Kindwise diagnostics, and 5-day weather.
Supports Gemini API with an enterprise botanical knowledge engine fallback.
"""

import os
import math
import time
import logging
from datetime import datetime, timezone
from app import db
from app.models.sensor import SensorReading
from app.models.diagnosis import Diagnosis
from app.services.weather_service import weather_service
from app.services.irrigation_controller import irrigation_manager

logger = logging.getLogger('chatbot_service')


class ChatbotService:
    def __init__(self):
        self.gemini_key = os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY')

    def calculate_vpd(self, temp_c, humidity_pct):
        """Calculate Vapor Pressure Deficit (VPD) in kPa."""
        if temp_c is None or humidity_pct is None:
            return None
        try:
            # Tetens formula for saturation vapor pressure (kPa)
            vp_sat = 0.61078 * math.exp((17.27 * temp_c) / (temp_c + 237.3))
            vp_act = vp_sat * (humidity_pct / 100.0)
            return round(vp_sat - vp_act, 2)
        except Exception:
            return None

    def get_context_snapshot(self):
        """Retrieve real-time telemetry, pathology, weather, and irrigation context."""
        context = {
            'telemetry': None,
            'diagnosis': None,
            'weather': None,
            'irrigation': None,
            'vpd': None,
            'vpd_status': 'Unknown',
            'specimen_name': 'Greenhouse Specimen'
        }

        try:
            # 1. Latest Sensor Telemetry
            latest_sensor = SensorReading.query.order_by(SensorReading.timestamp.desc()).first()
            if latest_sensor:
                vpd = self.calculate_vpd(latest_sensor.temperature_c, latest_sensor.humidity_pct)
                vpd_status = 'Optimal'
                if vpd is not None:
                    if vpd < 0.5:
                        vpd_status = 'Under-transpiring (Foliar Wetness / Fungal Risk)'
                    elif vpd > 1.4:
                        vpd_status = 'High Transpiration Stress (Stomatal Closure)'

                context['telemetry'] = {
                    'temperature_c': latest_sensor.temperature_c,
                    'humidity_pct': latest_sensor.humidity_pct,
                    'soil_moisture_pct': latest_sensor.soil_moisture_pct,
                    'light_lux': latest_sensor.light_lux,
                    'timestamp': latest_sensor.timestamp.strftime("%H:%M:%S UTC") if latest_sensor.timestamp else None
                }
                context['vpd'] = vpd
                context['vpd_status'] = vpd_status

            # 2. Latest Pathology Diagnosis
            latest_diag = Diagnosis.query.order_by(Diagnosis.created_at.desc()).first()
            if latest_diag:
                context['diagnosis'] = {
                    'plant_name': latest_diag.plant_name,
                    'disease_name': latest_diag.disease_name,
                    'confidence': round(latest_diag.confidence, 1) if latest_diag.confidence else None,
                    'timestamp': latest_diag.created_at.strftime("%Y-%m-%d %H:%M") if latest_diag.created_at else None
                }
                if latest_diag.plant_name and latest_diag.plant_name != 'Unknown':
                    context['specimen_name'] = latest_diag.plant_name

            # 3. 5-Day Weather Forecast
            w_data = weather_service.fetch_5day_forecast()
            if w_data and w_data.get('success'):
                today_forecast = w_data.get('forecast', [{}])[0] if w_data.get('forecast') else {}
                context['weather'] = {
                    'overall_risk': w_data.get('overall_risk', 'LOW'),
                    'advisory_title': w_data.get('advisory_title', 'Macroclimate Status'),
                    'rain_prob_today': today_forecast.get('precip_prob', 0),
                    'humidity_today': today_forecast.get('humidity_pct', 65.0),
                    'irrigation_directive': w_data.get('irrigation_directive', 'Standard baseline irrigation')
                }

            # 4. Irrigation Controller Status
            irrig_status = irrigation_manager.get_status()
            context['irrigation'] = {
                'mode': irrig_status.get('mode', 'auto'),
                'is_watering': irrig_status.get('is_watering', False),
                'moisture_threshold': irrig_status.get('threshold', 40.0)
            }

        except Exception as e:
            logger.error(f"Error compiling agronomic context: {e}")

        return context

    def get_smart_suggestions(self):
        """Generate dynamic context-aware suggestion chips."""
        ctx = self.get_context_snapshot()
        suggestions = []

        diag = ctx.get('diagnosis')
        weather = ctx.get('weather')
        telemetry = ctx.get('telemetry')

        # Disease suggestion
        if diag and diag.get('disease_name') and 'healthy' not in diag.get('disease_name', '').lower():
            disease = diag['disease_name']
            suggestions.append(f"What is the treatment protocol for {disease}?")
        else:
            suggestions.append("How do I prevent Early Blight in humid conditions?")

        # Weather / Pathogen Risk suggestion
        if weather and weather.get('overall_risk') == 'HIGH':
            suggestions.append("Why is the pathogen incubation risk elevated?")
        else:
            suggestions.append("Explain the 5-day disease vector forecast.")

        # Irrigation suggestion
        if telemetry and telemetry.get('soil_moisture_pct') is not None:
            sm = telemetry['soil_moisture_pct']
            if sm < 35:
                suggestions.append("Substrate is low. Should I trigger automated irrigation?")
            elif sm > 70:
                suggestions.append("Soil moisture is high. Is there a root rot risk?")
            else:
                suggestions.append("Is current substrate moisture optimal?")
        else:
            suggestions.append("Should I irrigate given today's rain probability?")

        # Microclimate / VPD
        suggestions.append("Analyze current canopy VPD and transpiration rate.")

        return suggestions[:4]

    def ask(self, message, conversation_history=None):
        """Process an agronomic question and return structured advice."""
        if not message or not message.strip():
            return {
                'success': False,
                'error': 'EMPTY_MESSAGE',
                'reply': 'Please enter an agronomic question or select one of the suggested prompts.'
            }

        user_msg = message.strip()
        ctx = self.get_context_snapshot()

        # Check if Gemini API is available (from .env or environment)
        gemini_api_key = (
            os.environ.get('GEMINI_API_KEY')
            or os.environ.get('GOOGLE_API_KEY')
            or self.gemini_key
        )
        if gemini_api_key:
            try:
                gemini_reply = self._query_gemini(user_msg, ctx, conversation_history, gemini_api_key)
                if gemini_reply:
                    return {
                        'success': True,
                        'reply': gemini_reply,
                        'source': 'gemini_pro_agronomist',
                        'context_snapshot': ctx,
                        'timestamp': datetime.now(timezone.utc).strftime("%H:%M:%S UTC")
                    }
            except Exception as e:
                logger.warning(f"Gemini API invocation fallback to botanical engine: {e}")

        # Authoritative Native Botanical & Agronomic Expert Core
        botanical_reply = self._botanical_expert_engine(user_msg, ctx)
        return {
            'success': True,
            'reply': botanical_reply,
            'source': 'synterra_botanical_engine',
            'context_snapshot': ctx,
            'timestamp': datetime.now(timezone.utc).strftime("%H:%M:%S UTC")
        }

    def _query_gemini(self, message, ctx, history, api_key):
        """Call Gemini model with deep agronomic context."""
        import requests

        system_instruction = (
            "You are SYNTERRA's AI Senior Agronomist and Botanical Pathology Copilot (TerraAI). "
            "You provide authoritative, scientifically rigorous, and highly actionable agricultural advice. "
            "Always include practical treatment recommendations, dosage rates, application timing, withholding periods (PHI), "
            "and environmental adjustments. Format your answers with clean markdown headings (###), bullet points, and bold text. "
            "Directly reference the user's real-time canopy telemetry, latest pathology diagnosis, and 5-day weather forecast."
        )

        context_prompt = (
            f"LIVE GREENHOUSE & CANOPY TELEMETRY:\n"
            f"- Specimen: {ctx.get('specimen_name')}\n"
            f"- Latest Diagnosis: {ctx.get('diagnosis', {}).get('disease_name', 'None')} "
            f"(Confidence: {ctx.get('diagnosis', {}).get('confidence', 'N/A')}%)\n"
            f"- Canopy Temperature: {ctx.get('telemetry', {}).get('temperature_c', 'N/A')} °C\n"
            f"- Relative Humidity: {ctx.get('telemetry', {}).get('humidity_pct', 'N/A')} %\n"
            f"- Substrate Moisture: {ctx.get('telemetry', {}).get('soil_moisture_pct', 'N/A')} %\n"
            f"- Ambient Lux: {ctx.get('telemetry', {}).get('light_lux', 'N/A')} Lux\n"
            f"- Calculated VPD: {ctx.get('vpd', 'N/A')} kPa ({ctx.get('vpd_status')})\n"
            f"- 5-Day Weather Outlook: {ctx.get('weather', {}).get('overall_risk')} Risk, "
            f"Rain prob {ctx.get('weather', {}).get('rain_prob_today')}% today. "
            f"Directive: {ctx.get('weather', {}).get('irrigation_directive')}\n\n"
            f"USER QUERY: {message}"
        )

        candidate_models = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-flash-latest']

        for model in candidate_models:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
            payload = {
                "contents": [
                    {
                        "role": "user",
                        "parts": [{"text": f"{system_instruction}\n\n{context_prompt}"}]
                    }
                ],
                "generationConfig": {
                    "temperature": 0.35,
                    "maxOutputTokens": 1024
                }
            }

            try:
                resp = requests.post(url, json=payload, timeout=9)
                if resp.status_code == 200:
                    data = resp.json()
                    candidates = data.get('candidates', [])
                    if candidates:
                        parts = candidates[0].get('content', {}).get('parts', [])
                        if parts:
                            return parts[0].get('text', '')
            except Exception as e:
                logger.warning(f"Error querying Gemini model {model}: {e}")

        return None

    def _botanical_expert_engine(self, query, ctx):
        """
        High-precision domain-specific agronomic inference engine.
        Processes queries covering disease treatment, microclimate optimization,
        irrigation scheduling, and crop nutrition.
        """
        q = query.lower()
        t = ctx.get('telemetry') or {}
        d = ctx.get('diagnosis') or {}
        w = ctx.get('weather') or {}
        vpd = ctx.get('vpd')

        temp = t.get('temperature_c', 24.0)
        rh = t.get('humidity_pct', 65.0)
        sm = t.get('soil_moisture_pct', 50.0)
        diag_name = d.get('disease_name', 'Healthy')
        diag_conf = d.get('confidence', 0.0)
        plant_name = ctx.get('specimen_name', 'Solanaceous Crop (Tomato/Pepper)')

        # ====================================================================
        # INTENT 1: Current Specimen Status / Canopy Health Briefing
        # ====================================================================
        if any(kw in q for kw in ['status', 'how is my plant', 'health check', 'canopy check', 'overview', 'summary']):
            vpd_note = "Optimal for vegetative transpiration" if vpd and 0.8 <= vpd <= 1.2 else "Sub-optimal: monitor boundary layer humidity"
            return (
                f"### 🌿 Specimen Health & Microclimate Briefing\n\n"
                f"**Specimen:** `{plant_name}` | **Telemetry Sync:** `{t.get('timestamp', 'Live')}`\n\n"
                f"- **Pathology Status:** {diag_name} ({diag_conf}% confidence)\n"
                f"- **Canopy Microclimate:** {temp}°C | **RH:** {rh}% | **Substrate Moisture:** {sm}%\n"
                f"- **Vapor Pressure Deficit (VPD):** `{vpd} kPa` — *{vpd_note}*\n"
                f"- **Macroclimate Outlook:** `{w.get('overall_risk', 'LOW')}` Pathogen Pressure ({w.get('rain_prob_today', 0)}% precipitation today)\n\n"
                f"#### Agronomic Recommendation:\n"
                f"1. **Irrigation:** {w.get('irrigation_directive', 'Maintain baseline scheduled irrigation.')}\n"
                f"2. **Canopy Dynamics:** {'Increase horizontal airflow to promote leaf drying.' if rh > 70 else 'Environmental transpiration balance is stable.'}\n"
                f"3. **Pathology Watch:** {'Initiate preventive bio-fungicide treatment.' if 'blight' in diag_name.lower() or w.get('overall_risk') == 'HIGH' else 'Routine monitoring without chemical intervention.'}"
            )

        # ====================================================================
        # INTENT 2: Irrigation & Watering Inquiries
        # ====================================================================
        if any(kw in q for kw in ['water', 'irrigate', 'irrigation', 'soil moisture', 'substrate', 'drip']):
            rain_p = w.get('rain_prob_today', 0)
            if sm > 70 or rain_p >= 50:
                action = "**SUSPEND automated drip irrigation.**"
                reason = f"Substrate moisture is currently elevated at **{sm}%** and predictive weather models project **{rain_p}% precipitation**. Further irrigation will induce root-zone waterlogging, oxygen starvation (hypoxia), and elevate *Pythium* / *Phytophthora* root-rot vector."
            elif sm < 35 and rain_p < 40:
                action = "**ACTIVATE scheduled drip cycle (Pulse 200–300 mL).**"
                reason = f"Substrate moisture has depleted to **{sm}%**, approaching permanent wilting coefficient. Atmospheric rain probability is low ({rain_p}%). Target replenishment to 55–65% field capacity."
            else:
                action = "**MAINTAIN baseline automated cycle.**"
                reason = f"Substrate moisture is balanced at **{sm}%** within the ideal agronomic comfort zone (40–70%). Forecasted rain probability is moderate ({rain_p}%)."

            return (
                f"### 💧 Precision Irrigation Directive\n\n"
                f"**Directive:** {action}\n\n"
                f"**Agronomic Justification:**\n"
                f"{reason}\n\n"
                f"- **Substrate Saturation:** `{sm}%` (Optimal: 45–65% for containerized crops)\n"
                f"- **Atmospheric Demand (VPD):** `{vpd} kPa`\n"
                f"- **Precipitation Probability (24h):** `{rain_p}%`\n\n"
                f"**Best Practice Tip:** Water exclusively in the early morning hours (06:00–08:00) so foliar splashes evaporate rapidly before midday peak, minimizing spore germination windows."
            )

        # ====================================================================
        # INTENT 3: Weather, Fungal Risk, Spore Incubation
        # ====================================================================
        if any(kw in q for kw in ['weather', 'risk', 'fungal', 'spore', 'blight risk', 'forecast', 'alert', 'pathogen']):
            return (
                f"### 🌦️ Agro-Meteorological Disease Vector Analysis\n\n"
                f"**Macroclimate Vector:** `{w.get('advisory_title', 'Disease Pressure Model')}`\n"
                f"**Current Pathogen Pressure:** `{w.get('overall_risk', 'MODERATE')}`\n\n"
                f"#### Epidemiological Assessment:\n"
                f"Fungal spores (*Alternaria solani*, *Phytophthora infestans*, and *Pseudoperonospora cubensis*) require continuous **foliar wetness > 6–8 hours** and ambient **relative humidity > 75%** within temperature ranges of **18°C–28°C** for active zoospore germination.\n\n"
                f"- **Atmospheric Humidity Forecast:** Multi-day cycles exceeding 70–85% RH.\n"
                f"- **Precipitation Outlook:** Elevated rainfall probability will exacerbate free water retention on lower leaf surfaces.\n\n"
                f"#### Tactical Protocol:\n"
                f"1. **Prophylactic Spraying:** Apply a protective copper octanoate (0.5–1.0 oz/gal) or *Bacillus subtilis* foliar barrier **prior** to precipitation.\n"
                f"2. **Canopy Air Circulation:** Maintain exhaust and horizontal air movement fans (target 0.3–0.5 m/s velocity) to keep the leaf boundary layer dry.\n"
                f"3. **Irrigation Offset:** Suspend overhead and automated cycles to avoid saturation."
            )

        # ====================================================================
        # INTENT 4: Early Blight (Alternaria solani)
        # ====================================================================
        if any(kw in q for kw in ['early blight', 'alternaria', 'target spot', 'concentric']):
            return (
                f"### 🛡️ Clinical Protocol: Early Blight (*Alternaria solani*)\n\n"
                f"**Pathogen Etiology:** Fungal pathogen causing dark brown to black necrotic lesions with characteristic concentric 'target-board' rings surrounded by chlorotic (yellow) halos, typically initiating on senescent lower leaves.\n\n"
                f"#### 1. Organic / Bio-Control Protocol (OMRI-Listed):\n"
                f"- **Copper Octanoate (Soap):** Mix 1.5–2.0 fl oz per gallon of water. Spray thoroughly coating upper and lower leaf surfaces every 7–10 days.\n"
                f"- **Bacillus subtilis (Serenade ASO / Cease):** Biological competitor that colonizes leaf surfaces and inhibits germ tube elongation. Rate: 1.0–2.0 fl oz/gal.\n"
                f"- **Potassium Bicarbonate:** 2–3 tbsp/gal to raise leaf surface pH above spore viability range.\n\n"
                f"#### 2. Synthetic Fungicide Options (Commercial / Conventional):\n"
                f"- **Chlorothalonil (Daconil 2787):** Multi-site contact protectant (FRAC M05). Pre-Harvest Interval (PHI): 0 days for tomatoes.\n"
                f"- **Mancozeb:** Broad-spectrum protectant. Rate: 1.5–2.0 lbs/acre (PHI: 5 days).\n"
                f"- **Azoxystrobin (Heritage / Quadris):** Systemic strobilurin (FRAC 11). Rotate with different FRAC groups to prevent resistance.\n\n"
                f"#### 3. Cultural Sanitary Actions:\n"
                f"- **Pruning:** Remove all lower leaves up to 30 cm (12 inches) above the substrate to disrupt soil-splash spore vectors.\n"
                f"- **Decontamination:** Disinfect pruning shears with 70% isopropyl alcohol between plants.\n"
                f"- **Irrigation:** Never utilize overhead sprinklers; employ targeted drip irrigation."
            )

        # ====================================================================
        # INTENT 5: Late Blight (Phytophthora infestans)
        # ====================================================================
        if any(kw in q for kw in ['late blight', 'phytophthora', 'water soaked']):
            return (
                f"### ⚠️ Emergency Protocol: Late Blight (*Phytophthora infestans*)\n\n"
                f"**Pathogen Severity: CRITICAL.** Oomycete pathogen with explosive infection cycles in cool, wet conditions (15–22°C, RH >90%). Causes dark, water-soaked foliar lesions with white fuzzy sporulation on leaf undersides and rapid vine collapse.\n\n"
                f"#### Immediate Action Plan:\n"
                f"1. **Rogue Heavily Infected Foliage:** Cut and bag severely blighted plant tissue immediately in sealed plastic bags. Do NOT compost.\n"
                f"2. **Therapeutic / Protectant Spray:**\n"
                f"   - **Fixed Copper Hydroxide (Kocide 3000):** 1.5–2.0 lbs/acre.\n"
                f"   - **Mandipropamid (Revus) or Cyazofamid (Ranman):** Translaminar oomycete-specific fungicides.\n"
                f"   - **Phosphorous Acid (Agri-Fos):** Systemic induced resistance elicitor.\n"
                f"3. **Greenhouse Venting:** Heat and vent simultaneously to force canopy VPD above 1.2 kPa and purge free moisture."
            )

        # ====================================================================
        # INTENT 6: Powdery Mildew & Downy Mildew
        # ====================================================================
        if 'powdery mildew' in q:
            return (
                f"### 🍂 Treatment Protocol: Powdery Mildew (*Podosphaera / Erysiphe*)\n\n"
                f"**Symptoms:** White to pale gray talcum-like powdery patches on upper leaf surfaces, causing leaf curling and premature senescence.\n\n"
                f"#### Recommended Remediation:\n"
                f"- **Potassium Bicarbonate (MilStop / Kaligreen):** 2–3 tbsp/gal. Rapidly disrupts fungal cell membranes via osmotic shock.\n"
                f"- **Cold-Pressed Neem Oil (Clarified Hydrophobic Extract):** 2 tbsp/gal emulsified with mild liquid castile soap. Acts as contact fungicide and suffocant.\n"
                f"- **Wettable Sulfur:** 2–4 tbsp/gal. *Note: Do not apply sulfur if ambient temperature exceeds 30°C or within 14 days of an oil spray.*"
            )

        if 'downy mildew' in q:
            return (
                f"### 🌧️ Treatment Protocol: Downy Mildew (*Pseudoperonospora cubensis*)\n\n"
                f"**Symptoms:** Angular, chlorotic yellow patches restricted by leaf veins on the upper surface, with purplish-gray downy sporulation underneath.\n\n"
                f"#### Management Strategy:\n"
                f"- **Fungicide Spray:** Apply Copper Hydroxide or Dimethomorph (Acrobat 50WP).\n"
                f"- **Airflow:** Increase plant spacing and run internal circulation fans 24/7 to reduce relative humidity below 75%.\n"
                f"- **Watering:** Water roots only; avoid wetting the canopy."
            )

        # ====================================================================
        # INTENT 7: Microclimate & Vapor Pressure Deficit (VPD)
        # ====================================================================
        if any(kw in q for kw in ['vpd', 'vapor pressure deficit', 'humidity', 'temperature', 'transpiration']):
            return (
                f"### 📊 Canopy VPD & Transpiration Dynamics\n\n"
                f"- **Current Canopy Temperature:** `{temp}°C`\n"
                f"- **Relative Humidity (RH):** `{rh}%`\n"
                f"- **Calculated VPD:** `{vpd} kPa`\n\n"
                f"#### Agronomic Target Ranges for Solanaceous Crops:\n"
                f"- **Early Vegetative:** `0.6 – 0.9 kPa`\n"
                f"- **Late Vegetative / Flowering:** `0.8 – 1.2 kPa` (Target Zone)\n"
                f"- **Fruiting & Ripening:** `1.0 – 1.4 kPa`\n\n"
                f"#### Current Assessment:\n"
                f"{'⚠️ **VPD is depressed (<0.7 kPa):** Stomatal transpiration is low. Plants cannot move calcium effectively to new growth, risking blossom end rot. Free foliar condensation risk is high.' if vpd and vpd < 0.7 else '✅ **VPD is in the healthy comfort zone:** Stomata are open, facilitating steady nutrient transpiration and photosynthate accumulation.' if vpd and 0.8 <= vpd <= 1.3 else '⚠️ **VPD is high (>1.4 kPa):** Atmospheric vapor deficit is too aggressive, prompting guard cell closure to prevent desiccation.'}\n\n"
                f"**Action:** {'Activate exhaust ventilation and increase air circulation.' if rh > 70 else 'Maintain current microclimate settings.'}"
            )

        # ====================================================================
        # INTENT 8: Plant Nutrition / Deficiencies (N, P, K, Ca, Blossom End Rot)
        # ====================================================================
        if any(kw in q for kw in ['nutrient', 'fertilizer', 'deficiency', 'yellow leaves', 'blossom end rot', 'calcium']):
            if 'blossom end rot' in q or 'calcium' in q:
                return (
                    f"### 🍅 Blossom End Rot (Calcium Deficiency Management)\n\n"
                    f"**Nature:** A physiological disorder—not caused by bacteria or fungi! Manifests as a flat, leathery, dark brown/black sunken lesion at the blossom end of fruits.\n\n"
                    f"#### Root Cause:\n"
                    f"Calcium is a non-mobile nutrient transported exclusively via xylem water flow driven by transpiration. Irregular substrate moisture cycles or fluctuating VPD cut off calcium delivery to developing fruit tissues.\n\n"
                    f"#### Corrective Protocol:\n"
                    f"1. **Stabilize Substrate Moisture:** Maintain soil moisture between 50–65% without sharp drying-and-drenching fluctuations.\n"
                    f"2. **Foliar Calcium Spray:** Apply Calcium Chloride or Calcium Chelate (2–3 tbsp/gal) directly to developing flower clusters.\n"
                    f"3. **Avoid Excess Ammonium Nitrogen:** High NH4+ ions compete with Ca2+ uptake at the root rhizosphere."
                )
            else:
                return (
                    f"### 🧪 Plant Nutrition & Deficiency Diagnostics\n\n"
                    f"- **Nitrogen (N) Deficiency:** General chlorosis (uniform pale yellowing) beginning on oldest lower leaves; spindly stems.\n"
                    f"- **Phosphorus (P) Deficiency:** Dark green foliage with purple or reddish bronze pigmentation on leaf undersides and petioles.\n"
                    f"- **Potassium (K) Deficiency:** Marginal chlorosis followed by necrosis (scorched brown leaf edges) on mature leaves.\n"
                    f"- **Magnesium (Mg) Deficiency:** Interveinal chlorosis (veins stay green while leaf tissue yellows) on lower leaves.\n"
                    f"- **Iron (Fe) Deficiency:** Interveinal chlorosis on the **youngest terminal leaves** (common when pH > 7.0).\n\n"
                    f"**Optimum Root Substrate pH:** Maintain substrate runoff pH between **5.8 and 6.5** for maximum nutrient bioavailability."
                )

        # ====================================================================
        # INTENT 9: Current Diagnosis Specific Inquiry
        # ====================================================================
        if any(kw in q for kw in ['diagnos', 'disease', 'what disease', 'leaf problem', 'infection']):
            return (
                f"### 🔬 Specimen Diagnostic Evaluation\n\n"
                f"- **Identified Specimen:** `{plant_name}`\n"
                f"- **Active Pathology Diagnosis:** **{diag_name}**\n"
                f"- **Detection Confidence:** `{diag_conf}%`\n"
                f"- **Microclimate Risk Context:** `{w.get('overall_risk', 'MODERATE')}` Macroclimate Pathogen Risk\n\n"
                f"#### Immediate Clinical Action Plan:\n"
                f"1. **Sanitation:** Inspect lower canopy for visible spots or lesions. Sever infected leaves with sterilized shears.\n"
                f"2. **Chemical / Bio Control:** Apply prophylactic copper soap or *Bacillus subtilis* to protect adjacent healthy foliage.\n"
                f"3. **Environmental Tuning:** Maintain VPD at 0.9–1.2 kPa by ensuring active greenhouse air exchange."
            )

        # ====================================================================
        # DEFAULT: Comprehensive Agronomic Guidance
        # ====================================================================
        return (
            f"### 🌿 SYNTERRA Botanical & Agronomic Intelligence\n\n"
            f"Regarding your query on **{query.strip()}**:\n\n"
            f"Your specimen `{plant_name}` is currently operating at **{temp}°C**, **{rh}% relative humidity**, with **{sm}% substrate moisture** and a calculated **VPD of {vpd} kPa**.\n\n"
            f"**Recommended Agronomic Guidelines:**\n"
            f"- **Canopy Protection:** Maintain clean foliage with zero overhead splashing to minimize spore motility.\n"
            f"- **Irrigation Management:** {w.get('irrigation_directive', 'Keep drip cycles calibrated to moisture sensor feedback.')}\n"
            f"- **Disease Prevention:** Apply prophylactic bio-fungicides (e.g. Copper Octanoate or *Bacillus subtilis*) when forecasted rainfall or high humidity (>75%) persists.\n"
            f"- **Nutrition:** Maintain root rhizosphere pH between 5.8 and 6.5 for optimal macronutrient bioavailability.\n\n"
            f"Feel free to ask for specific treatment protocols (e.g., *Early Blight*, *Powdery Mildew*), irrigation recommendations, or microclimate VPD tuning!"
        )


chatbot_service = ChatbotService()
