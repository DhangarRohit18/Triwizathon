import React, { useState } from 'react';
import { Warehouse, Destination } from '../types';
import { ShieldAlert, CheckCircle2, AlertOctagon, Navigation } from 'lucide-react';

interface NetworkMapProps {
  warehouses: Warehouse[];
  destinations: Destination[];
  activeAllocations?: Array<{
    source_warehouse_id: string;
    destination_id: string;
    allocated_quantity: number;
    product_sku: string;
  }>;
  onToggleDisruption?: (warehouseId: string) => void;
}

export const NetworkMap: React.FC<NetworkMapProps> = ({
  warehouses,
  destinations,
  activeAllocations = [],
  onToggleDisruption,
}) => {
  const [selectedWhId, setSelectedWhId] = useState<string | null>(null);

  // Map US normalized coordinate projection
  // Lat bounds ~ 24 to 50, Lng bounds ~ -125 to -66
  const project = (lat: number, lng: number) => {
    const minLat = 24.0, maxLat = 50.0;
    const minLng = -125.0, maxLng = -66.0;
    const x = ((lng - minLng) / (maxLng - minLng)) * 760 + 20;
    const y = ((maxLat - lat) / (maxLat - minLat)) * 400 + 40;
    return { x, y };
  };

  const selectedWh = warehouses.find(w => w.id === selectedWhId);

  return (
    <div className="relative rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-900 overflow-hidden shadow-inner">
      {/* Map Control Header */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-3 bg-slate-950/80 backdrop-blur-md px-3.5 py-2 rounded-xl border border-slate-800">
        <Navigation className="w-4 h-4 text-sky-400" />
        <div>
          <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
            Multi-Warehouse Distribution Network
          </h4>
          <p className="text-[10px] text-slate-400">
            {warehouses.length} Active Logistics Hubs ➔ {destinations.length} Regional Destination Centers
          </p>
        </div>
      </div>

      {/* SVG Canvas Map */}
      <svg className="w-full h-[460px] bg-slate-950" viewBox="0 0 800 460">
        <defs>
          <radialGradient id="gridGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#0284c7" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#0284c7" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="routeLine" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#14b8a6" stopOpacity="0.2" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Ambient background grid circle */}
        <circle cx="400" cy="230" r="300" fill="url(#gridGlow)" />

        {/* Dynamic Allocation Routing Lines */}
        {activeAllocations.map((alloc, idx) => {
          const srcWh = warehouses.find(w => w.id === alloc.source_warehouse_id);
          const dst = destinations.find(d => d.id === alloc.destination_id);
          if (!srcWh || !dst) return null;

          const p1 = project(srcWh.lat, srcWh.lng);
          const p2 = project(dst.lat, dst.lng);

          // Quadratic bezier curve midpoint
          const midX = (p1.x + p2.x) / 2;
          const midY = (p1.y + p2.y) / 2 - 25;

          return (
            <g key={`route-${idx}`}>
              <path
                d={`M ${p1.x} ${p1.y} Q ${midX} ${midY} ${p2.x} ${p2.y}`}
                fill="none"
                stroke="url(#routeLine)"
                strokeWidth="1.8"
                strokeDasharray="4 4"
                className="animate-pulse"
              />
              <circle cx={(p1.x + p2.x) / 2} cy={midY + 12} r="2" fill="#38bdf8" />
            </g>
          );
        })}

        {/* Static Network Link Matrix between Hubs & Key Destinations */}
        {warehouses.map((wh) => {
          const p1 = project(wh.lat, wh.lng);
          return destinations.slice(0, 4).map((dst, i) => {
            const p2 = project(dst.lat, dst.lng);
            return (
              <line
                key={`link-${wh.id}-${i}`}
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke="#1e293b"
                strokeWidth="0.8"
                strokeDasharray="2 2"
              />
            );
          });
        })}

        {/* Destinations (Hospitals / Clinical Distribution Centers) */}
        {destinations.map((dst) => {
          const { x, y } = project(dst.lat, dst.lng);
          return (
            <g key={dst.id} className="cursor-pointer group">
              <circle cx={x} cy={y} r="4" fill="#0f172a" stroke="#64748b" strokeWidth="1.5" />
              <circle cx={x} cy={y} r="2" fill="#94a3b8" />
              <text
                x={x}
                y={y + 13}
                textAnchor="middle"
                fontSize="9"
                fill="#94a3b8"
                fontWeight="600"
                className="select-none group-hover:fill-sky-400 transition-colors"
              >
                {dst.name.split(' ')[0]}
              </text>
            </g>
          );
        })}

        {/* Warehouses (Major Logistics Hubs) */}
        {warehouses.map((wh) => {
          const { x, y } = project(wh.lat, wh.lng);
          const isSelected = selectedWhId === wh.id;
          const isDown = !wh.is_operational;

          return (
            <g
              key={wh.id}
              onClick={() => setSelectedWhId(wh.id === selectedWhId ? null : wh.id)}
              className="cursor-pointer"
            >
              {/* Outer Pulse ring if disrupted or active */}
              {isDown ? (
                <circle cx={x} cy={y} r="18" fill="none" stroke="#ef4444" strokeWidth="1.5" className="animate-ping opacity-75" />
              ) : (
                <circle cx={x} cy={y} r={isSelected ? 16 : 12} fill="none" stroke="#0ea5e9" strokeWidth="1" opacity="0.4" />
              )}

              {/* Main Hub Node */}
              <circle
                cx={x}
                cy={y}
                r="9"
                fill={isDown ? "#7f1d1d" : "#0369a1"}
                stroke={isDown ? "#ef4444" : "#38bdf8"}
                strokeWidth="2.5"
                filter="url(#glow)"
              />
              <circle cx={x} cy={y} r="3.5" fill="#ffffff" />

              {/* Warehouse Code & Name */}
              <text
                x={x}
                y={y - 14}
                textAnchor="middle"
                fontSize="11"
                fill={isDown ? "#f87171" : "#e2e8f0"}
                fontWeight="bold"
                className="select-none"
              >
                {wh.code}
              </text>
              <text
                x={x}
                y={y + 22}
                textAnchor="middle"
                fontSize="10"
                fill="#64748b"
                fontWeight="500"
                className="select-none"
              >
                {wh.city}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Selected Warehouse Inspection Card */}
      {selectedWh && (
        <div className="absolute bottom-4 left-4 right-4 z-20 bg-slate-950/95 border border-slate-800 rounded-xl p-4 shadow-2xl backdrop-blur-md flex flex-col md:flex-row md:items-center justify-between gap-4 animate-in fade-in slide-in-from-bottom-2">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${selectedWh.is_operational ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
              {selectedWh.is_operational ? <CheckCircle2 className="w-5 h-5" /> : <AlertOctagon className="w-5 h-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-white">{selectedWh.name}</h4>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${selectedWh.is_operational ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                  {selectedWh.is_operational ? 'OPERATIONAL' : 'DISRUPTED / DOWN'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {selectedWh.address}, {selectedWh.city}, {selectedWh.state} • Lat: {selectedWh.lat.toFixed(2)}, Lng: {selectedWh.lng.toFixed(2)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-6 text-xs">
            <div>
              <span className="text-slate-500 uppercase tracking-wider block text-[10px]">Pallet Capacity</span>
              <span className="font-bold text-white font-mono-num">{selectedWh.used_pallets.toLocaleString()} / {selectedWh.capacity_pallets.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-slate-500 uppercase tracking-wider block text-[10px]">Cold Storage</span>
              <span className="font-bold text-sky-400 font-mono-num">{selectedWh.cold_storage_capacity.toLocaleString()} pallets</span>
            </div>
            {onToggleDisruption && (
              <button
                onClick={() => onToggleDisruption(selectedWh.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                  selectedWh.is_operational
                    ? 'bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30'
                    : 'bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30'
                }`}
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                {selectedWh.is_operational ? 'Simulate Disruption' : 'Restore Operations'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
