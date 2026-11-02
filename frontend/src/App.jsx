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
  Radio
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

export default function App() {
  const [socketConnected, setSocketConnected] = useState(false);
  const [latestTelemetry, setLatestTelemetry] = useState(null);
  const [telemetryHistory, setTelemetryHistory] = useState([]);
  const [diagnoses, setDiagnoses] = useState([]);
  const [apiStatus, setApiStatus] = useState({ configured: false, remainingCredits: null });
  const [activeTab, setActiveTab] = useState('climate'); // 'climate' | 'root'
  const [lastPacketTime, setLastPacketTime] = useState(null);
  const [isInjecting, setIsInjecting] = useState(false);
  const socketRef = useRef(null);

  // Initialize Socket.io connection & initial data fetch
  useEffect(() => {
    // Determine backend host (works both with Vite dev proxy and direct Flask host)
    const socketUrl = window.location.origin;
    const socket = io(socketUrl, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
    });
    socketRef.current = socket;

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
        const updated = [...prev, point];
        return updated.slice(-30); // keep last 30 readings
      });
    });

    socket.on('diagnosis_update', (newDiag) => {
      setDiagnoses((prev) => [newDiag, ...prev.slice(0, 9)]);
    });

    // Initial HTTP data fetches
    fetchInitialData();

    return () => {
      socket.disconnect();
    };
  }, []);

  const fetchInitialData = async () => {
    try {
      // 1. Fetch latest telemetry
      const telemRes = await fetch('/api/sensors/latest');
      if (telemRes.ok) {
        const telemData = await telemRes.json();
        if (telemData.reading) {
          setLatestTelemetry(telemData.reading);
          setLastPacketTime(new Date(telemData.reading.timestamp));
        }
      }

      // 2. Fetch history
      const histRes = await fetch('/api/sensors/history?limit=30');
      if (histRes.ok) {
        const histData = await histRes.json();
        if (histData.readings) {
          const formatted = histData.readings.reverse().map((r) => ({
            time: new Date(r.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }),
            temp: r.temperature_c,
            hum: r.humidity_pct,
            soil: r.soil_moisture_pct,
            lux: r.light_lux,
          }));
          setTelemetryHistory(formatted);
        }
      }

      // 3. Fetch recent diagnoses
      const diagRes = await fetch('/api/diagnoses');
      if (diagRes.ok) {
        const diagData = await diagRes.json();
        setDiagnoses(diagData.slice(0, 10));
      }

      // 4. Fetch API key status & credits
      const statusRes = await fetch('/api/integrations/plantid/test', { method: 'POST' });
      if (statusRes.ok) {
        const sData = await statusRes.json();
        const rem = sData.usage?.remaining?.total;
        setApiStatus({ configured: true, remainingCredits: rem });
      } else {
        setApiStatus({ configured: false, remainingCredits: null });
      }
    } catch (err) {
      console.warn('Initial data load warning:', err);
    }
  };

  // Quick Action: Inject synthetic test pulse to test live gauges
  const handleInjectSimulatedTelemetry = async () => {
    setIsInjecting(true);
    try {
      const simTemp = +(22 + Math.random() * 6).toFixed(1);
      const simHum = +(55 + Math.random() * 15).toFixed(1);
      const simSoil = +(60 + Math.random() * 15).toFixed(1);
      const simLux = Math.round(400 + Math.random() * 300);

      const res = await fetch('/api/sensors/telemetry', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Token': 'plant-lab-auth-token-9981',
        },
        body: JSON.stringify({
          device_id: 'esp32-sim-ui',
          plant_id: 'specimen-interactive',
          temperature_c: simTemp,
          humidity_pct: simHum,
          soil_moisture_pct: simSoil,
          light_lux: simLux,
          soil_raw_adc: Math.round(3400 - (simSoil * 21)),
          water_reservoir_ok: true,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.reading) {
          setLatestTelemetry(json.reading);
          setLastPacketTime(new Date());
        }
      }
    } catch (err) {
      console.error('Failed to inject telemetry:', err);
    } finally {
      setIsInjecting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070b12] text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-black">
      {/* Top Laboratory Bar */}
      <header className="border-b border-slate-800 bg-[#0d131f]/90 backdrop-blur sticky top-0 z-30 px-4 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-950/40 border border-emerald-400/30">
            <Sprout className="w-5 h-5 text-black" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold tracking-wider text-white">SYNTERRA</span>
              <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Phase 4 Live
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">Agricultural Intelligence & Autonomous Pathology Monitoring</p>
          </div>
        </div>

        {/* Global Status Badges */}
        <div className="flex items-center gap-3 text-xs">
          {/* WebSocket Status */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${
            socketConnected
              ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
              : 'bg-amber-950/30 border-amber-500/40 text-amber-300'
          }`}>
            <span className={`w-2 h-2 rounded-full ${socketConnected ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'}`} />
            <Radio className="w-3.5 h-3.5" />
            <span className="font-medium">{socketConnected ? 'LIVE WEBSOCKET' : 'CONNECTING...'}</span>
          </div>

          {/* Cloud API Credits */}
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-300">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>Kindwise AI:</span>
            <span className="font-semibold text-white">
              {apiStatus.remainingCredits !== null ? `${apiStatus.remainingCredits} Credits` : 'Online'}
            </span>
          </div>

          {/* Fast Navigation to Flask views */}
          <div className="flex items-center gap-2">
            <a
              href="/pathology"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-black font-semibold text-xs shadow-md shadow-emerald-950 transition"
            >
              <span>Diagnose Leaf</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href="/"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs transition"
            >
              <span>Classic UI</span>
            </a>
          </div>
        </div>
      </header>

      {/* Main Content Dashboard */}
      <main className="flex-1 p-4 lg:p-8 max-w-7xl mx-auto w-full space-y-6">
        {/* Device & Specimen Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/60 border border-slate-800 p-4 rounded-2xl">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-slate-800 border border-slate-700 text-emerald-400">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-white">
                  Node: {latestTelemetry?.device_id || 'esp32-sensor-01'}
                </h2>
                <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  Target Specimen: {latestTelemetry?.plant_id || 'Specimen Alpha'}
                </span>
              </div>
              <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                <Clock className="w-3 h-3 text-slate-500" />
                <span>Last Telemetry Packet: {lastPacketTime ? lastPacketTime.toLocaleTimeString() : 'Awaiting data...'}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleInjectSimulatedTelemetry}
              disabled={isInjecting}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium transition active:scale-95 disabled:opacity-50"
            >
              <Send className={`w-3.5 h-3.5 text-emerald-400 ${isInjecting ? 'animate-bounce' : ''}`} />
              <span>{isInjecting ? 'Emitting...' : 'Emit Telemetry Pulse'}</span>
            </button>
            <button
              onClick={fetchInitialData}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition"
              title="Refresh Data"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Real-Time Metrics Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Temperature */}
          <div className="bg-[#0e1626] border border-slate-800/80 rounded-2xl p-5 relative overflow-hidden group hover:border-slate-700 transition">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-semibold uppercase tracking-wider">Air Temperature</span>
              <div className="p-2 rounded-xl bg-red-950/30 text-rose-400 border border-rose-900/40">
                <Thermometer className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold tracking-tight text-white">
                {latestTelemetry?.temperature_c !== undefined ? `${latestTelemetry.temperature_c}` : '--'}
              </span>
              <span className="text-base text-slate-400">°C</span>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800/60">
              <span>Target: 20–28°C</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950/40 text-emerald-400 border border-emerald-500/20">
                Optimal
              </span>
            </div>
          </div>

          {/* Humidity */}
          <div className="bg-[#0e1626] border border-slate-800/80 rounded-2xl p-5 relative overflow-hidden group hover:border-slate-700 transition">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-semibold uppercase tracking-wider">Relative Humidity</span>
              <div className="p-2 rounded-xl bg-cyan-950/30 text-cyan-400 border border-cyan-900/40">
                <Droplets className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold tracking-tight text-white">
                {latestTelemetry?.humidity_pct !== undefined ? `${latestTelemetry.humidity_pct}` : '--'}
              </span>
              <span className="text-base text-slate-400">%</span>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800/60">
              <span>Target: 50–70%</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-950/40 text-cyan-400 border border-cyan-500/20">
                VPD Balanced
              </span>
            </div>
          </div>

          {/* Soil Moisture */}
          <div className="bg-[#0e1626] border border-slate-800/80 rounded-2xl p-5 relative overflow-hidden group hover:border-slate-700 transition">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-semibold uppercase tracking-wider">Root-Zone Moisture</span>
              <div className="p-2 rounded-xl bg-emerald-950/30 text-emerald-400 border border-emerald-900/40">
                <Sprout className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold tracking-tight text-white">
                {latestTelemetry?.soil_moisture_pct !== undefined ? `${latestTelemetry.soil_moisture_pct}` : '--'}
              </span>
              <span className="text-base text-slate-400">%</span>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800/60">
              <span>ADC: {latestTelemetry?.soil_raw_adc || '--'}</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950/40 text-emerald-400 border border-emerald-500/20">
                FC-28 Calibrated
              </span>
            </div>
          </div>

          {/* Ambient Light (Lux) */}
          <div className="bg-[#0e1626] border border-slate-800/80 rounded-2xl p-5 relative overflow-hidden group hover:border-slate-700 transition">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-semibold uppercase tracking-wider">Ambient Light</span>
              <div className="p-2 rounded-xl bg-amber-950/30 text-amber-400 border border-amber-900/40">
                <Sun className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold tracking-tight text-white">
                {latestTelemetry?.light_lux !== undefined ? `${latestTelemetry.light_lux}` : '--'}
              </span>
              <span className="text-base text-slate-400">Lux</span>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800/60">
              <span>Sensor: BH1750</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-950/40 text-amber-400 border border-amber-500/20">
                Photoperiod Active
              </span>
            </div>
          </div>
        </div>

        {/* Reservoir Safety Banner */}
        <div className={`p-4 rounded-2xl border flex items-center justify-between gap-4 ${
          latestTelemetry?.water_reservoir_ok !== false
            ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
            : 'bg-rose-950/30 border-rose-500/50 text-rose-300'
        }`}>
          <div className="flex items-center gap-3">
            {latestTelemetry?.water_reservoir_ok !== false ? (
              <ShieldCheck className="w-6 h-6 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-6 h-6 text-rose-400 shrink-0" />
            )}
            <div>
              <p className="font-semibold text-sm">
                {latestTelemetry?.water_reservoir_ok !== false
                  ? 'Irrigation Reservoir Interlock: NORMAL'
                  : 'CRITICAL ALERT: WATER RESERVOIR LEVEL LOW'}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {latestTelemetry?.water_reservoir_ok !== false
                  ? 'Automated drip pump safety watchdog is clear to operate.'
                  : 'Pump interlock engaged. Refill reservoir before initiating irrigation.'}
              </p>
            </div>
          </div>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg uppercase ${
            latestTelemetry?.water_reservoir_ok !== false
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
          }`}>
            {latestTelemetry?.water_reservoir_ok !== false ? 'PUMP ARMED' : 'INTERLOCKED'}
          </span>
        </div>

        {/* Charts & Diagnoses Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Charts (2 cols on large screen) */}
          <div className="lg:col-span-2 bg-[#0e1626] border border-slate-800 rounded-2xl p-5 flex flex-col">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                <h3 className="font-semibold text-white text-sm">Live Environmental Dynamics</h3>
              </div>
              <div className="flex items-center bg-slate-900 border border-slate-800 p-1 rounded-xl text-xs">
                <button
                  onClick={() => setActiveTab('climate')}
                  className={`px-3 py-1 rounded-lg font-medium transition ${
                    activeTab === 'climate'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Temp & Humidity
                </button>
                <button
                  onClick={() => setActiveTab('root')}
                  className={`px-3 py-1 rounded-lg font-medium transition ${
                    activeTab === 'root'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Soil & Light
                </button>
              </div>
            </div>

            {/* Time Series Chart */}
            <div className="h-72 w-full pt-2">
              {telemetryHistory.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  {activeTab === 'climate' ? (
                    <LineChart data={telemetryHistory}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickMargin={8} />
                      <YAxis yAxisId="left" stroke="#f43f5e" fontSize={11} domain={['auto', 'auto']} unit="°C" />
                      <YAxis yAxisId="right" orientation="right" stroke="#06b6d4" fontSize={11} domain={[0, 100]} unit="%" />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.75rem', fontSize: '12px' }}
                      />
                      <Line yAxisId="left" type="monotone" dataKey="temp" stroke="#f43f5e" strokeWidth={2.5} dot={false} name="Temp (°C)" />
                      <Line yAxisId="right" type="monotone" dataKey="hum" stroke="#06b6d4" strokeWidth={2.5} dot={false} name="Humidity (%)" />
                    </LineChart>
                  ) : (
                    <AreaChart data={telemetryHistory}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickMargin={8} />
                      <YAxis yAxisId="left" stroke="#10b981" fontSize={11} domain={[0, 100]} unit="%" />
                      <YAxis yAxisId="right" orientation="right" stroke="#f59e0b" fontSize={11} domain={['auto', 'auto']} unit="lx" />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.75rem', fontSize: '12px' }}
                      />
                      <Area yAxisId="left" type="monotone" dataKey="soil" stroke="#10b981" fill="#10b981" fillOpacity={0.15} name="Soil Moisture (%)" />
                      <Line yAxisId="right" type="monotone" dataKey="lux" stroke="#f59e0b" strokeWidth={2} dot={false} name="Light (Lux)" />
                    </AreaChart>
                  )}
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs">
                  <Activity className="w-8 h-8 mb-2 animate-pulse text-slate-600" />
                  <span>Awaiting time-series points. Trigger an injection pulse or start serial bridge.</span>
                </div>
              )}
            </div>
          </div>

          {/* Recent Diagnoses Stream (1 col) */}
          <div className="bg-[#0e1626] border border-slate-800 rounded-2xl p-5 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <h3 className="font-semibold text-white text-sm">Recent Pathology Dossiers</h3>
              </div>
              <a href="/pathology" className="text-xs text-emerald-400 hover:underline">
                Upload Leaf
              </a>
            </div>

            <div className="space-y-2.5 overflow-y-auto max-h-72 pr-1">
              {diagnoses.length > 0 ? (
                diagnoses.map((diag) => (
                  <a
                    key={diag.id}
                    href={`/diagnosis/${diag.id}`}
                    className="block p-3 rounded-xl bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800/80 hover:border-slate-700 transition group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-white text-sm group-hover:text-emerald-400 transition">
                        {diag.plant_name}
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                        {diag.confidence ? `${diag.confidence.toFixed(1)}%` : 'Analyzed'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 mt-1 capitalize">
                      {diag.disease_name || 'Healthy / No Disease'}
                    </p>
                    <span className="text-[10px] text-slate-500 mt-1 block">
                      {diag.created_at ? new Date(diag.created_at).toLocaleString() : 'N/A'}
                    </span>
                  </a>
                ))
              ) : (
                <div className="h-48 flex flex-col items-center justify-center text-slate-500 text-xs">
                  <Sprout className="w-8 h-8 mb-2 text-slate-600" />
                  <span>No recent pathology records. Upload a leaf to test.</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-4 px-6 text-center text-xs text-slate-500">
        SYNTERRA &mdash; Engineering Intelligence for a Growing World. Powered by Kindwise & ESP32-S3.
      </footer>
    </div>
  );
}
