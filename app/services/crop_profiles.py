"""
SYNTERRA — Multi-Crop Botanical Profiles & Active Crop State
"""

CROP_PROFILES = {
    'tomato': {
        'key': 'tomato',
        'name': 'Cherry / Beefsteak Tomato',
        'scientific_name': 'Solanum lycopersicum',
        'category': 'Fruiting Solanaceae',
        'target_temp_c': [20.0, 26.0],
        'target_humidity_pct': [55.0, 70.0],
        'target_soil_pct': [50.0, 70.0],
        'watering_threshold_pct': 45.0,
        'target_dli_mol': 16.0,
        'photoperiod_hours': 14.0,
        'optimal_vpd_kpa': [0.8, 1.2],
        'icon': '🍅',
        'notes': 'High light demand; requires balanced calcium to avoid blossom end rot.',
    },
    'basil': {
        'key': 'basil',
        'name': 'Genovese Sweet Basil',
        'scientific_name': 'Ocimum basilicum',
        'category': 'Culinary Herb',
        'target_temp_c': [20.0, 25.0],
        'target_humidity_pct': [50.0, 65.0],
        'target_soil_pct': [60.0, 80.0],
        'watering_threshold_pct': 55.0,
        'target_dli_mol': 12.0,
        'photoperiod_hours': 12.0,
        'optimal_vpd_kpa': [0.7, 1.1],
        'icon': '🌿',
        'notes': 'Prefers consistent rhizosphere moisture and warm ambient air.',
    },
    'strawberry': {
        'key': 'strawberry',
        'name': 'Eversweet Strawberry',
        'scientific_name': 'Fragaria × ananassa',
        'category': 'Berry Crop',
        'target_temp_c': [18.0, 24.0],
        'target_humidity_pct': [60.0, 75.0],
        'target_soil_pct': [55.0, 70.0],
        'watering_threshold_pct': 50.0,
        'target_dli_mol': 14.0,
        'photoperiod_hours': 12.0,
        'optimal_vpd_kpa': [0.6, 1.0],
        'icon': '🍓',
        'notes': 'Requires high crown aeration and balanced solar radiation.',
    },
    'lettuce': {
        'key': 'lettuce',
        'name': 'Butterhead Lettuce',
        'scientific_name': 'Lactuca sativa',
        'category': 'Leafy Green',
        'target_temp_c': [15.0, 21.0],
        'target_humidity_pct': [50.0, 70.0],
        'target_soil_pct': [65.0, 85.0],
        'watering_threshold_pct': 60.0,
        'target_dli_mol': 10.0,
        'photoperiod_hours': 12.0,
        'optimal_vpd_kpa': [0.5, 0.9],
        'icon': '🥬',
        'notes': 'Cool-season crop; elevated heat causes bolting and tip burn.',
    },
    'succulent': {
        'key': 'succulent',
        'name': 'Desert Aloe / Echeveria',
        'scientific_name': 'Aloe barbadensis',
        'category': 'Xerophytic Succulent',
        'target_temp_c': [21.0, 32.0],
        'target_humidity_pct': [30.0, 50.0],
        'target_soil_pct': [15.0, 35.0],
        'watering_threshold_pct': 18.0,
        'target_dli_mol': 18.0,
        'photoperiod_hours': 10.0,
        'optimal_vpd_kpa': [1.2, 1.6],
        'icon': '🌵',
        'notes': 'Requires deep soak-and-dry irrigation cycles and low humidity.',
    },
    'monstera': {
        'key': 'monstera',
        'name': 'Swiss Cheese Plant',
        'scientific_name': 'Monstera deliciosa',
        'category': 'Tropical Aroid',
        'target_temp_c': [20.0, 28.0],
        'target_humidity_pct': [60.0, 80.0],
        'target_soil_pct': [40.0, 60.0],
        'watering_threshold_pct': 35.0,
        'target_dli_mol': 8.0,
        'photoperiod_hours': 10.0,
        'optimal_vpd_kpa': [0.6, 1.0],
        'icon': '🪴',
        'notes': 'Thrives in warm, humid microclimates with indirect light.',
    }
}

ACTIVE_CROP_KEY = 'tomato'

def get_active_crop_key():
    global ACTIVE_CROP_KEY
    return ACTIVE_CROP_KEY

def set_active_crop_key(key):
    global ACTIVE_CROP_KEY
    if key in CROP_PROFILES:
        ACTIVE_CROP_KEY = key
        return True
    return False

def get_active_crop_profile():
    return CROP_PROFILES.get(get_active_crop_key(), CROP_PROFILES['tomato'])
