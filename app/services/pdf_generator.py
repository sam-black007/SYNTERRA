"""
SYNTERRA — Agronomic Treatment Advisory & PDF Dossier Generator
Generates publication-quality pathology reports using ReportLab.
"""

import io
from datetime import datetime, timezone
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

# Agronomic Disease Treatment Knowledge Base
TREATMENT_ADVISORY = {
    'early blight': {
        'pathogen': 'Alternaria solani (Fungal Ascomycota)',
        'symptoms': 'Concentric target-board brown spots surrounded by chlorotic yellow halos.',
        'organic_treatment': 'Apply copper octanoate (copper soap) or Bacillus subtilis biopesticide at first lesion appearance. Spray every 7-10 days.',
        'chemical_treatment': 'Foliar application of Chlorothalonil (Daconil), Mancozeb, or Azoxystrobin (Quadris). Rotate FRAC groups 11 and M05.',
        'cultural_practices': 'Prune lower leaves touching soil. Avoid overhead irrigation to minimize leaf wetness duration. Mulch soil around stem base.',
    },
    'late blight': {
        'pathogen': 'Phytophthora infestans (Oomycete water mold)',
        'symptoms': 'Water-soaked irregular black/dark-brown blotches with white mildew-like sporulation on leaf undersides in high humidity.',
        'organic_treatment': 'Preventive fixed copper hydroxide applications. Remove and destroy entire severely infected plants immediately (do not compost).',
        'chemical_treatment': 'Systemic fungicides: Cymoxanil (Curzate), Dimethomorph (Acrobat), or Mandipropamid (Revus) combined with protectant chlorothalonil.',
        'cultural_practices': 'Strictly avoid free water on foliage. Maintain plant spacing for maximum airflow. Destroy volunteer tomato/potato hosts.',
    },
    'powdery mildew': {
        'pathogen': 'Podosphaera xanthii / Erysiphe spp. (Obligate biotrophic fungi)',
        'symptoms': 'White powdery fungal talcum-like patches across upper and lower leaf surfaces causing leaf curl and senescence.',
        'organic_treatment': 'Potassium bicarbonate (MilStop) foliar spray, diluted neem oil (0.5%), or sulfur dust (do not apply sulfur above 30C / 85F).',
        'chemical_treatment': 'Myclobutanil (Rally), Trifloxystrobin (Flint), or Tebuconazole. Alternate FRAC code 3 and 11 to mitigate resistance.',
        'cultural_practices': 'Prune dense canopies to lower relative humidity. Ensure sunlight exposure. Avoid excessive nitrogen fertilization.',
    },
    'septoria leaf spot': {
        'pathogen': 'Septoria lycopersici (Fungi)',
        'symptoms': 'Small circular spots with dark brown margins and sunken grayish centers containing tiny black pycnidia specks.',
        'organic_treatment': 'Liquid copper sulfate fungicide or serenade biofungicide (Bacillus subtilis strain QST 713).',
        'chemical_treatment': 'Chlorothalonil, Pyraclostrobin, or Boscalid (Endura).',
        'cultural_practices': 'Practice 2-year crop rotation without solanaceous crops. Stake and cage plants for vertical clearance.',
    },
    'healthy': {
        'pathogen': 'No biotic or abiotic pathogen detected.',
        'symptoms': 'Vigorous leaf turgor, uniform chlorophyll distribution, intact leaf margins.',
        'organic_treatment': 'Continue standard organic maintenance, compost tea drenches, and microbial root inoculants.',
        'chemical_treatment': 'No curative intervention required.',
        'cultural_practices': 'Maintain optimal canopy Vapor Pressure Deficit (0.8–1.2 kPa) and balanced N-P-K nutrient delivery.',
    }
}


def get_advisory_for_disease(disease_name: str):
    """Retrieve expert agronomic advisory based on diagnosed condition."""
    if not disease_name:
        return TREATMENT_ADVISORY['healthy']

    name_lower = disease_name.lower()
    for key, advisory in TREATMENT_ADVISORY.items():
        if key in name_lower:
            return advisory

    # General fungal / microbial default protocol
    return {
        'pathogen': f'Pathology classification: {disease_name}',
        'symptoms': 'Visual chlorosis, necrotic spotting, or foliar lesioning.',
        'organic_treatment': 'Broad-spectrum liquid copper fungicide or cold-pressed neem oil (1% emulsion) every 7 days.',
        'chemical_treatment': 'Broad-spectrum protectant fungicide containing Chlorothalonil or Mancozeb.',
        'cultural_practices': 'Sterilize pruning tools with 70% isopropyl alcohol between plants. Transition to drip irrigation.',
    }


def generate_diagnosis_pdf(diagnosis, nearest_telemetry=None) -> bytes:
    """Generate a clean, high-resolution agronomic pathology PDF report."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        rightMargin=36,
        leftMargin=36,
        topMargin=36,
        bottomMargin=36
    )

    styles = getSampleStyleSheet()

    # Custom palette
    primary_green = colors.HexColor('#166534')
    dark_slate = colors.HexColor('#0f172a')
    text_muted = colors.HexColor('#475569')
    accent_teal = colors.HexColor('#0d9488')
    alert_red = colors.HexColor('#b91c1c')

    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=20,
        leading=24,
        textColor=primary_green,
        spaceAfter=4
    )

    subtitle_style = ParagraphStyle(
        'DocSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=12,
        textColor=text_muted,
        spaceAfter=15
    )

    section_heading = ParagraphStyle(
        'SectionHeading',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=12,
        leading=16,
        textColor=dark_slate,
        spaceBefore=12,
        spaceAfter=6
    )

    body_style = ParagraphStyle(
        'BodyDark',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=13,
        textColor=dark_slate
    )

    body_bold = ParagraphStyle(
        'BodyBold',
        parent=body_style,
        fontName='Helvetica-Bold'
    )

    story = []

    # 1. Header Banner
    story.append(Paragraph("SYNTERRA &mdash; AGRICULTURAL INTELLIGENCE", title_style))
    story.append(Paragraph("Autonomous Plant Pathology Diagnostic Dossier // Kindwise crop.health AI v1", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=1.5, color=primary_green, spaceAfter=15))

    # 2. Specimen & Condition Summary Table
    conf_str = f"{diagnosis.confidence:.1f}%" if diagnosis.confidence else "N/A"
    date_str = diagnosis.created_at.strftime("%Y-%m-%d %H:%M:%S UTC") if diagnosis.created_at else "N/A"
    disease_display = diagnosis.disease_name or "Healthy / No Disease Detected"

    summary_data = [
        [
            Paragraph("<b>Specimen ID:</b>", body_style),
            Paragraph(f"SYN-DIAG-{diagnosis.id:04d}", body_bold),
            Paragraph("<b>Analysis Date:</b>", body_style),
            Paragraph(date_str, body_style),
        ],
        [
            Paragraph("<b>Target Crop:</b>", body_style),
            Paragraph(diagnosis.plant_name.capitalize(), body_bold),
            Paragraph("<b>Diagnosed Condition:</b>", body_style),
            Paragraph(f"<font color='{alert_red.hexval()}'><b>{disease_display.capitalize()}</b></font>", body_style),
        ],
        [
            Paragraph("<b>Diagnostic Model:</b>", body_style),
            Paragraph("Kindwise crop.health v1.2.1", body_style),
            Paragraph("<b>Confidence Metric:</b>", body_style),
            Paragraph(f"<b>{conf_str}</b>", body_bold),
        ]
    ]

    summary_table = Table(summary_data, colWidths=[100, 160, 110, 170])
    summary_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#f8fafc')),
        ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor('#cbd5e1')),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e2e8f0')),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(summary_table)
    story.append(Spacer(1, 12))

    # 3. Environmental Microclimate At Diagnosis (if telemetry available)
    if nearest_telemetry:
        story.append(Paragraph("Microclimate Canopy Telemetry at Diagnosis", section_heading))
        temp = f"{nearest_telemetry.get('temperature_c', '--')} &deg;C"
        hum = f"{nearest_telemetry.get('humidity_pct', '--')} %"
        soil = f"{nearest_telemetry.get('soil_moisture_pct', '--')} %"
        lux = f"{nearest_telemetry.get('light_lux', '--')} Lux"

        telem_data = [
            [
                Paragraph("<b>Canopy Temperature</b>", body_style),
                Paragraph("<b>Relative Humidity</b>", body_style),
                Paragraph("<b>Substrate Moisture</b>", body_style),
                Paragraph("<b>Photometric Flux</b>", body_style)
            ],
            [
                Paragraph(temp, body_bold),
                Paragraph(hum, body_bold),
                Paragraph(soil, body_bold),
                Paragraph(lux, body_bold)
            ]
        ]
        telem_table = Table(telem_data, colWidths=[135, 135, 135, 135])
        telem_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f1f5f9')),
            ('BACKGROUND', (0, 1), (-1, 1), colors.HexColor('#ffffff')),
            ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor('#cbd5e1')),
            ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e2e8f0')),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ]))
        story.append(telem_table)
        story.append(Spacer(1, 12))

    # 4. Expert Agronomic Treatment Protocol
    advisory = get_advisory_for_disease(diagnosis.disease_name)
    story.append(Paragraph("Agronomic Treatment & Intervention Protocol", section_heading))

    advisory_data = [
        [Paragraph("<b>Etiology & Causal Pathogen:</b>", body_style), Paragraph(advisory['pathogen'], body_style)],
        [Paragraph("<b>Diagnostic Symptoms:</b>", body_style), Paragraph(advisory['symptoms'], body_style)],
        [Paragraph("<b>Biological / Organic Control:</b>", body_style), Paragraph(advisory['organic_treatment'], body_style)],
        [Paragraph("<b>Chemical Fungicide Protocol:</b>", body_style), Paragraph(advisory['chemical_treatment'], body_style)],
        [Paragraph("<b>Cultural & Sanitation Hygiene:</b>", body_style), Paragraph(advisory['cultural_practices'], body_style)],
    ]

    advisory_table = Table(advisory_data, colWidths=[150, 390])
    advisory_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#f8fafc')),
        ('BACKGROUND', (1, 0), (1, -1), colors.HexColor('#ffffff')),
        ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor('#cbd5e1')),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e2e8f0')),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    story.append(advisory_table)
    story.append(Spacer(1, 20))

    # 5. Lab Certification Footer
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor('#94a3b8'), spaceAfter=8))
    cert_text = (
        "<i>This automated pathology dossier was generated by the SYNTERRA Agricultural Intelligence Engine. "
        "Diagnoses are computed using Kindwise crop.health computer vision models. "
        "Adhere to local pesticide regulations and label directions prior to chemical applications.</i>"
    )
    story.append(Paragraph(cert_text, ParagraphStyle('Cert', parent=body_style, fontSize=7, leading=9, textColor=text_muted)))

    doc.build(story)
    return buf.getvalue()
