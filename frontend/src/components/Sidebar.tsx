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
  Truck,
  ScanLine,
  Server,
  Building2,
  LogIn
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { RoleType } from '../types';

interface NavItem {
  to: string;
  label: string;
  icon: any;
  badge?: string;
  allowedRoles: RoleType[];
}

const ALL_NAV_ITEMS: NavItem[] = [
  // Super Admin Navigation
  { 
    to: '/', 
    label: 'Cluster Health & Platform', 
    icon: Server, 
    badge: 'SYSTEM',
    allowedRoles: ['super_admin'] 
  },
  { 
    to: '/users', 
    label: 'Enterprise Role Admin', 
    icon: Users,
    allowedRoles: ['super_admin'] 
  },
  { 
    to: '/whatsapp', 
    label: 'WhatsApp Bot Gateway', 
    icon: MessageSquare, 
    badge: 'GATEWAY',
    allowedRoles: ['super_admin'] 
  },

  // Org Admin Navigation
  { 
    to: '/', 
    label: 'Network Governance & Hubs', 
    icon: Building2, 
    badge: 'DIRECTOR',
    allowedRoles: ['org_admin'] 
  },
  { 
    to: '/optimizer', 
    label: 'Distribution Optimizer', 
    icon: Cpu, 
    badge: 'OR-TOOLS',
    allowedRoles: ['org_admin'] 
  },
  { 
    to: '/inventory', 
    label: 'Global Stock Ledger', 
    icon: Boxes,
    allowedRoles: ['org_admin'] 
  },
  { 
    to: '/users', 
    label: 'Team Provisioning', 
    icon: Users,
    allowedRoles: ['org_admin'] 
  },

  // Supply Chain Manager Navigation
  { 
    to: '/', 
    label: 'MIP Solver & Approvals', 
    icon: LayoutDashboard, 
    badge: 'STUDIO',
    allowedRoles: ['supply_chain_manager'] 
  },
  { 
    to: '/optimizer', 
    label: 'Distribution Optimizer', 
    icon: Cpu, 
    badge: 'MIP SOLVER',
    allowedRoles: ['supply_chain_manager'] 
  },
  { 
    to: '/forecasting', 
    label: 'Demand Forecasting', 
    icon: TrendingUp,
    allowedRoles: ['supply_chain_manager'] 
  },
  { 
    to: '/inventory', 
    label: 'Multi-Hub Inventory Matrix', 
    icon: Boxes,
    allowedRoles: ['supply_chain_manager'] 
  },

  // Warehouse Manager Navigation
  { 
    to: '/', 
    label: 'Facility Dock Management', 
    icon: LayoutDashboard, 
    badge: 'FACILITY',
    allowedRoles: ['warehouse_manager'] 
  },
  { 
    to: '/iot', 
    label: 'IoT Telemetry Excursions', 
    icon: ThermometerSnowflake, 
    badge: 'ESP32',
    allowedRoles: ['warehouse_manager'] 
  },
  { 
    to: '/inventory', 
    label: 'Local Hub Stock & Batches', 
    icon: Boxes,
    allowedRoles: ['warehouse_manager'] 
  },

  // Distributor / Field Operator Navigation
  { 
    to: '/', 
    label: 'Delivery Manifest & Handover', 
    icon: Truck, 
    badge: 'ROUTE',
    allowedRoles: ['distributor'] 
  },

  // Warehouse Operator Navigation
  { 
    to: '/', 
    label: 'Scan & Wave Pick Station', 
    icon: QrCode, 
    badge: 'STATION',
    allowedRoles: ['operator'] 
  },
  { 
    to: '/scanner', 
    label: 'Optical Camera Scanner', 
    icon: ScanLine, 
    badge: 'CAMERA',
    allowedRoles: ['operator'] 
  },
];

const ROLE_DISPLAY_NAMES: Record<RoleType, string> = {
  super_admin: 'Super Admin',
  org_admin: 'Organization Admin',
  supply_chain_manager: 'Supply Chain Manager',
  warehouse_manager: 'Warehouse Manager',
  distributor: 'Distributor / Fleet',
  operator: 'Warehouse Operator',
};

export const Sidebar: React.FC = () => {
  const { activeRole } = useAppStore();

  const roleNavItems = ALL_NAV_ITEMS.filter(item => item.allowedRoles.includes(activeRole));

  return (
    <aside className="w-64 shrink-0 bg-[#17324D] border-r border-[#17324D] flex flex-col justify-between h-screen sticky top-0 text-white select-none">
      {/* Brand Header */}
      <div>
        <div className="h-16 px-5 flex items-center gap-3 border-b border-white/10 bg-[#17324D]">
          <div className="w-8 h-8 rounded-lg bg-[#0D9488] flex items-center justify-center text-white shadow-xs">
            <Compass className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 font-bold text-sm tracking-tight text-white font-mono">
              <span>STOCKPILOT</span>
              <span className="text-[10px] font-bold px-1 py-0.2 rounded bg-[#0D9488]/30 text-white border border-[#0D9488]/50">
                AI
              </span>
            </div>
            <div className="text-[10px] font-medium text-white/60 tracking-wider uppercase font-mono">
              BioLogistics Platform
            </div>
          </div>
        </div>

        {/* Dynamic Navigation Links strictly filtered to this role */}
        <nav className="p-3 space-y-1">
          <div className="px-3 py-2 text-[10px] font-mono font-bold uppercase tracking-wider text-white/50 flex items-center justify-between">
            <span>{ROLE_DISPLAY_NAMES[activeRole]}</span>
            <span className="text-[9px] px-1.5 py-0.2 rounded bg-white/10 text-white font-bold border border-white/15 font-mono">
              {roleNavItems.length} Module{roleNavItems.length > 1 ? 's' : ''}
            </span>
          </div>

          {roleNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={`${item.to}-${item.label}`}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-mono transition-colors duration-150 border ${
                    isActive
                      ? 'bg-white/10 border-l-2 border-[#0D9488] border-y-transparent border-r-transparent text-white font-bold'
                      : 'border-transparent text-white/70 hover:text-white hover:bg-white/5'
                  }`
                }
              >
                <div className="flex items-center gap-2.5">
                  <Icon className="w-4 h-4 shrink-0 text-[#0D9488]" />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-white/15 bg-white/5 text-white/70 uppercase tracking-wider">
                    {item.badge}
                  </span>
                )}
              </NavLink>
            );
          })}

          {/* Quick link to Switch Persona / Login Portal */}
          <div className="pt-3 mt-3 border-t border-white/10">
            <NavLink
              to="/login"
              className={({ isActive }) =>
                `flex items-center justify-between px-3 py-2 rounded-lg text-xs font-mono transition-colors duration-150 border ${
                  isActive
                    ? 'bg-white/10 border-l-2 border-[#0D9488] text-white font-bold'
                    : 'border-transparent text-white/60 hover:text-white hover:bg-white/5'
                }`
              }
            >
              <div className="flex items-center gap-2.5">
                <LogIn className="w-4 h-4 shrink-0 text-[#0D9488]" />
                <span>Switch / Login Portal</span>
              </div>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-white/15 bg-white/10 text-white/80 uppercase tracking-wider">
                6 ROLES
              </span>
            </NavLink>
          </div>
        </nav>
      </div>

      {/* Footer Info: Current Role context */}
      <div className="p-4 border-t border-white/10 bg-[#17324D]">
        <div className="p-3 rounded-xl bg-white/5 border border-white/10">
          <div className="text-[10px] uppercase font-mono font-bold text-white/50 flex items-center justify-between">
            <span>Operating Persona</span>
            <span className="w-2 h-2 rounded-full bg-[#0D9488]" />
          </div>
          <div className="text-xs font-bold text-white mt-1 capitalize font-mono">
            {activeRole.replace(/_/g, ' ')}
          </div>
          <div className="text-[10px] text-white/60 mt-0.5 font-mono">
            Role isolation enforced
          </div>
          <NavLink
            to="/login"
            className="mt-2.5 block text-center py-1.5 px-2 rounded-lg bg-[#0D9488] hover:bg-[#0B7C72] text-white text-[10px] font-mono font-bold transition-colors cursor-pointer"
          >
            Change Persona ➔
          </NavLink>
        </div>
      </div>
    </aside>
  );
};
export default Sidebar;
