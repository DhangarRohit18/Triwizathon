import React from 'react';
import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Cpu, 
  TrendingUp, 
  Boxes, 
  ThermometerSnowflake, 
  QrCode, 
  MessageSquare, 
  Users, 
  Compass,
  ArrowUpRight
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

const NAV_ITEMS = [
  { to: '/', label: 'Operational Dashboard', icon: LayoutDashboard },
  { to: '/optimizer', label: 'Distribution Optimizer', icon: Cpu, badge: 'OR-Tools' },
  { to: '/forecasting', label: 'Demand Forecasting', icon: TrendingUp },
  { to: '/inventory', label: 'Inventory & FEFO Ledger', icon: Boxes },
  { to: '/iot', label: 'IoT Cold-Chain Telemetry', icon: ThermometerSnowflake, badge: 'ESP32' },
  { to: '/qr', label: 'QR Scanner & Labels', icon: QrCode },
  { to: '/whatsapp', label: 'WhatsApp Bot Simulator', icon: MessageSquare, badge: 'Cloud API' },
  { to: '/users', label: 'Users & Role Admin', icon: Users },
];

export const Sidebar: React.FC = () => {
  const { activeRole } = useAppStore();

  return (
    <aside className="w-64 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-col justify-between h-screen sticky top-0">
      {/* Brand Header */}
      <div>
        <div className="h-16 px-5 flex items-center gap-3 border-b border-slate-200 dark:border-slate-800">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-600 via-teal-500 to-emerald-400 p-0.5 flex items-center justify-center shadow-lg shadow-sky-500/20">
            <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <Compass className="w-5 h-5 text-sky-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 font-black text-sm tracking-tight text-slate-900 dark:text-white">
              <span>STOCKPILOT</span>
              <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400 border border-sky-500/30">
                AI
              </span>
            </div>
            <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400 tracking-wider uppercase">
              Distribution Engine
            </div>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="p-3 space-y-1">
          <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Core Modules
          </div>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-sky-500 text-white shadow-md shadow-sky-500/25'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-900 hover:text-slate-900 dark:hover:text-slate-200'
                  }`
                }
              >
                <div className="flex items-center gap-2.5">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-white/20 dark:bg-slate-800 text-slate-200 uppercase tracking-wider">
                    {item.badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>
      </div>

      {/* Footer Info: Current Role context */}
      <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-900/40">
        <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="text-[10px] uppercase font-bold text-slate-400 flex items-center justify-between">
            <span>Operating Persona</span>
            <span className="w-2 h-2 rounded-full bg-sky-400" />
          </div>
          <div className="text-xs font-bold text-slate-800 dark:text-slate-100 mt-1 capitalize">
            {activeRole.replace('_', ' ')}
          </div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
            Full enterprise role isolation active
          </div>
        </div>
      </div>
    </aside>
  );
};
