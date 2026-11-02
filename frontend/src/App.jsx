import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import {
  Activity,
  Thermometer,
  Droplets,
  Sun,
  Sprout,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Send,
  ExternalLink,
  Cpu,
  CheckCircle2,
  Clock,
  Sparkles,
  Radio,
  Camera,
  Play,
  Square,
  Sliders,
  Download,
  UploadCloud,
  FileText,
  Flame,
  Zap,
  Gauge,
  Wifi,
  Search,
  CloudRain,
  CloudSun,
  CloudLightning,
  MapPin,
  Wind,
  ShieldAlert,
  Bot,
  Globe,
  Layers,
  Atom,
  Bell,
  Terminal,
  Bug
} from 'lucide-react';
import ChatbotWidget from './components/ChatbotWidget';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  AreaChart,
  Area
} from 'recharts';

// Agronomic VPD Calculation in kPa
function calculateVPD(tempC, humidityPct) {
  if (tempC === null || tempC === undefined || humidityPct === null || humidityPct === undefined) {
    return null;
  }
  const vpSat = 0.61078 * Math.exp((17.27 * tempC) / (tempC + 237.3));
  const vpd = vpSat * (1 - humidityPct / 100);
  return Math.max(0, +vpd.toFixed(2));
}

function getVPDStatus(vpd) {
  if (vpd === null) return { label: 'Awaiting Data', color: 'text-slate-400', bg: 'bg-slate-800' };
  if (vpd < 0.4) return { label: 'High Moisture / Fungal Risk', color: 'text-amber-400', bg: 'bg-amber-950/40' };
  if (vpd >= 0.4 && vpd <= 0.8) return { label: 'Vegetative Optimal', color: 'text-emerald-400', bg: 'bg-emerald-950/40' };
  if (vpd > 0.8 && vpd <= 1.2) return { label: 'Peak Transpiration (Ideal)', color: 'text-emerald-400', bg: 'bg-emerald-950/40' };
  if (vpd > 1.2 && vpd <= 1.6) return { label: 'Elevated Transpiration', color: 'text-amber-400', bg: 'bg-amber-950/40' };
  return { label: 'Stomata Stress / Dry Air', color: 'text-rose-400', bg: 'bg-rose-950/40' };
}

// Environmental Climate & Sensor Classification Helpers
function getLightCondition(lux) {
  if (lux === undefined || lux === null) return { label: 'BH1750 Offline', bg: 'bg-slate-800 text-slate-400 border-slate-700' };
  if (lux < 25) return { label: '🌙 Night / Dark', bg: 'bg-indigo-950/60 text-indigo-300 border-indigo-700/40' };
  if (lux < 200) return { label: '🌆 Dim / Twilight', bg: 'bg-purple-950/60 text-purple-300 border-purple-700/40' };
  if (lux < 1000) return { label: '☁️ Cloudy / Overcast', bg: 'bg-slate-800/80 text-slate-300 border-slate-600/40' };
  if (lux < 10000) return { label: '⛅ Daylight / Partly Cloudy', bg: 'bg-sky-950/60 text-sky-300 border-sky-700/40' };
  if (lux < 25000) return { label: '☀️ Sunny / Clear Sky', bg: 'bg-amber-950/60 text-amber-300 border-amber-700/40' };
  return { label: '🔥 Intense Sunlight', bg: 'bg-orange-950/60 text-orange-300 border-orange-700/40' };
}

function getSoilCondition(moisture) {
  if (moisture === undefined || moisture === null) return { label: 'Soil Sensor Offline', bg: 'bg-slate-800 text-slate-400 border-slate-700' };
  if (moisture < 20) return { label: '🏜️ Severe Drought', bg: 'bg-red-950/60 text-red-400 border-red-700/40' };
  if (moisture < 40) return { label: '⚠️ Dry (Needs Water)', bg: 'bg-amber-950/60 text-amber-300 border-amber-700/40' };
  if (moisture <= 75) return { label: '🌱 Optimal Moisture', bg: 'bg-emerald-950/60 text-emerald-300 border-emerald-700/40' };
  if (moisture <= 90) return { label: '💧 Wet / Saturated', bg: 'bg-cyan-950/60 text-cyan-300 border-cyan-700/40' };
  return { label: '🌊 Waterlogged', bg: 'bg-blue-950/60 text-blue-300 border-blue-700/40' };
}

function getTempCondition(temp) {
  if (temp === undefined || temp === null) return { label: 'DHT11 Offline', bg: 'bg-slate-800 text-slate-400 border-slate-700' };
  if (temp < 16) return { label: '❄️ Cold / Chilly', bg: 'bg-blue-950/60 text-blue-300 border-blue-700/40' };
  if (temp < 22) return { label: '🍃 Mild / Cool', bg: 'bg-teal-950/60 text-teal-300 border-teal-700/40' };
  if (temp <= 28) return { label: '✨ Optimal Temp', bg: 'bg-emerald-950/60 text-emerald-300 border-emerald-700/40' };
  if (temp <= 34) return { label: '🌡️ Warm / Elevated', bg: 'bg-amber-950/60 text-amber-300 border-amber-700/40' };
  return { label: '🔥 Extreme Heat', bg: 'bg-rose-950/60 text-rose-300 border-rose-700/40' };
}

function getHumidityCondition(hum) {
  if (hum === undefined || hum === null) return { label: 'DHT11 Offline', bg: 'bg-slate-800 text-slate-400 border-slate-700' };
  if (hum < 35) return { label: '🌵 Arid / Dry Air', bg: 'bg-amber-950/60 text-amber-300 border-amber-700/40' };
  if (hum <= 65) return { label: '🌿 Ideal Humidity', bg: 'bg-cyan-950/60 text-cyan-300 border-cyan-700/40' };
  if (hum <= 80) return { label: '🌫️ Humid / Tropical', bg: 'bg-indigo-950/60 text-indigo-300 border-indigo-700/40' };
  return { label: '🌧️ Saturated Air', bg: 'bg-purple-950/60 text-purple-300 border-purple-700/40' };
}

function getMicroclimateState(telemetry) {
  if (!telemetry) return { title: 'Awaiting Hardware Telemetry...', desc: 'Connect ESP32 or serial bridge', badge: 'Standby' };
  const lux = telemetry.light_lux ?? 0;
  const temp = telemetry.temperature_c ?? 24;
  const hum = telemetry.humidity_pct ?? 50;

  if (lux < 25) {
    return { title: 'Nighttime / Dark Rest Phase', desc: 'Canopy transpiration paused; dark respiration active.', badge: '🌙 Night' };
  }
  if (lux >= 10000) {
    if (temp >= 28) {
      return { title: 'Intense Sunlight & Heat', desc: 'Active photosynthesis; monitor soil moisture closely for rapid evapotranspiration.', badge: '☀️ Sunny & Hot' };
    }
    return { title: 'Bright & Sunny Clear Sky', desc: 'Peak photochemical efficiency; optimal solar radiation for vegetative growth.', badge: '🌤️ Bright & Sunny' };
  }
  if (lux >= 1000) {
    if (hum >= 75) {
      return { title: 'Partly Cloudy & Humid', desc: 'Diffused sunlight with high ambient humidity; low transpiration stress.', badge: '⛅ Partly Cloudy & Humid' };
    }
    return { title: 'Partly Cloudy Daylight', desc: 'Balanced daylight illumination across canopy.', badge: '⛅ Daylight' };
  }
  if (lux >= 200) {
    if (hum >= 70) {
      return { title: 'Overcast & Rainy Climate', desc: 'High cloud cover with saturated air; reduced water uptake needed.', badge: '🌧️ Overcast & Rainy' };
    }
    return { title: 'Cloudy / Overcast Sky', desc: 'Soft diffused illumination under dense cloud cover.', badge: '☁️ Cloudy' };
  }
  return { title: 'Dim Indoors / Low Light', desc: 'Low ambient illumination; consider supplemental LED grow lights.', badge: '💡 Dim / Twilight' };
}

export default function App() {
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'studio' | 'irrigation' | 'dossiers'
  const [chartSubTab, setChartSubTab] = useState('climate'); // 'climate' | 'root'
  const [socketConnected, setSocketConnected] = useState(false);
  const [latestTelemetry, setLatestTelemetry] = useState(null);
  const [telemetryHistory, setTelemetryHistory] = useState([]);
  const [diagnoses, setDiagnoses] = useState([]);
  const [apiStatus, setApiStatus] = useState({ configured: false, remainingCredits: null });
  const [irrigationStatus, setIrrigationStatus] = useState({
    state: 'IDLE',
    is_pumping: false,
    remaining_pump_sec: 0,
    remaining_cooldown_sec: 0,
    auto_mode_enabled: false,
    soil_threshold_pct: 35.0,
    reservoir_ok: true
  });

  const [cropProfiles, setCropProfiles] = useState([]);
  const [activeCrop, setActiveCrop] = useState(null);
  const [dliData, setDliData] = useState({
    accumulated_dli: 0.0,
    target_dli: 16.0,
    progress_pct: 0.0,
    photoperiod_hours: 0.0,
    photoperiod_target_hours: 14.0,
    current_ppfd: 0.0
  });

  const [lastPacketTime, setLastPacketTime] = useState(null);
  const [isInjecting, setIsInjecting] = useState(false);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [uploadedImagePreview, setUploadedImagePreview] = useState(null);
  const [plantNameInput, setPlantNameInput] = useState('');
  const [latestDiagnosisResult, setLatestDiagnosisResult] = useState(null);
  const [cameraStatus, setCameraStatus] = useState({
    camera_url: 'http://synterra-cam.local',
    hardware_online: false,
    mode: 'SYNTHETIC HUD',
    host_network: {}
  });
  const [customCamUrl, setCustomCamUrl] = useState('');
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryMsg, setDiscoveryMsg] = useState('');
  const [weatherData, setWeatherData] = useState(null);
  const [isRefreshingWeather, setIsRefreshingWeather] = useState(false);
  const [accuracyData, setAccuracyData] = useState(null);
  const [isComparingAccuracy, setIsComparingAccuracy] = useState(false);
  const [soilGeospatial, setSoilGeospatial] = useState(null);
  const [gbifTaxonomy, setGbifTaxonomy] = useState(null);
  const [solarWeather, setSolarWeather] = useState(null);
  const [pathologyEngine, setPathologyEngine] = useState('gemini'); // 'gemini' | 'kindwise'
  const [fleetZones, setFleetZones] = useState([]);
  const [activeZoneId, setActiveZoneId] = useState('zone-1');
  const [agronomyData, setAgronomyData] = useState(null);
  const [telegramStatus, setTelegramStatus] = useState(null);
  const [telegramSimOutput, setTelegramSimOutput] = useState('');
  const [telegramCmdInput, setTelegramCmdInput] = useState('/status');
  const [isSendingTg, setIsSendingTg] = useState(false);
  const fileInputRef = useRef(null);

  // Initialize Socket.io and data polling
  useEffect(() => {
    const socket = io(window.location.origin, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 20,
    });

    socket.on('connect', () => {
      setSocketConnected(true);
      socket.emit('request_latest');
    });

    socket.on('disconnect', () => {
      setSocketConnected(false);
    });

    socket.on('telemetry_update', (data) => {
      if (!data) return;
      setLatestTelemetry(data);
      setLastPacketTime(new Date());

      setTelemetryHistory((prev) => {
        const timeLabel = new Date(data.timestamp || Date.now()).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        const point = {
          time: timeLabel,
          temp: data.temperature_c,
          hum: data.humidity_pct,
          soil: data.soil_moisture_pct,
          lux: data.light_lux,
        };
        return [...prev, point].slice(-35);
      });
    });

    socket.on('diagnosis_update', (newDiag) => {
      setDiagnoses((prev) => [newDiag, ...prev.filter((d) => d.id !== newDiag.id)].slice(0, 20));
      setLatestDiagnosisResult(newDiag);
    });

    socket.on('irrigation_update', (status) => {
      if (status) setIrrigationStatus(status);
    });

    socket.on('camera_status', (data) => {
      if (data) {
        setCameraStatus((prev) => ({
          ...prev,
          camera_url: data.url || prev.camera_url,
          hardware_online: !!data.connected,
          mode: data.connected ? 'ESP32-S3 LIVE' : 'SYNTHETIC HUD',
        }));
      }
    });

    socket.on('crop_profile_update', (data) => {
      if (data && data.active_crop) {
        setActiveCrop(data.active_crop);
      }
    });

    fetchInitialData();

    // Fallback heartbeat polling every 5s in case of connection drop
    const heartbeat = setInterval(() => {
      fetch('/api/sensors/latest')
        .then((r) => r.json())
        .then((data) => {
          if (data.reading) {
            setLatestTelemetry(data.reading);
            setLastPacketTime(new Date(data.reading.timestamp));
          }
        })
        .catch(() => {});

      fetch('/api/irrigation/status')
        .then((r) => r.json())
        .then((data) => {
          if (data.irrigation) setIrrigationStatus(data.irrigation);
        })
        .catch(() => {});

      fetch('/api/sensors/dli')
        .then((r) => r.json())
        .then((data) => {
          if (data.success) setDliData(data);
        })
        .catch(() => {});
    }, 5000);

    return () => {
      clearInterval(heartbeat);
      socket.disconnect();
    };
  }, []);

  async function fetchInitialData() {
    try {
      const [telemRes, histRes, diagRes, integRes, irrigRes, cropsRes, dliRes] = await Promise.all([
        fetch('/api/sensors/latest'),
        fetch('/api/sensors/history?limit=30'),
        fetch('/api/diagnoses'),
        fetch('/api/integrations/plantid/test', { method: 'POST' }),
        fetch('/api/irrigation/status'),
        fetch('/api/crops/profiles'),
        fetch('/api/sensors/dli')
      ]);

      if (cropsRes.ok) {
        const cData = await cropsRes.json();
        if (cData.profiles) setCropProfiles(cData.profiles);
        const active = cData.profiles?.find((p) => p.key === cData.active_crop_key);
        if (active) {
          setActiveCrop(active);
          fetch(`/api/biodiversity/species?name=${encodeURIComponent(active.scientific_name)}`)
            .then((r) => r.json())
            .then((bio) => {
              if (bio.success) setGbifTaxonomy(bio);
            })
            .catch(() => {});
        }
      }

      if (dliRes.ok) {
        const dData = await dliRes.json();
        if (dData.success) setDliData(dData);
      }

      if (telemRes.ok) {
        const t = await telemRes.json();
        if (t.reading) {
          setLatestTelemetry(t.reading);
          setLastPacketTime(new Date(t.reading.timestamp));
        }
      }

      if (histRes.ok) {
        const h = await histRes.json();
        if (h.readings) {
          setTelemetryHistory(
            h.readings.reverse().map((r) => ({
              time: new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
              temp: r.temperature_c,
              hum: r.humidity_pct,
              soil: r.soil_moisture_pct,
              lux: r.light_lux,
            }))
          );
        }
      }

      if (diagRes.ok) {
        const d = await diagRes.json();
        setDiagnoses(d);
        if (d.length > 0) setLatestDiagnosisResult(d[0]);
      }

      if (integRes.ok) {
        const s = await integRes.json();
        setApiStatus({ configured: true, remainingCredits: s.usage?.remaining?.total });
      }

      if (irrigRes.ok) {
        const ir = await irrigRes.json();
        if (ir.irrigation) setIrrigationStatus(ir.irrigation);
      }

      fetch('/api/camera/status')
        .then((r) => r.json())
        .then((cam) => {
          if (cam) setCameraStatus(cam);
        })
        .catch(() => {});

      fetch('/api/weather/forecast')
        .then((r) => r.json())
        .then((w) => {
          if (w.success) setWeatherData(w);
        })
        .catch(() => {});

      fetch('/api/weather/compare')
        .then((r) => r.json())
        .then((comp) => {
          if (comp.success) setAccuracyData(comp);
        })
        .catch(() => {});

      fetch('/api/soil/geospatial')
        .then((r) => r.json())
        .then((s) => {
          if (s.success) setSoilGeospatial(s);
        })
        .catch(() => {});

      fetch('/api/weather/solar')
        .then((r) => r.json())
        .then((sol) => {
          if (sol.success) setSolarWeather(sol);
        })
        .catch(() => {});

      fetch('/api/agronomy/analytics')
        .then((r) => r.json())
        .then((ag) => {
          if (ag.success) setAgronomyData(ag);
        })
        .catch(() => {});

      fetch('/api/fleet/zones')
        .then((r) => r.json())
        .then((fz) => {
          if (fz.success && fz.zones) {
            setFleetZones(fz.zones);
            setActiveZoneId(fz.active_zone_id || 'zone-1');
          }
        })
        .catch(() => {});

      fetch('/api/telegram/status')
        .then((r) => r.json())
        .then((tg) => {
          if (tg.success) setTelegramStatus(tg);
        })
        .catch(() => {});
    } catch (err) {
      console.warn('Initial data load warning:', err);
    }
  }

  // Cross-Validate Hardware Accuracy with Weather Ground-Truth
  const handleRefreshAccuracy = async () => {
    setIsComparingAccuracy(true);
    try {
      const res = await fetch('/api/weather/compare');
      const data = await res.json();
      if (data.success) {
        setAccuracyData(data);
      }
    } catch (err) {
      console.error('Accuracy compare failed:', err);
    } finally {
      setIsComparingAccuracy(false);
    }
  };

  // Switch Botanical Species Profile
  const handleSelectCrop = async (cropKey) => {
    try {
      const res = await fetch('/api/crops/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crop_key: cropKey })
      });
      const data = await res.json();
      if (data.success && data.active_crop) {
        setActiveCrop(data.active_crop);
        fetch(`/api/biodiversity/species?name=${encodeURIComponent(data.active_crop.scientific_name)}`)
          .then((r) => r.json())
          .then((bio) => {
            if (bio.success) setGbifTaxonomy(bio);
          })
          .catch(() => {});
        const dRes = await fetch('/api/sensors/dli');
        if (dRes.ok) {
          const dData = await dRes.json();
          setDliData(dData);
        }
        fetch(`/api/agronomy/analytics?crop_key=${cropKey}`)
          .then((r) => r.json())
          .then((ag) => { if (ag.success) setAgronomyData(ag); })
          .catch(() => {});
      }
    } catch (err) {
      console.error('Failed to update active crop profile:', err);
    }
  };

  // Switch Multi-Zone Greenhouse Bay
  const handleSwitchZone = async (zoneId) => {
    setActiveZoneId(zoneId);
    try {
      const res = await fetch('/api/fleet/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zone_id: zoneId })
      });
      const data = await res.json();
      if (data.success && data.active_zone) {
        handleSelectCrop(data.active_zone.crop_key);
        fetch('/api/fleet/zones')
          .then((r) => r.json())
          .then((fz) => { if (fz.zones) setFleetZones(fz.zones); });
      }
    } catch (err) {
      console.error('Failed to switch greenhouse zone:', err);
    }
  };

  // Send Test Alert to Telegram Bot
  const handleSendTelegramTest = async () => {
    setIsSendingTg(true);
    try {
      const res = await fetch('/api/telegram/test', { method: 'POST' });
      const data = await res.json();
      setTelegramSimOutput(data.message || data.preview || 'Test alert dispatched!');
    } catch (err) {
      setTelegramSimOutput('Error sending Telegram alert: ' + err.message);
    } finally {
      setIsSendingTg(false);
    }
  };

  // Execute 2-Way Command on Telegram Bot
  const handleRunTelegramCommand = async () => {
    if (!telegramCmdInput.trim()) return;
    try {
      const res = await fetch('/api/telegram/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: telegramCmdInput.trim() })
      });
      const data = await res.json();
      setTelegramSimOutput(data.reply || JSON.stringify(data));
      if (telegramCmdInput.startsWith('/water')) {
        fetch('/api/irrigation/status')
          .then((r) => r.json())
          .then((ir) => { if (ir.irrigation) setIrrigationStatus(ir.irrigation); });
      }
    } catch (err) {
      setTelegramSimOutput('Command execution failed: ' + err.message);
    }
  };

  // Quick Action: Inject Test Telemetry
  const handleInjectTelemetry = async () => {
    setIsInjecting(true);
    try {
      const simTemp = +(22 + Math.random() * 5).toFixed(1);
      const simHum = +(56 + Math.random() * 12).toFixed(1);
      const simSoil = +(58 + Math.random() * 14).toFixed(1);
      const simLux = Math.round(450 + Math.random() * 250);

      await fetch('/api/sensors/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-Token': 'plant-lab-auth-token-9981' },
        body: JSON.stringify({
          device_id: 'esp32-sim-ui',
          plant_id: 'hydro-specimen-1',
          temperature_c: simTemp,
          humidity_pct: simHum,
          soil_moisture_pct: simSoil,
          light_lux: simLux,
          soil_raw_adc: Math.round(3400 - (simSoil * 21)),
          water_reservoir_ok: true,
        }),
      });
    } catch (err) {
      console.error(err);
    } finally {
      setIsInjecting(false);
    }
  };

  // Camera Snapshot & Diagnosis
  const handleCameraCapture = async () => {
    setIsDiagnosing(true);
    try {
      if (pathologyEngine === 'gemini') {
        const snapRes = await fetch('/api/camera/snapshot');
        const blob = await snapRes.blob();
        const file = new File([blob], 'camera_snap.jpg', { type: 'image/jpeg' });
        await submitImageDiagnosis(file);
      } else {
        const res = await fetch('/api/camera/capture', { method: 'POST' });
        const data = await res.json();
        if (data.diagnosis) {
          setLatestDiagnosisResult(data.diagnosis);
          fetch('/api/diagnoses')
            .then((r) => r.json())
            .then((d) => setDiagnoses(d))
            .catch(() => {});
        }
      }
    } catch (err) {
      alert('Camera capture failed: ' + err.message);
    } finally {
      setIsDiagnosing(false);
    }
  };

  // Camera Network Discovery & Manual Config
  const handleAutoDiscoverCamera = async () => {
    setIsDiscovering(true);
    setDiscoveryMsg('Sweeping local network & mDNS for ESP32-S3...');
    try {
      const res = await fetch('/api/camera/discover', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setDiscoveryMsg(`Discovered ESP32-S3 at ${data.discovery.url} via ${data.discovery.method}!`);
        setCameraStatus((prev) => ({
          ...prev,
          camera_url: data.discovery.url,
          hardware_online: true,
          mode: 'ESP32-S3 LIVE'
        }));
      } else {
        setDiscoveryMsg('No active ESP32 camera found on local subnet. Using Synthetic HUD.');
      }
    } catch (err) {
      setDiscoveryMsg('Discovery sweep error: ' + err.message);
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleConfigureCamera = async () => {
    if (!customCamUrl.trim()) return;
    try {
      const res = await fetch('/api/camera/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ camera_url: customCamUrl })
      });
      const data = await res.json();
      if (data.success) {
        setCameraStatus((prev) => ({
          ...prev,
          camera_url: data.camera_url,
          hardware_online: data.hardware_online,
          mode: data.hardware_online ? 'ESP32-S3 LIVE' : 'SYNTHETIC HUD'
        }));
        setDiscoveryMsg(`Camera target updated to ${data.camera_url}`);
      }
    } catch (err) {
      alert('Failed to configure camera: ' + err.message);
    }
  };

  // Weather Forecast Handler
  const handleRefreshWeather = async () => {
    setIsRefreshingWeather(true);
    try {
      const res = await fetch('/api/weather/refresh', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setWeatherData(data);
      }
    } catch (err) {
      console.error('Weather refresh failed:', err);
    } finally {
      setIsRefreshingWeather(false);
    }
  };

  const renderWeatherIcon = (cat) => {
    switch (cat) {
      case 'rain':
        return <CloudRain className="w-5 h-5 text-cyan-400" />;
      case 'thunderstorm':
        return <CloudLightning className="w-5 h-5 text-amber-400 animate-pulse" />;
      case 'clear':
        return <Sun className="w-5 h-5 text-amber-400" />;
      case 'cloudy':
      default:
        return <CloudSun className="w-5 h-5 text-slate-300" />;
    }
  };

  // Leaf Drag & Drop Upload
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => setUploadedImagePreview(reader.result);
    reader.readAsDataURL(file);

    // Auto submit to diagnosis
    submitImageDiagnosis(file);
  };

  const submitImageDiagnosis = async (file) => {
    setIsDiagnosing(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('plant_name', plantNameInput || activeCrop?.name || 'Specimen Upload');

      const endpoint = pathologyEngine === 'gemini' ? '/api/diagnose/multimodal' : '/api/diagnose';
      const res = await fetch(endpoint, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        const resultRecord = data.diagnosis || data;
        setLatestDiagnosisResult(resultRecord);
        fetch('/api/diagnoses')
          .then((r) => r.json())
          .then((d) => setDiagnoses(d))
          .catch(() => {});
        if (pathologyEngine === 'kindwise') {
          fetch('/api/integrations/plantid/test', { method: 'POST' })
            .then((r) => r.json())
            .then((s) => {
              setApiStatus({ configured: true, remainingCredits: s.usage?.remaining?.total });
            })
            .catch(() => {});
        }
      } else {
        alert('Diagnosis failed: ' + (data.message || data.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Network error during diagnosis: ' + err.message);
    } finally {
      setIsDiagnosing(false);
    }
  };

  // Irrigation Controls
  const triggerIrrigation = async (seconds) => {
    try {
      const res = await fetch('/api/irrigation/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration_sec: seconds }),
      });
      const data = await res.json();
      if (data.irrigation) setIrrigationStatus(data.irrigation);
      if (!res.ok) alert(data.message);
    } catch (err) {
      alert('Failed to trigger irrigation: ' + err.message);
    }
  };

  const emergencyStop = async () => {
    try {
      const res = await fetch('/api/irrigation/emergency_stop', { method: 'POST' });
      const data = await res.json();
      if (data.irrigation) setIrrigationStatus(data.irrigation);
    } catch (err) {
      alert('Emergency stop failed: ' + err.message);
    }
  };

  const resetEmergencyStop = async () => {
    try {
      const res = await fetch('/api/irrigation/reset_stop', { method: 'POST' });
      const data = await res.json();
      if (data.irrigation) setIrrigationStatus(data.irrigation);
    } catch (err) {
      alert('Reset failed: ' + err.message);
    }
  };

  const toggleAutoIrrigation = async () => {
    try {
      const res = await fetch('/api/irrigation/auto_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: !irrigationStatus.auto_mode_enabled,
          soil_threshold_pct: irrigationStatus.soil_threshold_pct,
        }),
      });
      const data = await res.json();
      if (data.irrigation) setIrrigationStatus(data.irrigation);
    } catch (err) {
      alert('Toggle auto irrigation failed: ' + err.message);
    }
  };

  const currentVPD = calculateVPD(latestTelemetry?.temperature_c, latestTelemetry?.humidity_pct);
  const vpdInfo = getVPDStatus(currentVPD);

  const lightBadge = getLightCondition(latestTelemetry?.light_lux);
  const soilBadge = getSoilCondition(latestTelemetry?.soil_moisture_pct);
  const tempBadge = getTempCondition(latestTelemetry?.temperature_c);
  const humBadge = getHumidityCondition(latestTelemetry?.humidity_pct);
  const microclimate = getMicroclimateState(latestTelemetry);

  return (
    <div className="min-h-screen bg-[#070b13] text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-black">
      {/* Precision Top Command Header */}
      <header className="border-b border-slate-800/90 bg-[#0c121e]/95 backdrop-blur-md sticky top-0 z-40 px-4 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 via-teal-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-emerald-950/40 border border-emerald-400/30">
            <Sprout className="w-5 h-5 text-black" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold tracking-wider text-white">SYNTERRA</span>
              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                PRO CONSOLE
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">Agricultural Intelligence & Autonomous Pathology Monitoring</p>
          </div>
        </div>

        {/* Global Navigation Tabs */}
        <div className="flex items-center bg-slate-900/90 border border-slate-800 p-1 rounded-xl text-xs font-medium">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition ${
              activeTab === 'overview' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Telemetry</span>
          </button>
          <button
            onClick={() => setActiveTab('studio')}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition ${
              activeTab === 'studio' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Pathology Studio</span>
          </button>
          <button
            onClick={() => setActiveTab('irrigation')}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition ${
              activeTab === 'irrigation' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Droplets className="w-3.5 h-3.5" />
            <span>Irrigation</span>
          </button>
          <button
            onClick={() => setActiveTab('dossiers')}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition ${
              activeTab === 'dossiers' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-400 hover:text-white'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Dossiers</span>
          </button>
        </div>

        {/* Multi-Zone Greenhouse Fleet Selector */}
        {fleetZones && fleetZones.length > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700/80 text-xs shadow-inner">
            <Globe className="w-3.5 h-3.5 text-teal-400 shrink-0" />
            <span className="text-slate-400 hidden md:inline font-medium">Zone:</span>
            <select
              value={activeZoneId}
              onChange={(e) => handleSwitchZone(e.target.value)}
              className="bg-transparent text-slate-100 text-xs font-bold outline-none cursor-pointer"
            >
              {fleetZones.map((z) => (
                <option key={z.id} value={z.id} className="bg-slate-900 text-white">
                  {z.crop_icon} {z.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Status Indicators */}
        <div className="flex items-center gap-3 text-xs">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${
            socketConnected ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300' : 'bg-amber-950/30 border-amber-500/40 text-amber-300'
          }`}>
            <span className={`w-2 h-2 rounded-full ${socketConnected ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'}`} />
            <Radio className="w-3.5 h-3.5" />
            <span className="font-semibold">{socketConnected ? 'WEBSOCKET ONLINE' : 'OFFLINE POLLING'}</span>
          </div>

          <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700/80 text-slate-300">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>Kindwise AI:</span>
            <span className="font-bold text-white">{apiStatus.remainingCredits !== null ? `${apiStatus.remainingCredits} Credits` : 'Online'}</span>
          </div>
        </div>
      </header>

      {/* Main Workspace Body */}
      <main className="flex-1 p-4 lg:p-8 max-w-7xl mx-auto w-full space-y-6">

        {/* ==================================================================== */}
        {/* TAB 1: TELEMETRY & COMMAND OVERVIEW */}
        {/* ==================================================================== */}
        {activeTab === 'overview' && (
          <div className="space-y-6 animate-fadeIn">
            {/* Control & Heartbeat Header */}
            <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/60 border border-slate-800 p-4 rounded-2xl">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-emerald-400">
                  <Cpu className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                      Node: {latestTelemetry?.device_id || 'esp32-sensor-01'}
                    </h2>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                      Specimen: {latestTelemetry?.plant_id || 'Tomato Alpha'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    <span>Last Telemetry Sync: {lastPacketTime ? lastPacketTime.toLocaleTimeString() : 'Awaiting data...'}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleInjectTelemetry}
                  disabled={isInjecting}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold transition active:scale-95 disabled:opacity-50"
                >
                  <Send className={`w-3.5 h-3.5 text-emerald-400 ${isInjecting ? 'animate-bounce' : ''}`} />
                  <span>{isInjecting ? 'Emitting...' : 'Test Telemetry Pulse'}</span>
                </button>
                <button
                  onClick={fetchInitialData}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition"
                  title="Force Refresh Data"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Authoritative GBIF Biodiversity Taxonomy Strip */}
            {gbifTaxonomy && gbifTaxonomy.success && (
              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 text-xs flex flex-wrap items-center justify-between gap-3 shadow-inner">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1.5 text-teal-400 font-bold">
                    <Globe className="w-3.5 h-3.5 text-teal-400" />
                    <span>GBIF Backbone Taxonomy:</span>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[11px] border border-slate-700">
                    Family: <strong className="text-white">{gbifTaxonomy.taxonomy?.family || 'Solanaceae'}</strong>
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[11px] border border-slate-700">
                    Genus: <strong className="text-white">{gbifTaxonomy.taxonomy?.genus || 'Solanum'}</strong>
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[11px] border border-slate-700">
                    Order: <strong className="text-slate-300">{gbifTaxonomy.taxonomy?.order || 'Solanales'}</strong>
                  </span>
                  <span className="px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 font-mono text-[11px] border border-emerald-800/40">
                    Key #{gbifTaxonomy.gbif_usage_key || '2930137'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400 font-mono">
                    Status: <span className="text-emerald-400 font-bold">{gbifTaxonomy.taxonomic_status || 'ACCEPTED'}</span> ({gbifTaxonomy.confidence_score || 98}% match)
                  </span>
                  <span className="text-[9px] uppercase tracking-wider px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 font-mono">
                    Global Biodiversity Info
                  </span>
                </div>
              </div>
            )}

            {/* Live Microclimate Environmental Assessment Banner */}
            <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-900 via-[#101827] to-[#0c1322] border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-950/40 text-amber-400 border border-amber-900/50">
                  <CloudSun className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Canopy Microclimate Intelligence</span>
                    <span className="text-sm font-black text-white">{microclimate.title}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{microclimate.desc}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 self-start sm:self-auto">
                <span className="px-3 py-1 rounded-xl text-xs font-bold bg-slate-800 border border-slate-700 text-amber-300">
                  {microclimate.badge}
                </span>
              </div>
            </div>

            {/* Core Metrics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Temperature */}
              <div className="bg-[#0d1422] border border-slate-800/80 rounded-2xl p-5 relative overflow-hidden group hover:border-slate-700 transition">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-bold uppercase tracking-wider">Canopy Temperature</span>
                  <div className="p-2 rounded-xl bg-rose-950/40 text-rose-400 border border-rose-900/40">
                    <Thermometer className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-3xl font-black tracking-tight text-white">
                    {latestTelemetry?.temperature_c !== undefined ? `${latestTelemetry.temperature_c}` : '--'}
                  </span>
                  <span className="text-base font-semibold text-slate-400">°C</span>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800/60">
                  <span>Target: {activeCrop?.target_temp_c ? `${activeCrop.target_temp_c[0]}–${activeCrop.target_temp_c[1]}°C` : '20–26°C'}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${tempBadge.bg}`}>
                    {tempBadge.label}
                  </span>
                </div>
              </div>

              {/* Relative Humidity */}
              <div className="bg-[#0d1422] border border-slate-800/80 rounded-2xl p-5 relative overflow-hidden group hover:border-slate-700 transition">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-bold uppercase tracking-wider">Relative Humidity</span>
                  <div className="p-2 rounded-xl bg-cyan-950/40 text-cyan-400 border border-cyan-900/40">
                    <Droplets className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-3xl font-black tracking-tight text-white">
                    {latestTelemetry?.humidity_pct !== undefined ? `${latestTelemetry.humidity_pct}` : '--'}
                  </span>
                  <span className="text-base font-semibold text-slate-400">%</span>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800/60">
                  <span>Target: {activeCrop?.target_humidity_pct ? `${activeCrop.target_humidity_pct[0]}–${activeCrop.target_humidity_pct[1]}%` : '55–70%'}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${humBadge.bg}`}>
                    {humBadge.label}
                  </span>
                </div>
              </div>

              {/* Soil Moisture */}
              <div className="bg-[#0d1422] border border-slate-800/80 rounded-2xl p-5 relative overflow-hidden group hover:border-slate-700 transition">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-bold uppercase tracking-wider">Substrate Moisture</span>
                  <div className="p-2 rounded-xl bg-emerald-950/40 text-emerald-400 border border-emerald-900/40">
                    <Sprout className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-3xl font-black tracking-tight text-white">
                    {latestTelemetry?.soil_moisture_pct !== undefined ? `${latestTelemetry.soil_moisture_pct}` : '--'}
                  </span>
                  <span className="text-base font-semibold text-slate-400">%</span>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800/60">
                  <span>Auto @ {activeCrop?.watering_threshold_pct || 45}%</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${soilBadge.bg}`}>
                    {soilBadge.label}
                  </span>
                </div>
              </div>

              {/* Ambient Light */}
              <div className="bg-[#0d1422] border border-slate-800/80 rounded-2xl p-5 relative overflow-hidden group hover:border-slate-700 transition">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-xs font-bold uppercase tracking-wider">Photometric Flux</span>
                  <div className="p-2 rounded-xl bg-amber-950/40 text-amber-400 border border-amber-900/40">
                    <Sun className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-3xl font-black tracking-tight text-white">
                    {latestTelemetry?.light_lux !== undefined ? `${latestTelemetry.light_lux}` : '--'}
                  </span>
                  <span className="text-base font-semibold text-slate-400">Lux</span>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800/60">
                  <span>Goal: {activeCrop?.target_dli_mol || 16} DLI ({activeCrop?.photoperiod_hours || 14}h)</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${lightBadge.bg}`}>
                    {lightBadge.label}
                  </span>
                </div>
              </div>
            </div>

            {/* Agronomic VPD, DLI Accumulator & Safety Interlock Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Vapor Pressure Deficit (VPD) Agronomic Card */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-900 to-[#0e1628] border border-slate-800 flex flex-col justify-between gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-indigo-950/50 text-indigo-400 border border-indigo-900/40">
                      <Gauge className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Vapor Pressure Deficit (VPD)</span>
                        <span className="text-lg font-black text-white">{currentVPD !== null ? `${currentVPD} kPa` : '--'}</span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">Optimal range: {activeCrop?.optimal_vpd_kpa ? `${activeCrop.optimal_vpd_kpa[0]}–${activeCrop.optimal_vpd_kpa[1]} kPa` : '0.8–1.2 kPa'}</p>
                    </div>
                  </div>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-lg ${vpdInfo.bg} ${vpdInfo.color} border border-slate-700/60 shrink-0`}>
                    {vpdInfo.label}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 pt-2 border-t border-slate-800/60 flex items-center justify-between">
                  <span>Psychrometric transpirational pressure</span>
                  <span className="text-indigo-400 font-medium">Canopy Stomata Equilibrium</span>
                </div>
              </div>

              {/* Daily Light Integral (DLI) & Photoperiod Accumulator Card */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-900 to-[#121c2e] border border-slate-800 flex flex-col justify-between gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-amber-950/50 text-amber-400 border border-amber-900/40">
                      <Sun className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Daily Light Integral (DLI)</span>
                        <span className="text-lg font-black text-white">{dliData?.accumulated_dli || '0.0'}</span>
                        <span className="text-xs font-bold text-slate-400">/ {dliData?.target_dli || activeCrop?.target_dli_mol || '16.0'} mol/m²/d</span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Photoperiod: <span className="text-amber-300 font-bold">{dliData?.photoperiod_hours || '0.0'}h</span> / {dliData?.photoperiod_target_hours || activeCrop?.photoperiod_hours || '14.0'}h target
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-amber-950/50 text-amber-300 border border-amber-700/50 shrink-0">
                    {dliData?.progress_pct || 0}%
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-slate-800/80 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-amber-500 to-yellow-400 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, dliData?.progress_pct || 0)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/60">
                  <span>Current PPFD: {dliData?.current_ppfd || Math.round((latestTelemetry?.light_lux || 0)/54)} µmol/m²/s</span>
                  <span className="text-emerald-400 font-medium">
                    {(dliData?.progress_pct || 0) >= 80 ? '✓ Photoperiod Target Reached' : 'Accumulating Solar Photons'}
                  </span>
                </div>
              </div>

              {/* Water Reservoir Interlock State */}
              <div className={`p-4 rounded-2xl border flex flex-col justify-between gap-3 ${
                latestTelemetry?.water_reservoir_ok !== false
                  ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-950/30 border-rose-500/50 text-rose-300'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {latestTelemetry?.water_reservoir_ok !== false ? (
                      <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                    )}
                    <div>
                      <p className="font-bold text-xs uppercase tracking-wider">
                        {latestTelemetry?.water_reservoir_ok !== false ? 'Reservoir: SAFE & ARMED' : 'RESERVOIR EMPTY: INTERLOCKED'}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {latestTelemetry?.water_reservoir_ok !== false
                          ? 'Hardware float switch reports liquid supply.'
                          : 'Pump relay locked out to prevent motor dry-run burn.'}
                      </p>
                    </div>
                  </div>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-lg uppercase shrink-0 ${
                    latestTelemetry?.water_reservoir_ok !== false
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                  }`}>
                    {latestTelemetry?.water_reservoir_ok !== false ? 'ARMED' : 'INTERLOCKED'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 pt-2 border-t border-slate-800/60 flex items-center justify-between">
                  <span>Hardware Submersible Solenoid</span>
                  <span className="text-emerald-400 font-medium">Auto-Trigger at {activeCrop?.watering_threshold_pct || 45}% Soil</span>
                </div>
              </div>
            </div>

            {/* Sensor Accuracy & Meteorological Ground-Truth Benchmark */}
            {accuracyData && (
              <div className="bg-[#0c1424] border border-slate-800 rounded-2xl p-5 space-y-3.5 shadow-xl">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-teal-950/60 text-teal-400 border border-teal-800/40">
                      <Sliders className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-white text-sm">Hardware Telemetry vs. Meteorological Ground-Truth</h3>
                        <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                          {accuracyData.weather_station?.provider || 'Regional Reanalysis'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Real-time precision cross-validation of on-site ESP32 sensors against regional meteorological station ground-truth ({accuracyData.weather_station?.location || 'Regional Hub'}).
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-bold px-3 py-1 rounded-lg border uppercase tracking-wider flex items-center gap-1.5 ${
                      (accuracyData.comparison?.composite_accuracy_pct || 90) >= 90
                        ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                        : (accuracyData.comparison?.composite_accuracy_pct || 90) >= 75
                        ? 'bg-teal-500/10 text-teal-300 border-teal-500/30'
                        : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                    }`}>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{accuracyData.comparison?.composite_accuracy_pct ?? 92.5}% Hardware Accuracy</span>
                    </span>
                    <button
                      onClick={handleRefreshAccuracy}
                      disabled={isComparingAccuracy}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition border border-slate-700 disabled:opacity-50"
                      title="Re-run Ground-Truth Cross-Check"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isComparingAccuracy ? 'animate-spin text-teal-400' : ''}`} />
                    </button>
                  </div>
                </div>

                {/* 3 Pods Comparison Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* Pod 1: Temperature Benchmark */}
                  <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 font-medium flex items-center gap-1.5">
                        <Thermometer className="w-3.5 h-3.5 text-rose-400" />
                        <span>Canopy Temperature</span>
                      </span>
                      <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-800/30 font-bold">
                        {accuracyData.comparison?.temp_accuracy_pct ?? 95}% Fidelity
                      </span>
                    </div>

                    <div className="flex items-baseline justify-between pt-1">
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase font-mono">ESP32 Sensor</p>
                        <p className="text-lg font-black text-white font-mono">
                          {latestTelemetry?.temperature_c !== undefined
                            ? `${latestTelemetry.temperature_c}°C`
                            : `${accuracyData.sensor?.temperature_c ?? 25.0}°C`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-slate-500 uppercase font-mono">Weather Station</p>
                        <p className="text-sm font-bold text-slate-300 font-mono">
                          {accuracyData.weather_station?.temperature_c}°C
                        </p>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">Microclimate Variance:</span>
                      <span className={`font-mono font-bold ${
                        (accuracyData.comparison?.temp_delta_abs || 0) <= 1.5 ? 'text-emerald-400' : 'text-amber-400'
                      }`}>
                        {accuracyData.comparison?.temp_delta_c > 0 ? '+' : ''}{accuracyData.comparison?.temp_delta_c}°C
                      </span>
                    </div>
                  </div>

                  {/* Pod 2: Relative Humidity Benchmark */}
                  <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 font-medium flex items-center gap-1.5">
                        <Droplets className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Relative Humidity</span>
                      </span>
                      <span className="text-[10px] font-mono text-teal-400 bg-teal-950/40 px-1.5 py-0.5 rounded border border-teal-800/30 font-bold">
                        {accuracyData.comparison?.humidity_accuracy_pct ?? 93}% Fidelity
                      </span>
                    </div>

                    <div className="flex items-baseline justify-between pt-1">
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase font-mono">ESP32 Sensor</p>
                        <p className="text-lg font-black text-white font-mono">
                          {latestTelemetry?.humidity_pct !== undefined
                            ? `${latestTelemetry.humidity_pct}%`
                            : `${accuracyData.sensor?.humidity_pct ?? 60.0}%`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-slate-500 uppercase font-mono">Weather Station</p>
                        <p className="text-sm font-bold text-slate-300 font-mono">
                          {accuracyData.weather_station?.humidity_pct}%
                        </p>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">Canopy Humidity Offset:</span>
                      <span className={`font-mono font-bold ${
                        (accuracyData.comparison?.humidity_delta_abs || 0) <= 6.0 ? 'text-teal-400' : 'text-amber-400'
                      }`}>
                        {accuracyData.comparison?.humidity_delta_pct > 0 ? '+' : ''}{accuracyData.comparison?.humidity_delta_pct}%
                      </span>
                    </div>
                  </div>

                  {/* Pod 3: Ground-Truth Agronomic Interpretation */}
                  <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-2 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="text-slate-400 font-medium flex items-center gap-1.5">
                          <Activity className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Calibration Status</span>
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">
                          <strong className="text-white">{accuracyData.comparison?.calibration_status?.split(' ')[0] || 'EXCELLENT'}</strong>
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        {accuracyData.comparison?.insights?.[0] || 'On-site sensor hardware correlates closely with ambient meteorological ground-truth.'}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-slate-800/80 text-[10px] text-slate-400 flex items-center justify-between">
                      <span>Node ID: <strong className="text-slate-300 font-mono">{accuracyData.device_id || 'ESP32'}</strong></span>
                      <span className="text-emerald-400 font-medium">Valid Ground-Truth</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Solar Radiation & Microclimate Radiative Flux (Open-Meteo) Card */}
            <div className="bg-[#0c1424] border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-amber-950/60 text-amber-400 border border-amber-800/40">
                    <Sun className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-white text-sm">Solar Radiation &amp; Shortwave Radiative Flux Intelligence</h3>
                      <span className="text-[10px] font-mono text-amber-400 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-800/30">
                        Open-Meteo Solar Reanalysis
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Direct normal irradiance (DNI), global horizontal irradiance (GHI), and outdoor substrate temperatures correlated with on-site BH1750 photometrics.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-slate-400 bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-800">
                    13.08&deg;N, 80.27&deg;E
                  </span>
                </div>
              </div>

              {/* 4 Solar & Microclimate Metric Pods */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Direct Normal (DNI)</span>
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                  </div>
                  <div className="mt-1.5 flex items-baseline gap-1">
                    <span className="text-2xl font-black text-white font-mono">
                      {solarWeather?.direct_normal_irradiance_w_m2 ?? 0.0}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">W/m²</span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">Direct beam solar flux</p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Global Horiz. (GHI)</span>
                    <Sun className="w-3.5 h-3.5 text-yellow-400" />
                  </div>
                  <div className="mt-1.5 flex items-baseline gap-1">
                    <span className="text-2xl font-black text-white font-mono">
                      {solarWeather?.global_horizontal_irradiance_w_m2 ?? 0.0}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">W/m²</span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">Total hemispherical flux</p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Outdoor Soil Temp</span>
                    <Thermometer className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                  <div className="mt-1.5 flex items-baseline gap-1">
                    <span className="text-2xl font-bold text-emerald-400 font-mono">
                      {solarWeather?.outdoor_soil_temp_c !== undefined ? `${solarWeather.outdoor_soil_temp_c}°C` : '24.5°C'}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">Topsoil profile (0–7cm)</p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Canopy Photometrics</span>
                    <Sun className="w-3.5 h-3.5 text-amber-400" />
                  </div>
                  <div className="mt-1.5 flex items-baseline gap-1">
                    <span className="text-2xl font-bold text-amber-400 font-mono">
                      {latestTelemetry?.light_lux !== undefined ? `${latestTelemetry.light_lux} Lux` : '--'}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">Physical BH1750 on-site</p>
                </div>
              </div>

              <div className="text-[11px] text-slate-400 pt-1 flex items-center justify-between border-t border-slate-800/60">
                <span>Flux cross-correlation with on-site BH1750 sensor</span>
                <span className="text-emerald-400 font-medium">Calibrated Shortwave Spectrum &bull; Open-Meteo Reanalysis</span>
              </div>
            </div>

            {/* Agronomic Biophysics, Evapotranspiration (ET0) & Fungal Spore Risk Card */}
            <div className="bg-[#0c1424] border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-teal-950/60 text-teal-400 border border-teal-800/40">
                    <Sprout className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-white text-sm">Agronomic Biophysics &amp; Preventative Spore Intelligence</h3>
                      <span className="text-[10px] font-mono text-teal-400 bg-teal-950/40 px-2 py-0.5 rounded border border-teal-800/30">
                        FAO-56 ET₀ &bull; Smith Period &bull; BBCH GDD
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Microclimate energy balance, reference evapotranspiration, and pathogen incubation modeling.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-slate-300 bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-800">
                    GDD: <strong className="text-amber-400">{agronomyData?.gdd_phenology?.cumulative_gdd || 530.6} &deg;C&middot;d</strong>
                  </span>
                </div>
              </div>

              {/* 3 Analytics Pods */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Pod 1: Evapotranspiration & Water Depletion */}
                <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between text-xs text-cyan-300 font-bold mb-1.5">
                      <span className="flex items-center gap-1.5">
                        <Droplets className="w-3.5 h-3.5" />
                        <span>FAO-56 Evapotranspiration (ET₀)</span>
                      </span>
                      <span className="font-mono text-[10px] bg-cyan-950/40 px-1.5 py-0.5 rounded border border-cyan-800/30">
                        Kc: {agronomyData?.evapotranspiration?.crop_coefficient_kc || 1.15}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-2 pt-1">
                      <span className="text-2xl font-black text-white font-mono">
                        {agronomyData?.evapotranspiration?.et0_mm_day || 0.87}
                      </span>
                      <span className="text-xs text-slate-400">mm/day</span>
                      <span className="text-xs font-mono text-cyan-400 ml-auto">
                        (~{agronomyData?.evapotranspiration?.estimated_daily_ml || 120} mL/pot)
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                      Crop consumption rate: <strong className="text-slate-200">{agronomyData?.evapotranspiration?.etc_crop_mm_day || 1.0} mm/d</strong>.
                    </p>
                  </div>

                  <div className="pt-2 border-t border-slate-800 text-[11px] flex items-center justify-between text-slate-400">
                    <span>Depletion Forecast:</span>
                    <span className="font-mono text-emerald-400 font-bold">
                      {agronomyData?.water_depletion?.hours_until_irrigation_required > 0
                        ? `Next pulse in ~${agronomyData.water_depletion.hours_until_irrigation_required}h`
                        : 'Substrate at target threshold'}
                    </span>
                  </div>
                </div>

                {/* Pod 2: Predictive Fungal Spore Risk (Smith Period) */}
                <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between text-xs text-amber-300 font-bold mb-1.5">
                      <span className="flex items-center gap-1.5">
                        <Bug className="w-3.5 h-3.5" />
                        <span>Fungal Spore Risk (Smith Period)</span>
                      </span>
                      <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded border uppercase font-bold ${
                        (agronomyData?.fungal_spore_risk?.spore_germination_index || 30) >= 70
                          ? 'bg-rose-950/50 text-rose-300 border-rose-800/40'
                          : 'bg-emerald-950/50 text-emerald-300 border-emerald-800/40'
                      }`}>
                        {agronomyData?.fungal_spore_risk?.risk_level?.split(' ')[0] || 'NEGLIGIBLE'}
                      </span>
                    </div>

                    <div className="space-y-1 pt-1">
                      <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                        <span>Spore Germination Index:</span>
                        <span className="text-white font-bold">{agronomyData?.fungal_spore_risk?.spore_germination_index || 30.9}%</span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          style={{ width: `${Math.min(100, agronomyData?.fungal_spore_risk?.spore_germination_index || 31)}%` }}
                          className={`h-full transition-all duration-500 ${
                            (agronomyData?.fungal_spore_risk?.spore_germination_index || 30) >= 70
                              ? 'bg-gradient-to-r from-amber-500 to-rose-500'
                              : 'bg-gradient-to-r from-teal-500 to-emerald-400'
                          }`}
                        />
                      </div>
                    </div>

                    <p className="text-[11px] text-slate-300 mt-2 leading-relaxed">
                      {agronomyData?.fungal_spore_risk?.agronomic_advisory || 'Dry foliar microclimate. Spore germination suspended.'}
                    </p>
                  </div>

                  <div className="pt-2 border-t border-slate-800 text-[10px] text-slate-500 flex items-center justify-between font-mono">
                    <span>Target: Alternaria / Phytophthora</span>
                    <span className="text-emerald-400">Mills &amp; Smith Scale</span>
                  </div>
                </div>

                {/* Pod 3: Growing Degree Days & Phenology (BBCH) */}
                <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between text-xs text-amber-300 font-bold mb-1.5">
                      <span className="flex items-center gap-1.5">
                        <Sun className="w-3.5 h-3.5" />
                        <span>BBCH Phenological Stage</span>
                      </span>
                      <span className="font-mono text-[10px] bg-amber-950/40 text-amber-400 px-1.5 py-0.5 rounded border border-amber-800/30">
                        {agronomyData?.gdd_phenology?.bbch_code || 'BBCH 51-65'}
                      </span>
                    </div>

                    <p className="text-sm font-black text-white mt-1">
                      {agronomyData?.gdd_phenology?.current_stage_name || 'Inflorescence & Flowering'}
                    </p>

                    <div className="space-y-1 pt-2">
                      <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                        <span>Stage Progress:</span>
                        <span className="text-amber-400 font-bold">{agronomyData?.gdd_phenology?.stage_progress_pct || 44.3}%</span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          style={{ width: `${Math.min(100, agronomyData?.gdd_phenology?.stage_progress_pct || 44)}%` }}
                          className="h-full bg-gradient-to-r from-yellow-500 to-amber-400 transition-all duration-500"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
                    <span>Next: <strong className="text-slate-200">{agronomyData?.gdd_phenology?.next_stage_name || 'Fruit Development'}</strong></span>
                    <span className="font-mono text-amber-400 font-bold">+{agronomyData?.gdd_phenology?.gdd_to_next_stage || 189} GDD</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 5-Day Macroclimate & Agro-Meteorology Predictive Trend */}
            <div className="bg-[#0d1422] border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-teal-950/50 text-teal-400 border border-teal-800/40">
                    <CloudSun className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-white text-sm">5-Day Macroclimate & Pathogen Incubation Forecast</h3>
                      {weatherData?.location && (
                        <span className="text-[11px] text-slate-400 flex items-center gap-1 font-medium">
                          <MapPin className="w-3 h-3 text-emerald-400" />
                          <span>{weatherData.location.city}, {weatherData.location.region} ({weatherData.location.country})</span>
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">Predictive atmospheric forecast for disease spore prevention & automated irrigation scheduling.</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {weatherData?.overall_risk && (
                    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border uppercase tracking-wider flex items-center gap-1.5 ${
                      weatherData.overall_risk === 'HIGH'
                        ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                        : weatherData.overall_risk === 'MODERATE'
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    }`}>
                      <span className={`w-2 h-2 rounded-full ${
                        weatherData.overall_risk === 'HIGH' ? 'bg-rose-500 animate-ping' : weatherData.overall_risk === 'MODERATE' ? 'bg-amber-400' : 'bg-emerald-400'
                      }`} />
                      <span>{weatherData.overall_risk} Pathogen Risk</span>
                    </span>
                  )}
                  <button
                    onClick={handleRefreshWeather}
                    disabled={isRefreshingWeather}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition border border-slate-700 disabled:opacity-50"
                    title="Refresh 5-Day Forecast"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingWeather ? 'animate-spin text-teal-400' : ''}`} />
                  </button>
                </div>
              </div>

              {/* 5-Day Forecast Grid */}
              {weatherData?.forecast ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
                  {weatherData.forecast.map((day, idx) => (
                    <div
                      key={day.date}
                      className={`p-3 rounded-xl border flex flex-col justify-between transition hover:border-slate-700 ${
                        idx === 0
                          ? 'bg-gradient-to-b from-slate-900 via-slate-900/90 to-[#0a1724] border-teal-500/30 shadow-lg ring-1 ring-teal-500/20'
                          : 'bg-slate-900/40 border-slate-800/80 hover:bg-slate-900/60'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className={`font-bold text-xs ${idx === 0 ? 'text-teal-300' : 'text-white'}`}>
                            {idx === 0 ? 'Today (Live)' : day.day_name}
                          </span>
                          <span className="text-[10px] font-mono text-slate-500">{day.date_display}</span>
                        </div>

                        <div className="my-2.5 flex items-center gap-2">
                          {renderWeatherIcon(day.category)}
                          <div className="truncate">
                            <p className="text-xs font-semibold text-slate-200 truncate">{day.condition}</p>
                            <p className="text-[10px] text-slate-400 font-mono">{day.temp_min}°C &ndash; {day.temp_max}°C</p>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2 pt-2 border-t border-slate-800/80 text-[10px]">
                        <div>
                          <div className="flex items-center justify-between text-slate-400 mb-1">
                            <span className="flex items-center gap-1">
                              <Droplets className="w-3 h-3 text-cyan-400" />
                              <span>Rain Prob:</span>
                            </span>
                            <span className="font-mono font-bold text-slate-200">{day.precip_prob}%</span>
                          </div>
                          {/* Mini Progress Bar */}
                          <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                day.precip_prob >= 60 ? 'bg-cyan-400' : day.precip_prob >= 30 ? 'bg-teal-400' : 'bg-slate-600'
                              }`}
                              style={{ width: `${Math.max(5, day.precip_prob)}%` }}
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-slate-400">
                          <span>Mean Humidity:</span>
                          <span className="font-mono text-slate-300">{day.humidity_pct}%</span>
                        </div>

                        <div className={`mt-1 text-[9px] font-bold px-2 py-0.5 rounded-md text-center border uppercase tracking-wider ${
                          day.risk_level === 'HIGH'
                            ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                            : day.risk_level === 'MODERATE'
                            ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                            : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                        }`}>
                          {day.risk_level === 'HIGH' ? 'Elevated Spore Risk' : day.risk_level === 'MODERATE' ? 'Moderate Risk' : 'Optimal Vector'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-6 flex items-center justify-center text-xs text-slate-500">
                  <RefreshCw className="w-4 h-4 animate-spin mr-2 text-teal-400" />
                  <span>Loading local 5-day weather & disease risk model...</span>
                </div>
              )}

              {/* Agro-Meteorological Vector & Tactical Advisory Panel */}
              {weatherData && (
                <div className="rounded-xl border border-slate-800/90 bg-gradient-to-b from-[#0c1524]/90 to-[#080e18]/95 p-4 space-y-3.5 shadow-xl">
                  {/* Top Header of Advisory Panel */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-800/80">
                    <div className="flex items-center gap-2.5">
                      <div className={`p-1.5 rounded-lg border ${
                        weatherData.overall_risk === 'HIGH'
                          ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                          : weatherData.overall_risk === 'MODERATE'
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                          : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      }`}>
                        <ShieldAlert className="w-4 h-4" />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-white tracking-wide">
                          {weatherData.advisory_title || "Pathogen Vector Intelligence"}
                        </span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                          weatherData.overall_risk === 'HIGH'
                            ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                            : weatherData.overall_risk === 'MODERATE'
                            ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                            : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                        }`}>
                          {weatherData.pathogen_pressure || `${weatherData.overall_risk} Risk Profile`}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono font-medium px-2.5 py-1 rounded-lg bg-teal-950/40 border border-teal-700/40 text-teal-300 flex items-center gap-1.5">
                        <Droplets className="w-3 h-3 text-teal-400" />
                        <span>{weatherData.irrigation_directive || weatherData.irrigation_recommendation}</span>
                      </span>
                    </div>
                  </div>

                  {/* Two Column Structured Body */}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 text-xs">
                    {/* Left Column: Canopy Vector Analysis */}
                    <div className="md:col-span-6 p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-2">
                      <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                        <span className="flex items-center gap-1.5 text-slate-300">
                          <Activity className="w-3.5 h-3.5 text-teal-400" />
                          <span>Epidemiological Impact</span>
                        </span>
                        <span className="text-slate-500 font-mono text-[10px]">5-Day Synthesis</span>
                      </div>
                      <p className="text-slate-300 leading-relaxed text-xs">
                        {weatherData.executive_summary || weatherData.overall_advisory}
                      </p>
                      {weatherData.canopy_dynamics && (
                        <div className="pt-2 border-t border-slate-800/70 flex items-center gap-2 text-[11px] text-slate-400">
                          <span className="text-teal-400 font-medium shrink-0">Canopy Dynamics:</span>
                          <span className="text-slate-300">{weatherData.canopy_dynamics}</span>
                        </div>
                      )}
                    </div>

                    {/* Right Column: Prescriptive Field Protocols */}
                    <div className="md:col-span-6 p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-2">
                      <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                        <span className="flex items-center gap-1.5 text-slate-300">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Actionable Field Directives</span>
                        </span>
                        <span className="text-[10px] text-emerald-400 font-medium">Priority</span>
                      </div>
                      <ul className="space-y-1.5 text-xs text-slate-300">
                        {(weatherData.action_items && weatherData.action_items.length > 0) ? (
                          weatherData.action_items.map((item, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-[11px] leading-snug">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1 shrink-0" />
                              <span>{item}</span>
                            </li>
                          ))
                        ) : (
                          <>
                            <li className="flex items-start gap-2 text-[11px] leading-snug">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1 shrink-0" />
                              <span>Regulate automated drip cycles based on ambient rain accumulation.</span>
                            </li>
                            <li className="flex items-start gap-2 text-[11px] leading-snug">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1 shrink-0" />
                              <span>Ensure active horizontal airflow to accelerate morning leaf drying.</span>
                            </li>
                          </>
                        )}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Time Series Charts */}
            <div className="bg-[#0d1422] border border-slate-800 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  <h3 className="font-bold text-white text-sm">Dynamic Environmental Dynamics Curve</h3>
                </div>
                <div className="flex items-center bg-slate-900 border border-slate-800 p-1 rounded-xl text-xs">
                  <button
                    onClick={() => setChartSubTab('climate')}
                    className={`px-3 py-1 rounded-lg font-medium transition ${
                      chartSubTab === 'climate' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Canopy Climate (°C / %)
                  </button>
                  <button
                    onClick={() => setChartSubTab('root')}
                    className={`px-3 py-1 rounded-lg font-medium transition ${
                      chartSubTab === 'root' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Substrate & Flux (% / Lux)
                  </button>
                </div>
              </div>

              <div className="h-72 w-full pt-2">
                {telemetryHistory.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    {chartSubTab === 'climate' ? (
                      <LineChart data={telemetryHistory}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickMargin={8} />
                        <YAxis yAxisId="left" stroke="#f43f5e" fontSize={11} domain={['auto', 'auto']} unit="°C" />
                        <YAxis yAxisId="right" orientation="right" stroke="#06b6d4" fontSize={11} domain={[0, 100]} unit="%" />
                        <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.75rem', fontSize: '12px' }} />
                        <Line yAxisId="left" type="monotone" dataKey="temp" stroke="#f43f5e" strokeWidth={2.5} dot={false} name="Temp (°C)" />
                        <Line yAxisId="right" type="monotone" dataKey="hum" stroke="#06b6d4" strokeWidth={2.5} dot={false} name="Humidity (%)" />
                      </LineChart>
                    ) : (
                      <AreaChart data={telemetryHistory}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickMargin={8} />
                        <YAxis yAxisId="left" stroke="#10b981" fontSize={11} domain={[0, 100]} unit="%" />
                        <YAxis yAxisId="right" orientation="right" stroke="#f59e0b" fontSize={11} domain={['auto', 'auto']} unit="lx" />
                        <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.75rem', fontSize: '12px' }} />
                        <Area yAxisId="left" type="monotone" dataKey="soil" stroke="#10b981" fill="#10b981" fillOpacity={0.15} name="Soil Moisture (%)" />
                        <Line yAxisId="right" type="monotone" dataKey="lux" stroke="#f59e0b" strokeWidth={2} dot={false} name="Light (Lux)" />
                      </AreaChart>
                    )}
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs">
                    <Activity className="w-8 h-8 mb-2 animate-pulse text-slate-600" />
                    <span>Awaiting data points. Start USB serial bridge or emit a telemetry pulse.</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* TAB 2: PATHOLOGY STUDIO & LIVE CAMERA VIEW */}
        {/* ==================================================================== */}
        {activeTab === 'studio' && (
          <div className="space-y-6 animate-fadeIn">
            {/* AI Pathology Diagnostic Engine Switcher */}
            <div className="p-3.5 rounded-2xl bg-gradient-to-r from-slate-900 via-[#0e1628] to-[#0a1424] border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-950/60 text-emerald-400 border border-emerald-800/40">
                  <Atom className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">Diagnostic Vision Engine</span>
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                      Dual-Engine Architecture
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">Select primary inference model for leaf pathology and abiotic stress diagnosis.</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPathologyEngine('gemini')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                    pathologyEngine === 'gemini'
                      ? 'bg-gradient-to-r from-emerald-600 to-teal-500 text-black shadow-lg shadow-emerald-950'
                      : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-700'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Google Gemini Vision AI</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPathologyEngine('kindwise')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                    pathologyEngine === 'kindwise'
                      ? 'bg-gradient-to-r from-emerald-600 to-teal-500 text-black shadow-lg shadow-emerald-950'
                      : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-700'
                  }`}
                >
                  <Sprout className="w-3.5 h-3.5" />
                  <span>Kindwise Crop.Health</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left Column: Live Optical Feed */}
              <div className="bg-[#0d1422] border border-slate-800 rounded-2xl p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Camera className="w-4 h-4 text-emerald-400" />
                      <h3 className="font-bold text-white text-sm">Optical Feed (ESP32-CAM / OV2640)</h3>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      MJPEG 15 FPS
                    </span>
                  </div>

                  {/* MJPEG Stream Container */}
                  <div className="relative rounded-xl overflow-hidden border border-slate-800/90 bg-[#070b13] aspect-video flex items-center justify-center group">
                    {cameraStatus.hardware_online ? (
                      <>
                        <img
                          src="/api/camera/stream"
                          alt="Live Optical Feed"
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute top-3 left-3 bg-black/60 backdrop-blur px-2 py-1 rounded text-[10px] font-mono text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                          <span>LIVE FEED</span>
                        </div>
                      </>
                    ) : (
                      /* Clean Blank Space When Hardware Camera Not Connected */
                      <div className="flex flex-col items-center justify-center gap-2.5 text-center p-6 select-none">
                        <div className="w-12 h-12 rounded-2xl bg-slate-900/90 border border-slate-800 flex items-center justify-center text-slate-600">
                          <Camera className="w-6 h-6 text-slate-500" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-slate-400">Optical Sensor Feed Standby</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">Awaiting ESP32-CAM / OV2640 hardware video stream</p>
                        </div>
                        <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-slate-500">
                          NO ACTIVE HARDWARE FEED
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Dynamic Network Station & Auto-Discovery Bar */}
                  <div className="mt-3 p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Wifi className={`w-3.5 h-3.5 ${cameraStatus.hardware_online ? 'text-emerald-400' : 'text-slate-400'}`} />
                        <span className="font-semibold text-slate-300">Device Link:</span>
                        <span className="font-mono text-[11px] text-slate-300">{cameraStatus.camera_url || 'http://synterra-cam.local'}</span>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                        cameraStatus.hardware_online
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}>
                        {cameraStatus.hardware_online ? 'ESP32-S3 LIVE' : 'FEED STANDBY'}
                      </span>
                    </div>

                    {/* Quick Network Help & Host IP info */}
                    {cameraStatus.host_network?.ips && (
                      <div className="text-[10px] text-slate-400 flex flex-wrap gap-1.5 items-center">
                        <span className="text-slate-500">Host IP:</span>
                        {cameraStatus.host_network.ips.map((ip) => (
                          <span key={ip} className="px-1.5 py-0.5 rounded bg-slate-800/90 font-mono text-emerald-400 border border-slate-700">
                            {ip} {ip.startsWith('192.168.137') ? '(Hotspot jj)' : ''}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Auto-Discover and Manual Override Row */}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={handleAutoDiscoverCamera}
                        disabled={isDiscovering}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-[11px] font-medium transition disabled:opacity-50 shrink-0"
                      >
                        <Search className={`w-3 h-3 ${isDiscovering ? 'animate-spin' : ''}`} />
                        <span>{isDiscovering ? 'Scanning Subnet...' : 'Auto-Discover'}</span>
                      </button>

                      <div className="flex-1 flex items-center gap-1">
                        <input
                          type="text"
                          placeholder="http://192.168.137.X"
                          value={customCamUrl}
                          onChange={(e) => setCustomCamUrl(e.target.value)}
                          className="flex-1 bg-black/40 border border-slate-700 rounded-lg px-2.5 py-1 text-slate-200 text-[11px] font-mono focus:outline-none focus:border-emerald-500"
                        />
                        <button
                          onClick={handleConfigureCamera}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium transition border border-slate-700 shrink-0"
                        >
                          Bind
                        </button>
                      </div>
                    </div>

                    {discoveryMsg && (
                      <p className="text-[10px] text-teal-400 font-mono animate-fadeIn">{discoveryMsg}</p>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-slate-800 flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-400">Capture current frame and pass directly to Kindwise AI pathology.</p>
                  <button
                    onClick={handleCameraCapture}
                    disabled={isDiagnosing}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-black font-bold text-xs shadow-lg shadow-emerald-950 transition active:scale-95 disabled:opacity-50 shrink-0"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>{isDiagnosing ? 'Analyzing Specimen...' : 'Snap & Diagnose'}</span>
                  </button>
                </div>
              </div>

              {/* Right Column: Drag & Drop Leaf Upload Studio */}
              <div className="bg-[#0d1422] border border-slate-800 rounded-2xl p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <UploadCloud className="w-4 h-4 text-cyan-400" />
                      <h3 className="font-bold text-white text-sm">Specimen Image Diagnostics</h3>
                    </div>
                    <span className="text-[10px] text-slate-400">PNG / JPEG</span>
                  </div>

                  {/* Drag & Drop Zone */}
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-700 hover:border-emerald-500/60 rounded-xl p-6 text-center cursor-pointer bg-slate-900/50 hover:bg-slate-900/80 transition flex flex-col items-center justify-center min-h-[200px]"
                  >
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      accept="image/*"
                      className="hidden"
                    />

                    {uploadedImagePreview ? (
                      <div className="space-y-2">
                        <img src={uploadedImagePreview} alt="Uploaded Specimen" className="max-h-36 mx-auto rounded-lg shadow-md border border-slate-700" />
                        <p className="text-xs text-emerald-400 font-semibold">Click to choose another photo</p>
                      </div>
                    ) : (
                      <>
                        <UploadCloud className="w-10 h-10 text-slate-500 mb-2 group-hover:text-emerald-400 transition" />
                        <p className="text-sm font-semibold text-slate-200">Click to upload or drag leaf photograph</p>
                        <p className="text-xs text-slate-500 mt-1">Direct integration with Kindwise Crop.health API</p>
                      </>
                    )}
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Plant species (optional, e.g. Tomato)"
                      value={plantNameInput}
                      onChange={(e) => setPlantNameInput(e.target.value)}
                      className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-slate-800 text-xs text-slate-400 flex items-center justify-between">
                  <span>Fast response: ~1.5 seconds turnaround</span>
                  <span className="text-cyan-400 font-semibold">{apiStatus.remainingCredits || 57} Credits Remaining</span>
                </div>
              </div>
            </div>

            {/* Live Diagnosis Dossier View */}
            {latestDiagnosisResult && (
              <div className="bg-[#0d1422] border border-emerald-500/30 rounded-2xl p-6 shadow-xl shadow-emerald-950/20 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2 pb-4 border-b border-slate-800">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-white text-base">Pathology Diagnosis Dossier</h3>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/40 text-emerald-400 border border-emerald-800/30">
                          {latestDiagnosisResult.engine || 'Kindwise crop.health'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">Record #{latestDiagnosisResult.id || latestDiagnosisResult.diagnosis_id || 'LIVE'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <span className="text-2xl font-black text-emerald-400">
                        {latestDiagnosisResult.confidence_percentage ? `${latestDiagnosisResult.confidence_percentage}%` : latestDiagnosisResult.confidence ? `${latestDiagnosisResult.confidence.toFixed(1)}%` : '--'}
                      </span>
                      <span className="text-xs text-slate-400 font-medium block">Confidence</span>
                    </div>
                    {latestDiagnosisResult.id && (
                      <a
                        href={`/api/diagnosis/${latestDiagnosisResult.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md shadow-blue-950 transition active:scale-95"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Export PDF</span>
                      </a>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-slate-900/70 p-4 rounded-xl border border-slate-800">
                    <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">Identified Specimen</span>
                    <p className="text-lg font-bold text-white mt-1 capitalize">{latestDiagnosisResult.crop_identified || latestDiagnosisResult.plant_name || 'Specimen'}</p>
                  </div>
                  <div className="bg-slate-900/70 p-4 rounded-xl border border-slate-800">
                    <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">Pathology Condition</span>
                    <p className="text-lg font-bold text-rose-400 mt-1 capitalize">{latestDiagnosisResult.primary_diagnosis || latestDiagnosisResult.disease_name || 'Healthy'}</p>
                  </div>
                  <div className="bg-slate-900/70 p-4 rounded-xl border border-slate-800">
                    <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">Causal Pathogen / Urgency</span>
                    <p className="text-sm font-semibold text-amber-300 mt-1.5 italic">
                      {latestDiagnosisResult.scientific_pathogen || 'Non-Specific Pathogen'}
                      {latestDiagnosisResult.urgency_level && ` (${latestDiagnosisResult.urgency_level})`}
                    </p>
                  </div>
                </div>

                {/* Multimodal Observed Symptoms */}
                {latestDiagnosisResult.symptoms_observed && latestDiagnosisResult.symptoms_observed.length > 0 && (
                  <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-teal-400 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Key Visual Symptoms Observed:</span>
                    </span>
                    <ul className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-slate-300">
                      {latestDiagnosisResult.symptoms_observed.map((sym, i) => (
                        <li key={i} className="flex items-start gap-1.5 bg-slate-950/60 p-2 rounded-lg border border-slate-800">
                          <span className="text-emerald-400">•</span>
                          <span>{sym}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Multimodal Active Ingredients & Treatment Protocol */}
                {latestDiagnosisResult.treatment_protocol && (
                  <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-950/30 via-slate-900/80 to-slate-900/80 border border-emerald-800/40 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4" />
                        <span>Agronomic Treatment Protocol:</span>
                      </span>
                      {latestDiagnosisResult.active_ingredients_recommended && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] text-slate-400">Actives:</span>
                          {latestDiagnosisResult.active_ingredients_recommended.map((act, i) => (
                            <span key={i} className="px-2 py-0.5 rounded bg-emerald-900/50 text-emerald-300 border border-emerald-700/40 text-[10px] font-medium">
                              {act}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-slate-200 leading-relaxed bg-black/30 p-3 rounded-lg border border-slate-800">
                      {latestDiagnosisResult.treatment_protocol}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ==================================================================== */}
        {/* TAB 3: AUTONOMOUS IRRIGATION CONTROLLER */}
        {/* ==================================================================== */}
        {activeTab === 'irrigation' && (
          <div className="space-y-6 animate-fadeIn">
            {/* Watchdog Status Card */}
            <div className="bg-[#0d1422] border border-slate-800 rounded-2xl p-6">
              <div className="flex items-center justify-between flex-wrap gap-4 pb-6 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-blue-950/40 text-blue-400 border border-blue-900/40">
                    <Droplets className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Precision Drip Irrigation Watchdog</h3>
                    <p className="text-xs text-slate-400">Thermal protection interlock, max 30s cycle runtime, dry-run safety</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider ${
                    irrigationStatus.state === 'PUMPING'
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40 animate-pulse'
                      : irrigationStatus.state === 'COOLDOWN'
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                      : irrigationStatus.state === 'EMERGENCY_STOPPED'
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                      : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  }`}>
                    STATE: {irrigationStatus.state}
                  </span>

                  {irrigationStatus.state === 'EMERGENCY_STOPPED' ? (
                    <button
                      onClick={resetEmergencyStop}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-black font-bold text-xs transition"
                    >
                      Clear Emergency Stop
                    </button>
                  ) : (
                    <button
                      onClick={emergencyStop}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-lg shadow-rose-950 transition active:scale-95"
                    >
                      <Square className="w-3.5 h-3.5 fill-white" />
                      <span>EMERGENCY STOP</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Live Pump Status Details */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                <div className="bg-slate-900/70 p-4 rounded-xl border border-slate-800">
                  <span className="text-xs text-slate-400 uppercase font-semibold">Pump Relay State</span>
                  <div className="mt-2 flex items-center gap-2">
                    <span className={`w-3 h-3 rounded-full ${irrigationStatus.is_pumping ? 'bg-blue-400 animate-ping' : 'bg-slate-600'}`} />
                    <span className="text-base font-bold text-white">{irrigationStatus.is_pumping ? 'PUMP ACTIVE' : 'DISENGAGED'}</span>
                  </div>
                  {irrigationStatus.remaining_pump_sec > 0 && (
                    <p className="text-xs text-blue-400 mt-1">Remaining cycle: {irrigationStatus.remaining_pump_sec}s</p>
                  )}
                </div>

                <div className="bg-slate-900/70 p-4 rounded-xl border border-slate-800">
                  <span className="text-xs text-slate-400 uppercase font-semibold">Thermal Cooldown</span>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-base font-bold text-white">
                      {irrigationStatus.remaining_cooldown_sec > 0 ? `${irrigationStatus.remaining_cooldown_sec}s remaining` : 'CLEAR (0s)'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">Prevents solenoid / motor overheating.</p>
                </div>

                <div className="bg-slate-900/70 p-4 rounded-xl border border-slate-800">
                  <span className="text-xs text-slate-400 uppercase font-semibold">Reservoir Interlock</span>
                  <div className="mt-2 flex items-center gap-2">
                    <span className={`text-base font-bold ${irrigationStatus.reservoir_ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {irrigationStatus.reservoir_ok ? 'SUPPLY VERIFIED' : 'EMPTY / LOCKED'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">Dry-run float switch interlock.</p>
                </div>
              </div>

              {/* Manual Trigger Buttons */}
              <div className="mt-8">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Execute Manual Drip Cycle</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[5, 10, 20, 30].map((sec) => (
                    <button
                      key={sec}
                      onClick={() => triggerIrrigation(sec)}
                      disabled={irrigationStatus.is_pumping || irrigationStatus.remaining_cooldown_sec > 0 || !irrigationStatus.reservoir_ok}
                      className="py-3 px-4 rounded-xl bg-slate-900 hover:bg-blue-600/20 border border-slate-700 hover:border-blue-500/50 text-white font-bold text-xs transition active:scale-95 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2"
                    >
                      <Play className="w-3.5 h-3.5 text-blue-400" />
                      <span>Water {sec}s</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Autonomous Soil Threshold Mode */}
              <div className="mt-8 pt-6 border-t border-slate-800 flex items-center justify-between flex-wrap gap-4">
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-emerald-400" />
                    <span>Autonomous Moisture Rule Engine</span>
                  </h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Automatically triggers a 12s drip pulse whenever FC-28 substrate moisture drops below {irrigationStatus.soil_threshold_pct}%.
                  </p>
                </div>

                <button
                  onClick={toggleAutoIrrigation}
                  className={`px-4 py-2 rounded-xl text-xs font-bold border transition ${
                    irrigationStatus.auto_mode_enabled
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                >
                  {irrigationStatus.auto_mode_enabled ? 'AUTONOMOUS ACTIVE' : 'MANUAL ONLY'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* TAB 4: DOSSIERS & COMPLETE TELEMETRY LOGS */}
        {/* ==================================================================== */}
        {activeTab === 'dossiers' && (
          <div className="space-y-6 animate-fadeIn">
            {/* Telegram Remote Farm Manager & Alert Bot Console */}
            <div className="bg-[#0d1422] border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl">
              <div className="flex items-center justify-between flex-wrap gap-4 pb-4 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-cyan-950/60 text-cyan-400 border border-cyan-800/40">
                    <Bell className="w-5 h-5 text-cyan-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-white">Telegram Remote Farm Manager &amp; Alert Bot</h3>
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase font-bold ${
                        telegramStatus?.configured
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}>
                        {telegramStatus?.mode || 'SIMULATED STANDBY'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Direct automated push alerts for critical soil drought, empty reservoir interlocks, and 2-way remote commands.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSendTelegramTest}
                    disabled={isSendingTg}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-black font-bold text-xs shadow-md transition disabled:opacity-50"
                  >
                    <Send className={`w-3.5 h-3.5 ${isSendingTg ? 'animate-bounce' : ''}`} />
                    <span>{isSendingTg ? 'Transmitting...' : 'Send Test Alert Pulse'}</span>
                  </button>
                </div>
              </div>

              {/* 2-Way Command Terminal Row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 space-y-2.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                    <span>2-Way Remote Command Terminal</span>
                  </span>
                  <p className="text-[11px] text-slate-400">
                    Execute field commands remotely (supported: <code>/status</code>, <code>/water 12</code>, <code>/stop</code>, <code>/help</code>):
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      value={telegramCmdInput}
                      onChange={(e) => setTelegramCmdInput(e.target.value)}
                      placeholder="/status"
                      className="flex-1 bg-black/50 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
                    />
                    <button
                      onClick={handleRunTelegramCommand}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 font-bold text-xs border border-slate-700 transition"
                    >
                      Execute
                    </button>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-black/60 border border-slate-800/90 font-mono text-[11px] space-y-1.5 flex flex-col justify-between">
                  <div>
                    <span className="text-slate-500 uppercase text-[10px] tracking-wider block mb-1">Bot Terminal Transmission Log:</span>
                    <div
                      className="text-slate-200 whitespace-pre-wrap leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: telegramSimOutput || 'Awaiting command execution or alert event...' }}
                    />
                  </div>
                  <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-800 flex items-center justify-between">
                    <span>Target: {telegramStatus?.chat_id || 'Standby Simulation Channel'}</span>
                    <span className="text-cyan-400">Telegram Bot API v7.0</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-[#0d1422] border border-slate-800 rounded-2xl p-6">
              <div className="flex items-center justify-between flex-wrap gap-4 pb-6 border-b border-slate-800">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <FileText className="w-4 h-4 text-emerald-400" />
                    <span>Historical Pathology Dossiers</span>
                  </h3>
                  <p className="text-xs text-slate-400">All machine learning disease identifications recorded in SQLite.</p>
                </div>

                <a
                  href="/api/sensors/export/csv"
                  download="synterra_telemetry_export.csv"
                  className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold transition"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Download Telemetry CSV</span>
                </a>
              </div>

              {/* Table */}
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 uppercase font-semibold">
                      <th className="py-3 px-3">ID</th>
                      <th className="py-3 px-3">Specimen</th>
                      <th className="py-3 px-3">Pathology / Condition</th>
                      <th className="py-3 px-3">Confidence</th>
                      <th className="py-3 px-3">Date</th>
                      <th className="py-3 px-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {diagnoses.length > 0 ? (
                      diagnoses.map((d) => (
                        <tr key={d.id} className="hover:bg-slate-900/60 transition">
                          <td className="py-3 px-3 font-mono text-slate-400">#{d.id}</td>
                          <td className="py-3 px-3 font-bold text-white capitalize">{d.plant_name}</td>
                          <td className="py-3 px-3 capitalize text-rose-300">{d.disease_name || 'Healthy / No Disease'}</td>
                          <td className="py-3 px-3">
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-950/40 text-emerald-400 border border-emerald-500/20">
                              {d.confidence ? `${d.confidence.toFixed(1)}%` : 'Analyzed'}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-slate-400">
                            {d.created_at ? new Date(d.created_at).toLocaleString() : 'N/A'}
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-2">
                              <a
                                href={`/diagnosis/${d.id}`}
                                className="text-emerald-400 hover:underline flex items-center gap-1"
                              >
                                <span>HTML</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                              <a
                                href={`/api/diagnosis/${d.id}/pdf`}
                                target="_blank"
                                rel="noreferrer"
                                className="px-2 py-0.5 rounded bg-blue-950/40 text-blue-400 border border-blue-800/40 hover:bg-blue-900/50 flex items-center gap-1"
                                title="Download Official PDF Dossier"
                              >
                                <span>PDF</span>
                                <Download className="w-3 h-3" />
                              </a>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="6" className="py-8 text-center text-slate-500">
                          No pathology records stored yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

      </main>

      {/* Global Precision Footer */}
      <footer className="border-t border-slate-800/80 bg-[#080d16] py-3.5 px-6 text-center text-xs text-slate-500 flex flex-wrap items-center justify-between gap-4">
        <span>SYNTERRA &mdash; Engineering Intelligence for a Growing World.</span>
        <span>Kindwise crop.health v1 API &bull; ESP32-S3 Firmware &bull; SQLite Architecture</span>
      </footer>

      {/* AI Senior Agronomist Botanical Copilot */}
      <ChatbotWidget
        latestTelemetry={latestTelemetry}
        weatherData={weatherData}
        latestDiagnosis={diagnoses && diagnoses.length > 0 ? diagnoses[0] : null}
      />
    </div>
  );
}
