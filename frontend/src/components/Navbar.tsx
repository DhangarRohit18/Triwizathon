import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { RoleType, Warehouse } from '../types';
import { 
  Building2, 
  ShieldCheck, 
  ChevronDown, 
  Layers, 
  Wifi,
  UserCheck,
  LogIn,
  LogOut,
  User
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
  const navigate = useNavigate();
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
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [isConnected, setIsConnected] = useState(true);

  useEffect(() => {
    let isMounted = true;
    api.warehouses.list()
      .then((whs) => {
        if (isMounted) {
          setWarehouses(whs);
          setIsConnected(true);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.warn('Warehouse fetch in Navbar:', err);
          setIsConnected(false);
        }
      });

    const interval = setInterval(() => {
      api.warehouses.list()
        .then(() => { if (isMounted) setIsConnected(true); })
        .catch(() => { if (isMounted) setIsConnected(false); });
    }, 45000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

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
      title: `Switched Persona to ${ROLES_INFO[role]?.label || role}`,
      message: `Workstation and controls loaded for ${role}.`
    });
  };

  const handleLogout = () => {
    setUser(null, null);
    localStorage.removeItem('stockpilot_token');
    addToast({
      type: 'info',
      title: 'Signed Out',
      message: 'Your session has ended.'
    });
    navigate('/login');
  };

  // Filter warehouses based on user's authorized scope
  const userWhIds = user?.warehouse_ids && user.warehouse_ids.length > 0 
    ? user.warehouse_ids 
    : (user?.warehouse_id ? [user.warehouse_id] : []);

  const visibleWarehouses = (activeRole === 'warehouse_manager' || activeRole === 'operator') && userWhIds.length > 0
    ? warehouses.filter(w => userWhIds.includes(w.id))
    : warehouses;

  const activeWarehouseObj = warehouses.find(w => w.id === (user?.warehouse_id || selectedWarehouseId)) || warehouses[0];

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
            <span className="font-semibold">{activeWarehouseObj ? `${activeWarehouseObj.name} Floor` : 'Assigned Floor Station'}</span>
          </div>
        ) : activeRole === 'distributor' ? (
          <div className="flex items-center gap-1.5 bg-white border border-[#17324D]/15 rounded-lg px-2.5 py-1.5 text-xs text-[#17324D] font-mono">
            <span className="w-2 h-2 rounded-full bg-[#0D9488]" />
            <span className="font-semibold">Regional Fleet Dispatch & POD</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 bg-white border border-[#17324D]/15 hover:border-[#17324D]/30 rounded-lg px-2.5 py-1.5 text-xs transition-colors">
            <Layers className="w-3.5 h-3.5 text-[#0D9488] shrink-0" />
            <select
              value={selectedWarehouseId}
              onChange={(e) => setSelectedWarehouseId(e.target.value)}
              className="bg-transparent border-none text-[#17324D] focus:outline-none font-medium cursor-pointer"
            >
              {(activeRole === 'super_admin' || activeRole === 'org_admin' || activeRole === 'supply_chain_manager') && (
                <option value="all">Network View (All Facilities)</option>
              )}
              {visibleWarehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.city || 'Hub'})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Right Controls: Role Switcher, Online Status, User Profile */}
      <div className="flex items-center gap-3">
        {/* RuralReach Mode Direct Action Launcher */}
        <Link
          to="/ruralreach"
          className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-[11px] font-mono font-bold text-emerald-800 transition-colors shadow-xs"
          title="Switch to Offline-First RuralReach Mode"
        >
          <span>🌾 RuralReach</span>
        </Link>

        {/* Real-time System Connectivity Badge */}
        <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-[#17324D]/15 text-[11px] font-mono font-semibold text-[#17324D]">
          <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-[#0D9488]' : 'bg-red-500'}`} />
          <span>{isConnected ? 'CONNECTED' : 'DISCONNECTED'}</span>
        </div>

        {/* Persona Selector Dropdown */}
        <div className="relative">
          <button
            onClick={() => {
              setRoleMenuOpen(!roleMenuOpen);
              setUserMenuOpen(false);
            }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#17324D]/20 hover:border-[#0D9488] bg-white text-xs font-mono font-medium text-[#17324D] transition-colors cursor-pointer"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-[#0D9488]" />
            <span className="font-bold">{ROLES_INFO[activeRole]?.label || activeRole}</span>
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

        {/* User avatar and profile popover */}
        <div className="relative">
          <button
            onClick={() => {
              setUserMenuOpen(!userMenuOpen);
              setRoleMenuOpen(false);
            }}
            className="flex items-center gap-2 pl-2 border-l border-[#17324D]/15 cursor-pointer"
            title={user?.full_name || 'User Profile'}
          >
            <div className="w-8 h-8 rounded-full bg-[#17324D] text-white flex items-center justify-center font-bold text-xs hover:ring-2 hover:ring-[#0D9488] transition-all">
              {user?.full_name ? user.full_name[0].toUpperCase() : 'U'}
            </div>
          </button>

          {userMenuOpen && (
            <div className="absolute right-0 mt-2 w-64 rounded-xl border border-[#17324D]/15 bg-white shadow-lg p-3 z-50 animate-in fade-in">
              <div className="pb-2 border-b border-[#17324D]/10">
                <div className="font-bold text-xs text-[#17324D]">{user?.full_name || 'StockPilot User'}</div>
                <div className="text-[11px] text-[#17324D]/60 truncate font-mono mt-0.5">{user?.email || 'authenticated'}</div>
                <div className="mt-1.5">
                  <span className="inline-block px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#0D9488]/10 text-[#0D9488] uppercase">
                    {ROLES_INFO[activeRole]?.label || activeRole}
                  </span>
                </div>
              </div>

              <div className="pt-2 space-y-1">
                <Link
                  to="/login"
                  onClick={() => setUserMenuOpen(false)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-[#17324D] hover:bg-[#17324D]/5 rounded-lg transition-colors"
                >
                  <User className="w-3.5 h-3.5 text-[#0D9488]" />
                  <span>Switch Account</span>
                </Link>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer text-left"
                >
                  <LogOut className="w-3.5 h-3.5 text-rose-600" />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
export default Navbar;
