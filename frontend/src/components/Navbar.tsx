import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { RoleType } from '../types';
import { 
  Building2, 
  ShieldCheck, 
  ChevronDown, 
  Layers, 
  Wifi,
  UserCheck,
  LogIn
} from 'lucide-react';
import { api } from '../services/api';

const ROLES_INFO: Record<RoleType, { label: string; desc: string }> = {
  super_admin: { label: 'Super Admin', desc: 'Tenant isolation & platform health' },
  org_admin: { label: 'Organization Admin', desc: 'Warehouses, users & stock policies' },
  supply_chain_manager: { label: 'Supply Chain Manager', desc: 'Optimization runs, forecasts & transfers' },
  warehouse_manager: { label: 'Warehouse Manager', desc: 'Hub inventory, batches & IoT telemetry' },
  distributor: { label: 'Distributor / Fleet', desc: 'Assigned dispatches & delivery logs' },
  operator: { label: 'Warehouse Operator', desc: 'QR scanning, pick & pack, stock receipts' },
};

export const Navbar: React.FC = () => {
  const { 
    user, 
    setUser,
    activeRole, 
    setActiveRole, 
    selectedWarehouseId, 
    setSelectedWarehouseId, 
    addToast 
  } = useAppStore();

  const [roleMenuOpen, setRoleMenuOpen] = useState(false);

  const handleRoleSelect = async (role: RoleType) => {
    setActiveRole(role);
    setRoleMenuOpen(false);
    try {
      const res = await api.auth.switchRole(role);
      setUser(res.user, res.access_token);
    } catch (e) {
      console.warn('Role switch network sync:', e);
    }
    addToast({
      type: 'info',
      title: `Switched Persona to ${ROLES_INFO[role].label}`,
      message: `Workstation and controls loaded for ${role}.`
    });
  };

  return (
    <header className="sticky top-0 z-40 h-16 border-b border-[#17324D]/15 bg-white px-4 sm:px-6 flex items-center justify-between text-[#17324D]">
      {/* Left: Organization context & Facility indicator */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#17324D]">
          <div className="p-1.5 rounded-lg bg-[#17324D]/5 border border-[#17324D]/15 text-[#17324D]">
            <Building2 className="w-3.5 h-3.5 shrink-0" />
          </div>
          <span className="hidden sm:inline font-bold tracking-tight">StockPilot Global BioLogistics</span>
          <span className="text-[#17324D]/30 hidden sm:inline">/</span>
        </div>

        {/* Facility Indicator / Warehouse Selector */}
        {activeRole === 'operator' ? (
          <div className="flex items-center gap-1.5 bg-white border border-[#17324D]/15 rounded-lg px-2.5 py-1.5 text-xs text-[#17324D] font-mono">
            <span className="w-2 h-2 rounded-full bg-[#0D9488]" />
            <span className="font-semibold">ORD-01 Chicago Inbound Dock</span>
          </div>
        ) : activeRole === 'distributor' ? (
          <div className="flex items-center gap-1.5 bg-white border border-[#17324D]/15 rounded-lg px-2.5 py-1.5 text-xs text-[#17324D] font-mono">
            <span className="w-2 h-2 rounded-full bg-[#0D9488]" />
            <span className="font-semibold">Fleet Route #DSP-7821</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 bg-white border border-[#17324D]/15 hover:border-[#17324D]/30 rounded-lg px-2.5 py-1.5 text-xs transition-colors">
            <Layers className="w-3.5 h-3.5 text-[#0D9488] shrink-0" />
            <select
              value={selectedWarehouseId}
              onChange={(e) => setSelectedWarehouseId(e.target.value)}
              className="bg-transparent border-none text-[#17324D] focus:outline-none font-medium cursor-pointer"
            >
              <option value="all">Network View (All 4 Hubs)</option>
              <option value="wh_chicago_01">ORD-01 Chicago Central Hub</option>
              <option value="wh_ny_02">JFK-02 New York East DC</option>
              <option value="wh_dallas_03">DFW-03 Dallas South DC</option>
              <option value="wh_reno_04">RNO-04 Reno West DC</option>
            </select>
          </div>
        )}
      </div>

      {/* Right Controls: Role Switcher, Online Status, User Profile */}
      <div className="flex items-center gap-3">
        {/* Real-time System Connectivity Badge */}
        <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-[#17324D]/15 text-[11px] font-mono font-semibold text-[#17324D]">
          <div className="w-1.5 h-1.5 rounded-full bg-[#0D9488]" />
          <span>CONNECTED</span>
        </div>

        {/* Persona Selector Dropdown */}
        <div className="relative">
          <button
            onClick={() => setRoleMenuOpen(!roleMenuOpen)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#17324D]/20 hover:border-[#0D9488] bg-white text-xs font-mono font-medium text-[#17324D] transition-colors cursor-pointer"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-[#0D9488]" />
            <span className="font-bold">{ROLES_INFO[activeRole]?.label}</span>
            <ChevronDown className="w-3 h-3 text-[#17324D]/50" />
          </button>

          {roleMenuOpen && (
            <div className="absolute right-0 mt-2 w-72 rounded-xl border border-[#17324D]/15 bg-white shadow-lg p-2 z-50 animate-in fade-in">
              <div className="px-2 py-1.5 border-b border-[#17324D]/10 text-[10px] font-mono font-bold uppercase tracking-wider text-[#17324D]/60 flex items-center justify-between">
                <span>Select Operational Role</span>
                <span className="text-[#0D9488]">RBAC Mode</span>
              </div>
              <div className="py-1 space-y-0.5">
                {(Object.keys(ROLES_INFO) as RoleType[]).map((r) => {
                  const isSelected = activeRole === r;
                  return (
                    <button
                      key={r}
                      onClick={() => handleRoleSelect(r)}
                      className={`w-full text-left px-2.5 py-2 rounded-lg text-xs font-mono transition-colors flex flex-col cursor-pointer ${
                        isSelected 
                          ? 'bg-[#0D9488]/10 text-[#0D9488] font-bold border border-[#0D9488]/30' 
                          : 'text-[#17324D] hover:bg-[#17324D]/5'
                      }`}
                    >
                      <span className="font-semibold text-xs">{ROLES_INFO[r].label}</span>
                      <span className="text-[10px] text-[#17324D]/60 font-sans mt-0.5">{ROLES_INFO[r].desc}</span>
                    </button>
                  );
                })}
              </div>
              <div className="pt-1.5 border-t border-[#17324D]/10 mt-1">
                <Link
                  to="/login"
                  onClick={() => setRoleMenuOpen(false)}
                  className="flex items-center justify-center gap-1.5 w-full py-1.5 text-center text-[11px] font-mono font-bold text-[#0D9488] hover:bg-[#0D9488]/5 rounded-lg"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Open Full Authentication Portal</span>
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* User avatar indicator */}
        <div className="flex items-center gap-2 pl-2 border-l border-[#17324D]/15">
          <div className="w-8 h-8 rounded-full bg-[#17324D] text-white flex items-center justify-center font-bold text-xs">
            {user?.full_name ? user.full_name[0].toUpperCase() : 'U'}
          </div>
        </div>
      </div>
    </header>
  );
};
export default Navbar;
