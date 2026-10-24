import React, { useState } from 'react';
import { Warehouse, Destination } from '../types';
import { ShieldAlert, Navigation, Layers } from 'lucide-react';
import { RetroBadge } from './ui/RetroBadge';

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
    <div className="relative rounded-2xl border border-[#17324D]/15 bg-white overflow-hidden shadow-xs">
      {/* Map Control Header */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-3 bg-white px-3.5 py-2 rounded-xl border border-[#17324D]/15 shadow-xs">
        <Navigation className="w-4 h-4 text-[#0D9488]" />
        <div>
          <h4 className="text-xs font-mono font-bold text-[#17324D] uppercase tracking-wider">
            Multi-Warehouse Distribution Network
          </h4>
          <p className="text-[10px] text-[#17324D]/60 font-mono">
            {warehouses.length} Active Logistics Hubs ➔ {destinations.length} Regional Destination Centers
          </p>
        </div>
      </div>

      {/* SVG Canvas Map strictly in White, Deep Navy, and Teal */}
      <svg className="w-full h-[460px] bg-white" viewBox="0 0 800 460">
        {/* Dynamic Allocation Routing Lines in Teal */}
        {activeAllocations.map((alloc, idx) => {
          const srcWh = warehouses.find(w => w.id === alloc.source_warehouse_id);
          const dst = destinations.find(d => d.id === alloc.destination_id);
          if (!srcWh || !dst) return null;

          const p1 = project(srcWh.lat, srcWh.lng);
          const p2 = project(dst.lat, dst.lng);

          const midX = (p1.x + p2.x) / 2;
          const midY = (p1.y + p2.y) / 2 - 25;

          return (
            <g key={`route-${idx}`}>
              <path
                d={`M ${p1.x} ${p1.y} Q ${midX} ${midY} ${p2.x} ${p2.y}`}
                fill="none"
                stroke="#0D9488"
                strokeWidth="1.8"
                strokeDasharray="4 4"
              />
              <circle cx={(p1.x + p2.x) / 2} cy={midY + 12} r="2.5" fill="#0D9488" />
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
                stroke="#17324D"
                strokeOpacity="0.1"
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
              <circle cx={x} cy={y} r="4" fill="#FFFFFF" stroke="#17324D" strokeWidth="1.5" />
              <circle cx={x} cy={y} r="2" fill="#0D9488" />
              <text
                x={x}
                y={y + 13}
                textAnchor="middle"
                fontSize="9"
                fill="#17324D"
                opacity="0.75"
                fontWeight="600"
                className="select-none font-mono"
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
              {/* Outer Pulse ring if selected or disrupted */}
              {isDown ? (
                <circle cx={x} cy={y} r="18" fill="none" stroke="#17324D" strokeWidth="1" strokeDasharray="3 3" opacity="0.4" />
              ) : isSelected ? (
                <circle cx={x} cy={y} r="16" fill="none" stroke="#0D9488" strokeWidth="1.5" opacity="0.8" />
              ) : null}

              {/* Main Hub Node */}
              <circle
                cx={x}
                cy={y}
                r="9"
                fill={isDown ? "#FFFFFF" : "#17324D"}
                stroke={isDown ? "#17324D" : "#0D9488"}
                strokeWidth="2.5"
              />
              <circle cx={x} cy={y} r="3.5" fill={isDown ? "#17324D" : "#0D9488"} />

              {/* Warehouse Code & Name */}
              <text
                x={x}
                y={y - 14}
                textAnchor="middle"
                fontSize="11"
                fill="#17324D"
                fontWeight="bold"
                className="select-none font-mono"
              >
                {wh.code}
              </text>
              <text
                x={x}
                y={y + 22}
                textAnchor="middle"
                fontSize="10"
                fill="#17324D"
                opacity="0.65"
                fontWeight="500"
                className="select-none font-mono"
              >
                {wh.city}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Selected Warehouse Inspection Card */}
      {selectedWh && (
        <div className="absolute bottom-4 left-4 right-4 z-20 bg-white border border-[#17324D]/15 rounded-xl p-4 shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4 animate-in fade-in">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[#17324D]/5 text-[#17324D] border border-[#17324D]/15">
              <Layers className="w-5 h-5 text-[#0D9488]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-[#17324D]">{selectedWh.name}</h4>
                <RetroBadge variant={selectedWh.is_operational ? 'teal' : 'navy'} size="sm">
                  {selectedWh.is_operational ? 'OPERATIONAL' : 'DISRUPTED'}
                </RetroBadge>
              </div>
              <p className="text-xs text-[#17324D]/60 font-mono mt-0.5">
                {selectedWh.address}, {selectedWh.city}, {selectedWh.state} • Lat: {selectedWh.lat.toFixed(2)}, Lng: {selectedWh.lng.toFixed(2)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-6 text-xs">
            <div>
              <span className="text-[#17324D]/50 uppercase tracking-wider block text-[10px] font-mono">Pallet Capacity</span>
              <span className="font-bold text-[#17324D] font-mono-num">{selectedWh.used_pallets.toLocaleString()} / {selectedWh.capacity_pallets.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-[#17324D]/50 uppercase tracking-wider block text-[10px] font-mono">Cold Storage</span>
              <span className="font-bold text-[#0D9488] font-mono-num">{selectedWh.cold_storage_capacity.toLocaleString()} pallets</span>
            </div>
            {onToggleDisruption && (
              <button
                onClick={() => onToggleDisruption(selectedWh.id)}
                className="px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all flex items-center gap-1.5 border border-[#17324D]/20 bg-white text-[#17324D] hover:bg-[#17324D]/5 cursor-pointer"
              >
                <ShieldAlert className="w-3.5 h-3.5 text-[#0D9488]" />
                {selectedWh.is_operational ? 'Simulate Disruption' : 'Restore Operations'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
