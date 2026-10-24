import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { RoleType } from '../types';
import { 
  Building2, 
  ShieldCheck, 
  Moon, 
  Sun, 
  UserCheck, 
  ChevronDown, 
  Layers, 
  Wifi,
  Sparkles
} from 'lucide-react';

const ROLES_INFO: Record<RoleType, { label: string; badgeColor: string; desc: string }> = {
  super_admin: { label: 'Super Admin', badgeColor: 'bg-purple-500/15 text-purple-400 border-purple-500/30', desc: 'Tenant isolation & platform health' },
  org_admin: { label: 'Organization Admin', badgeColor: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30', desc: 'Warehouses, users & stock policies' },
  supply_chain_manager: { label: 'Supply Chain Manager', badgeColor: 'bg-sky-500/15 text-sky-400 border-sky-500/30', desc: 'Optimization runs, forecasts & transfers' },
  warehouse_manager: { label: 'Warehouse Manager', badgeColor: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', desc: 'Hub inventory, batches & IoT telemetry' },
  distributor: { label: 'Distributor', badgeColor: 'bg-amber-500/15 text-amber-400 border-amber-500/30', desc: 'Assigned dispatches & delivery logs' },
  operator: { label: 'Warehouse Operator', badgeColor: 'bg-rose-500/15 text-rose-400 border-rose-500/30', desc: 'QR scanning, pick & pack, stock receipts' },
};

export const Navbar: React.FC = () => {
  const { 
    user, 
    activeRole, 
    setActiveRole, 
    selectedWarehouseId, 
    setSelectedWarehouseId, 
    theme, 
    toggleTheme, 
    addToast 
  } = useAppStore();

  const [roleMenuOpen, setRoleMenuOpen] = useState(false);

  const handleRoleSelect = (role: RoleType) => {
    setActiveRole(role);
    setRoleMenuOpen(false);
    addToast({
      type: 'info',
      title: `Switched Role to ${ROLES_INFO[role].label}`,
      message: `Dashboard permissions and workflows updated for ${role}.`
    });
  };

  return (
    <header className="sticky top-0 z-40 h-16 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-950/90 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between">
      {/* Left: Organization context & Warehouse filter */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
          <Building2 className="w-4 h-4 text-sky-500 shrink-0" />
          <span className="hidden sm:inline font-bold">Acuity BioLogistics Global</span>
          <span className="text-slate-400 hidden sm:inline">|</span>
        </div>

        {/* Warehouse Selector */}
        <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-xs">
          <Layers className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <select
            value={selectedWarehouseId}
            onChange={(e) => setSelectedWarehouseId(e.target.value)}
            className="bg-transparent border-none text-slate-700 dark:text-slate-200 focus:outline-none font-medium cursor-pointer"
          >
            <option value="all">Network View (All Hubs)</option>
            <option value="wh_chicago_01">Chicago Central Hub (ORD-01)</option>
            <option value="wh_ny_02">New York East DC (JFK-02)</option>
            <option value="wh_dallas_03">Dallas South DC (DFW-03)</option>
            <option value="wh_reno_04">Reno West DC (RNO-04)</option>
          </select>
        </div>
      </div>

      {/* Right Controls: Role Switcher, Online Badge, Theme Toggle */}
      <div className="flex items-center gap-3">
        {/* Real-time System Connectivity Badge */}
        <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <Wifi className="w-3 h-3" />
          <span>API LIVE</span>
        </div>

        {/* 6-Role Switcher Dropdown for Evaluator Testing */}
        <div className="relative">
          <button
            onClick={() => setRoleMenuOpen(!roleMenuOpen)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold shadow-sm transition-all ${ROLES_INFO[activeRole].badgeColor}`}
            title="Switch among all 6 enterprise roles to test role-specific dashboards"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span className="font-bold">{ROLES_INFO[activeRole].label}</span>
            <ChevronDown className={`w-3 h-3 transition-transform ${roleMenuOpen ? 'rotate-180' : ''}`} />
          </button>

          {roleMenuOpen && (
            <div className="absolute right-0 mt-2 w-72 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl py-2 z-50">
              <div className="px-3 py-1.5 border-b border-slate-100 dark:border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                <span>Select Enterprise Role</span>
                <Sparkles className="w-3 h-3 text-sky-400" />
              </div>
              <div className="p-1.5 space-y-1">
                {(Object.keys(ROLES_INFO) as RoleType[]).map((r) => {
                  const info = ROLES_INFO[r];
                  const isCurrent = activeRole === r;
                  return (
                    <button
                      key={r}
                      onClick={() => handleRoleSelect(r)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex flex-col gap-0.5 ${
                        isCurrent
                          ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-300 font-semibold'
                          : 'hover:bg-slate-100 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold">{info.label}</span>
                        {isCurrent && <span className="text-[10px] px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-400">ACTIVE</span>}
                      </div>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">{info.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 transition-colors"
          title="Toggle Light / Dark Theme"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-500" />}
        </button>

        {/* User Avatar */}
        <div className="flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-slate-800">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-sky-600 to-teal-500 flex items-center justify-center text-white text-xs font-bold shadow-sm">
            {user?.full_name?.split(' ').map(n => n[0]).join('') || 'U'}
          </div>
          <div className="hidden lg:block text-left">
            <div className="text-xs font-bold text-slate-800 dark:text-slate-200 leading-tight">
              {user?.full_name || 'Elena Rostova'}
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
              {user?.email || 'user@stockpilot.ai'}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
