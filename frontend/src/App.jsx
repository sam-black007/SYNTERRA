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
  Wind
} from 'lucide-react';
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

    fetchInitialData();

    // Fallback heartbeat polling every 5s in case of connection drop
    const heartbeat = setInterval(() => {
      fetch('/api/sensors/latest')
        .then((r) => r.json())
        .then((data) => {
          if (data.reading && (!latestTelemetry || data.reading.id !== latestTelemetry.id)) {
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
    }, 5000);

    return () => {
      clearInterval(heartbeat);
      socket.disconnect();
    };
  }, []);

  const fetchInitialData = async () => {
    try {
      const [telemRes, histRes, diagRes, integRes, irrigRes] = await Promise.all([
        fetch('/api/sensors/latest'),
        fetch('/api/sensors/history?limit=30'),
        fetch('/api/diagnoses'),
        fetch('/api/integrations/plantid/test', { method: 'POST' }),
        fetch('/api/irrigation/status')
      ]);

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
    } catch (err) {
      console.warn('Initial data load warning:', err);
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
      const res = await fetch('/api/camera/capture', { method: 'POST' });
      const data = await res.json();
      if (data.diagnosis) {
        setLatestDiagnosisResult(data.diagnosis);
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
      formData.append('plant_name', plantNameInput || 'Specimen Upload');

      const res = await fetch('/api/diagnose', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.diagnosis) {
        setLatestDiagnosisResult(data.diagnosis);
        // Refresh credits
        fetchInitialData();
      } else {
        alert('Diagnosis failed: ' + (data.message || 'Unknown error'));
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
                  <span>Target: 20–28°C</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/40 text-emerald-400 border border-emerald-500/20">
                    Comfort Zone
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
                  <span>Target: 50–70%</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-950/40 text-cyan-400 border border-cyan-500/20">
                    Transpiration OK
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
                  <span>ADC: {latestTelemetry?.soil_raw_adc || '--'}</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/40 text-emerald-400 border border-emerald-500/20">
                    FC-28 Active
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
                  <span>BH1750 Sensor</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950/40 text-amber-400 border border-amber-500/20">
                    Active Daylight
                  </span>
                </div>
              </div>
            </div>

            {/* Agronomic VPD & Interlock Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Vapor Pressure Deficit (VPD) Agronomic Card */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-900 to-[#0e1628] border border-slate-800 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-indigo-950/50 text-indigo-400 border border-indigo-900/40">
                    <Gauge className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Vapor Pressure Deficit (VPD)</span>
                      <span className="text-lg font-black text-white">{currentVPD !== null ? `${currentVPD} kPa` : '--'}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">Calculated from canopy psychrometric temperature & relative humidity.</p>
                  </div>
                </div>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-lg ${vpdInfo.bg} ${vpdInfo.color} border border-slate-700/60`}>
                  {vpdInfo.label}
                </span>
              </div>

              {/* Water Reservoir Interlock State */}
              <div className={`p-4 rounded-2xl border flex items-center justify-between gap-4 ${
                latestTelemetry?.water_reservoir_ok !== false
                  ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-950/30 border-rose-500/50 text-rose-300'
              }`}>
                <div className="flex items-center gap-3">
                  {latestTelemetry?.water_reservoir_ok !== false ? (
                    <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                  )}
                  <div>
                    <p className="font-bold text-xs uppercase tracking-wider">
                      {latestTelemetry?.water_reservoir_ok !== false ? 'Irrigation Reservoir: SAFE & ARMED' : 'RESERVOIR EMPTY: PUMP INTERLOCK ENGAGED'}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {latestTelemetry?.water_reservoir_ok !== false
                        ? 'Hardware float switch indicates adequate liquid supply.'
                        : 'Pump relay disengaged to prevent dry-run overheating.'}
                    </p>
                  </div>
                </div>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-lg uppercase ${
                  latestTelemetry?.water_reservoir_ok !== false
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                }`}>
                  {latestTelemetry?.water_reservoir_ok !== false ? 'ARMED' : 'INTERLOCKED'}
                </span>
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
                        idx === 0 ? 'bg-slate-900/90 border-slate-700/80 shadow-md ring-1 ring-emerald-500/20' : 'bg-slate-900/40 border-slate-800/80'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs text-white">
                            {idx === 0 ? 'Today' : day.day_name}
                          </span>
                          <span className="text-[10px] font-mono text-slate-500">{day.date_display}</span>
                        </div>

                        <div className="my-2.5 flex items-center gap-2">
                          {renderWeatherIcon(day.category)}
                          <div className="truncate">
                            <p className="text-xs font-semibold text-slate-200 truncate">{day.condition}</p>
                            <p className="text-[10px] text-slate-400">{day.temp_min}°C – {day.temp_max}°C</p>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-1.5 pt-2 border-t border-slate-800/80 text-[10px]">
                        <div className="flex items-center justify-between text-slate-400">
                          <span className="flex items-center gap-1">
                            <Droplets className="w-3 h-3 text-cyan-400" />
                            <span>Rain:</span>
                          </span>
                          <span className="font-mono font-bold text-slate-200">{day.precip_prob}%</span>
                        </div>

                        <div className="flex items-center justify-between text-slate-400">
                          <span>Humidity:</span>
                          <span className="font-mono text-slate-300">{day.humidity_pct}%</span>
                        </div>

                        <div className={`mt-1 text-[9px] font-bold px-1.5 py-0.5 rounded text-center border ${
                          day.risk_level === 'HIGH'
                            ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                            : day.risk_level === 'MODERATE'
                            ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                            : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                        }`}>
                          {day.risk_level} RISK
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

              {/* Agronomic Advisory Callout */}
              {weatherData && (
                <div className={`p-3.5 rounded-xl border text-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-3 ${
                  weatherData.overall_risk === 'HIGH'
                    ? 'bg-rose-950/20 border-rose-500/30 text-rose-200'
                    : weatherData.overall_risk === 'MODERATE'
                    ? 'bg-amber-950/20 border-amber-500/30 text-amber-200'
                    : 'bg-emerald-950/20 border-emerald-500/30 text-emerald-200'
                }`}>
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${
                      weatherData.overall_risk === 'HIGH' ? 'text-rose-400' : weatherData.overall_risk === 'MODERATE' ? 'text-amber-400' : 'text-emerald-400'
                    }`} />
                    <p className="leading-relaxed">
                      <span className="font-bold">Agro-Weather Advisory: </span>
                      {weatherData.overall_advisory}
                    </p>
                  </div>
                  <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-black/40 border border-slate-700 text-teal-300 shrink-0 font-mono">
                    {weatherData.irrigation_recommendation}
                  </span>
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
                  <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-black aspect-video flex items-center justify-center group">
                    <img
                      src="/api/camera/stream"
                      alt="Live Optical Feed"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = '/static/samples/tomato_blight.jpg';
                      }}
                    />
                    <div className="absolute top-3 left-3 bg-black/60 backdrop-blur px-2 py-1 rounded text-[10px] font-mono text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                      <span>LIVE FEED</span>
                    </div>
                  </div>

                  {/* Dynamic Network Station & Auto-Discovery Bar */}
                  <div className="mt-3 p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Wifi className={`w-3.5 h-3.5 ${cameraStatus.hardware_online ? 'text-emerald-400' : 'text-amber-400'}`} />
                        <span className="font-semibold text-slate-300">Device Link:</span>
                        <span className="font-mono text-[11px] text-slate-300">{cameraStatus.camera_url || 'http://synterra-cam.local'}</span>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                        cameraStatus.hardware_online
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                      }`}>
                        {cameraStatus.hardware_online ? 'ESP32-S3 LIVE' : 'SYNTHETIC HUD'}
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
              <div className="bg-[#0d1422] border border-emerald-500/30 rounded-2xl p-6 shadow-xl shadow-emerald-950/20">
                <div className="flex items-center justify-between flex-wrap gap-2 pb-4 border-b border-slate-800">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-base">Pathology Diagnosis Dossier</h3>
                      <p className="text-xs text-slate-400">Record #{latestDiagnosisResult.id} &bull; Processed via Kindwise crop.health model</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <span className="text-2xl font-black text-emerald-400">
                        {latestDiagnosisResult.confidence ? `${latestDiagnosisResult.confidence.toFixed(1)}%` : '--'}
                      </span>
                      <span className="text-xs text-slate-400 font-medium block">Confidence</span>
                    </div>
                    <a
                      href={`/api/diagnosis/${latestDiagnosisResult.id}/pdf`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md shadow-blue-950 transition active:scale-95"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export PDF</span>
                    </a>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
                  <div className="bg-slate-900/70 p-4 rounded-xl border border-slate-800">
                    <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">Identified Specimen</span>
                    <p className="text-lg font-bold text-white mt-1 capitalize">{latestDiagnosisResult.plant_name}</p>
                  </div>
                  <div className="bg-slate-900/70 p-4 rounded-xl border border-slate-800">
                    <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">Pathology Condition</span>
                    <p className="text-lg font-bold text-rose-400 mt-1 capitalize">{latestDiagnosisResult.disease_name || 'Healthy'}</p>
                  </div>
                  <div className="bg-slate-900/70 p-4 rounded-xl border border-slate-800">
                    <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">Timestamp</span>
                    <p className="text-sm font-semibold text-slate-300 mt-1.5">
                      {latestDiagnosisResult.created_at ? new Date(latestDiagnosisResult.created_at).toLocaleString() : 'Just now'}
                    </p>
                  </div>
                </div>
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
    </div>
  );
}
