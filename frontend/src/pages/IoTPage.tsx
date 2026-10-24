import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useAppStore } from '../store/useAppStore';
import { IoTDevice, SensorReading, IoTAlert } from '../types';
import { KPICard } from '../components/KPICard';
import { 
  ThermometerSnowflake, 
  Droplets, 
  BatteryMedium, 
  Wifi, 
  AlertTriangle, 
  ShieldCheck, 
  Activity, 
  CheckCircle2, 
  Radio, 
  Send,
  DoorOpen,
  DoorClosed,
  RefreshCw
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Legend 
} from 'recharts';

export const IoTPage: React.FC = () => {
  const { addToast } = useAppStore();
  const [devices, setDevices] = useState<IoTDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('ESP32-COLD-CHI-01');
  const [readings, setReadings] = useState<SensorReading[]>([]);
  const [alerts, setAlerts] = useState<IoTAlert[]>([]);
  const [loading, setLoading] = useState(false);

  // Simulator injection states
  const [simTemp, setSimTemp] = useState(4.2);
  const [simHumidity, setSimHumidity] = useState(50.0);
  const [simDoorOpen, setSimDoorOpen] = useState(false);
  const [simulating, setSimulating] = useState(false);

  useEffect(() => {
    loadData();
  }, [selectedDeviceId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [devData, readData, altData] = await Promise.all([
        api.iot.getDevices(),
        api.iot.getReadings(selectedDeviceId),
        api.iot.getAlerts(),
      ]);
      setDevices(devData);
      setReadings(readData);
      setAlerts(altData);
      
      const currDev = devData.find(d => d.device_id === selectedDeviceId);
      if (currDev) {
        setSimTemp(currDev.current_temp);
        setSimHumidity(currDev.current_humidity);
      }
    } catch (err: any) {
      addToast({ type: 'error', title: 'IoT sync error', message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleAcknowledgeAlert = async (alertId: string) => {
    try {
      await api.iot.acknowledgeAlert(alertId);
      addToast({ type: 'success', title: 'Alert Acknowledged', message: 'Logged in compliance history.' });
      loadData();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Acknowledgment failed', message: err.message });
    }
  };

  const handleInjectTelemetry = async () => {
    setSimulating(true);
    try {
      const res = await api.iot.injectSimulator({
        device_id: selectedDeviceId,
        temperature_c: simTemp,
        humidity_percent: simHumidity,
        door_open: simDoorOpen,
        battery_level_percent: 96.5,
      });

      if (res.alerts_triggered && res.alerts_triggered.length > 0) {
        addToast({
          type: 'warning',
          title: 'Cold-Chain Breach Triggered!',
          message: `${res.alerts_triggered[0].message}`
        });
      } else {
        addToast({
          type: 'success',
          title: 'Telemetry Ingested',
          message: `Storage conditions nominal at ${simTemp}°C.`
        });
      }
      loadData();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Injection error', message: err.message });
    } finally {
      setSimulating(false);
    }
  };

  const activeDevice = devices.find(d => d.device_id === selectedDeviceId);
  const chartData = readings.map(r => ({
    time: r.timestamp.substring(11, 16),
    'Temperature (°C)': r.temperature_c,
    'Humidity (%)': r.humidity_percent,
  }));

  const unackAlerts = alerts.filter(a => !a.acknowledged);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-slate-900 border border-slate-800 text-white">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-cyan-400">
              Cold-Chain Environmental Control
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono font-bold">
              Authenticated ESP32 Sensors
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight mt-1">
            IoT Warehouse Storage Telemetry & Anomaly Detection
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Monitors real-time ultra-low vaccine cold rooms, insulin vaults, and ambient pharmaceutical aisles. Ingests authenticated sensor readings and flags temperature excursions automatically.
          </p>
        </div>

        {/* Device Switcher */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs">
            <Radio className="w-4 h-4 text-cyan-400 animate-pulse" />
            <select
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
              className="bg-transparent border-none text-white focus:outline-none font-medium cursor-pointer"
            >
              {devices.map(d => (
                <option key={d.device_id} value={d.device_id} className="bg-slate-900 text-white">
                  {d.device_name} ({d.storage_zone.split('(')[0]})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={loadData}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Gauges & Status Cards for Active Device */}
      {activeDevice && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            title="Storage Temperature"
            value={`${activeDevice.current_temp.toFixed(1)}°C`}
            subtitle={`Safe Limit: ${activeDevice.temp_min_threshold}°C to ${activeDevice.temp_max_threshold}°C`}
            change={
              activeDevice.current_temp >= activeDevice.temp_min_threshold && activeDevice.current_temp <= activeDevice.temp_max_threshold
                ? "In Spec"
                : "Excursion"
            }
            isPositive={activeDevice.current_temp >= activeDevice.temp_min_threshold && activeDevice.current_temp <= activeDevice.temp_max_threshold}
            icon={ThermometerSnowflake}
            badge="Live Gauge"
          />
          <KPICard
            title="Storage Humidity"
            value={`${activeDevice.current_humidity.toFixed(1)}%`}
            subtitle={`Threshold: < ${activeDevice.humidity_max_threshold}%`}
            isPositive={activeDevice.current_humidity <= activeDevice.humidity_max_threshold}
            icon={Droplets}
          />
          <KPICard
            title="Sensor Connectivity"
            value={activeDevice.is_online ? "ONLINE" : "OFFLINE"}
            subtitle={`MAC: ${activeDevice.mac_address}`}
            isPositive={activeDevice.is_online}
            icon={Wifi}
            badge={activeDevice.firmware_version}
          />
          <KPICard
            title="Excursion Incidents"
            value={unackAlerts.length}
            subtitle={`${alerts.length} total event logs`}
            change={unackAlerts.length > 0 ? "Requires Review" : "Nominal"}
            isPositive={unackAlerts.length === 0}
            icon={AlertTriangle}
          />
        </div>
      )}

      {/* Main Historical Chart & Interactive Hardware Simulator */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 24-Hour Telemetry Line Chart */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">
                24-Hour Thermal Continuity Chart ({activeDevice?.storage_zone})
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Hourly temperature trajectory showing automated cold-chain regulation compliance.
              </p>
            </div>
            <span className="text-[10px] font-mono font-bold text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded">
              24 Intervals
            </span>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} />
                <YAxis stroke="#94a3b8" fontSize={10} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#090d16',
                    borderColor: '#1e293b',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#f8fafc',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                <Line
                  type="monotone"
                  dataKey="Temperature (°C)"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                />
                <Line
                  type="monotone"
                  dataKey="Humidity (%)"
                  stroke="#14b8a6"
                  strokeWidth={1.5}
                  strokeDasharray="2 2"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Interactive Hardware Simulator Tool */}
        <div className="lg:col-span-1 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">
              ESP32 Telemetry Injector
            </h3>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Simulate live physical sensor fluctuations, temperature spikes, or storage door breaches to test automated alerts.
          </p>

          <div className="space-y-3.5 text-xs">
            {/* Temp Slider */}
            <div>
              <div className="flex justify-between items-center mb-1.5 font-bold">
                <span className="text-slate-700 dark:text-slate-300">Simulate Temp (°C)</span>
                <span className={`font-mono text-sm ${simTemp > (activeDevice?.temp_max_threshold || 8) ? 'text-rose-400 font-black' : 'text-cyan-400'}`}>
                  {simTemp.toFixed(1)}°C
                </span>
              </div>
              <input
                type="range"
                min="-30"
                max="35"
                step="0.5"
                value={simTemp}
                onChange={(e) => setSimTemp(parseFloat(e.target.value))}
                className="w-full accent-cyan-500 cursor-pointer"
              />
              <div className="flex justify-between text-[9px] text-slate-500 mt-0.5">
                <span>-30°C (Cryo)</span>
                <span>Safe: 2°C - 8°C</span>
                <span>+35°C (Spike)</span>
              </div>
            </div>

            {/* Humidity Slider */}
            <div>
              <div className="flex justify-between items-center mb-1.5 font-bold">
                <span className="text-slate-700 dark:text-slate-300">Simulate Humidity (%)</span>
                <span className="font-mono text-teal-400">{simHumidity.toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="10"
                max="95"
                step="5"
                value={simHumidity}
                onChange={(e) => setSimHumidity(parseFloat(e.target.value))}
                className="w-full accent-teal-500 cursor-pointer"
              />
            </div>

            {/* Door Switch */}
            <div className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
              <div className="flex items-center gap-2 font-bold text-slate-700 dark:text-slate-300">
                {simDoorOpen ? <DoorOpen className="w-4 h-4 text-rose-400" /> : <DoorClosed className="w-4 h-4 text-emerald-400" />}
                <span>Cold Room Door State</span>
              </div>
              <button
                type="button"
                onClick={() => setSimDoorOpen(!simDoorOpen)}
                className={`text-[10px] font-bold px-2 py-1 rounded transition-colors ${
                  simDoorOpen ? 'bg-rose-500/20 text-rose-400' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {simDoorOpen ? 'DOOR AJAR' : 'CLOSED'}
              </button>
            </div>

            <button
              onClick={handleInjectTelemetry}
              disabled={simulating}
              className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-md shadow-cyan-600/30 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              {simulating ? 'Transmitting...' : 'Inject Telemetry Reading'}
            </button>
          </div>
        </div>
      </div>

      {/* Active IoT Cold-Chain Alerts Table */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">
              Cold-Chain Excursion & Humidity Incident Alerts ({alerts.length})
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Excursions require mandatory manager sign-off and temperature remediation logs.
            </p>
          </div>
        </div>

        {alerts.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
            ✓ All cold-chain zones operating strictly within defined thresholds.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs table-dense">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 uppercase tracking-wider text-[11px]">
                  <th>Severity</th>
                  <th>Device / Sensor</th>
                  <th>Incident Message</th>
                  <th className="text-right">Reading</th>
                  <th className="text-right">Limit</th>
                  <th>Timestamp</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono-num">
                {alerts.map((alt) => (
                  <tr key={alt.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                    <td>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-sans uppercase ${
                        alt.severity === 'critical' ? 'bg-rose-500/20 text-rose-400' : 'bg-amber-500/20 text-amber-400'
                      }`}>
                        {alt.severity}
                      </span>
                    </td>
                    <td className="font-mono text-sky-400">{alt.device_id}</td>
                    <td className="font-sans font-medium text-slate-800 dark:text-slate-200 max-w-sm">
                      {alt.message}
                    </td>
                    <td className="text-right font-bold text-rose-400">
                      {alt.reading_value.toFixed(1)}
                    </td>
                    <td className="text-right text-slate-400">
                      {alt.threshold_value.toFixed(1)}
                    </td>
                    <td className="text-slate-500 text-[11px] font-mono">
                      {alt.timestamp.substring(11, 19)}
                    </td>
                    <td>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-sans ${
                        alt.acknowledged ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                      }`}>
                        {alt.acknowledged ? 'ACKNOWLEDGED' : 'ACTIVE EXCURSION'}
                      </span>
                    </td>
                    <td>
                      {!alt.acknowledged ? (
                        <button
                          onClick={() => handleAcknowledgeAlert(alt.id)}
                          className="px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-bold transition-colors font-sans"
                        >
                          Acknowledge
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-500 font-sans">
                          Signed off by {alt.acknowledged_by || 'Manager'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
