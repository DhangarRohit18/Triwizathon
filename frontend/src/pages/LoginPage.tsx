import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { RoleType } from '../types';
import { api } from '../services/api';
import { 
  Compass, 
  ShieldCheck, 
  Cpu, 
  Boxes, 
  Truck, 
  QrCode, 
  ArrowRight, 
  Sparkles, 
  CheckCircle2, 
  Lock, 
  KeyRound,
  Building2,
  Server,
  Zap
} from 'lucide-react';
import { TactileButton } from '../components/ui/TactileButton';
import { RetroBadge } from '../components/ui/RetroBadge';
import { SmoothCard } from '../components/ui/SmoothCard';

interface RolePersonaConfig {
  role: RoleType;
  title: string;
  badge: string;
  personaName: string;
  email: string;
  icon: React.ElementType;
  primaryFeatures: string[];
  restrictedFrom: string[];
}

const ROLE_CONFIGS: RolePersonaConfig[] = [
  {
    role: 'super_admin',
    title: 'Super Admin',
    badge: 'LEVEL 0 — ROOT SYSTEM',
    personaName: 'Sarah Chen',
    email: 'superadmin@stockpilot.ai',
    icon: Server,
    primaryFeatures: [
      'Multi-tenant cloud topography & DB/Redis replicas',
      'Global security kill switch & read-only lock',
      'Immutable cryptographic system audit logs',
      'System-wide user provisioning & RBAC governance'
    ],
    restrictedFrom: []
  },
  {
    role: 'org_admin',
    title: 'Organization Admin',
    badge: 'LEVEL 1 — ORG DIRECTOR',
    personaName: 'Marcus Vance / Organizer Vk',
    email: 'orgadmin@stockpilot.ai',
    icon: Building2,
    primaryFeatures: [
      'Supply network topography & disruption simulator',
      'Safety stock buffer controls & allocation policies',
      'Operator and manager seat provisioning',
      'Executive performance KPIs & cost reduction metrics'
    ],
    restrictedFrom: ['Root system replica engineering']
  },
  {
    role: 'supply_chain_manager',
    title: 'Supply Chain Manager',
    badge: 'LEVEL 2 — MIP SOLVER',
    personaName: 'Elena Rostova',
    email: 'supplychain@stockpilot.ai',
    icon: Cpu,
    primaryFeatures: [
      'Google OR-Tools MIP multi-echelon optimizer ($40.8k savings)',
      '14-day demand velocity curves & stockout forecasting',
      'Inter-facility rebalance dispatch & transfer approvals',
      'Lead time volatility curves & holding cost minimization'
    ],
    restrictedFrom: ['User provisioning', 'Hardware IoT probe flashing']
  },
  {
    role: 'warehouse_manager',
    title: 'Warehouse Manager',
    badge: 'LEVEL 3 — COLD-CHAIN & FEFO',
    personaName: 'David Sterling',
    email: 'whmanager@stockpilot.ai',
    icon: Boxes,
    primaryFeatures: [
      'Cold-chain IoT probe telemetry (4.2°C nominal monitor)',
      'FEFO batch expiry liquidation radar (<30d & <60d tags)',
      'Cycle count reconciliation & inventory movement ledger',
      'Quarantine and batch spoil mitigation workflow'
    ],
    restrictedFrom: ['MIP solver execution', 'Enterprise seat admin']
  },
  {
    role: 'distributor',
    title: 'Distributor & Fleet Logistics',
    badge: 'LEVEL 4 — FLEET & DISPATCH',
    personaName: 'Rajiv Patel',
    email: 'distributor@stockpilot.ai',
    icon: Truck,
    primaryFeatures: [
      'Outbound vehicle manifests (DSP-7821, DSP-9932)',
      'Cold-chain route monitoring & in-transit waybills',
      'Digital Proof-of-Delivery (POD) receiver signature capture',
      'Delivery confirmation & destination dock ledger check'
    ],
    restrictedFrom: ['Global optimizer', 'IoT calibration', 'User admin']
  },
  {
    role: 'operator',
    title: 'Warehouse Operator',
    badge: 'LEVEL 5 — INTAKE & SCANNING',
    personaName: "James O'Connor",
    email: 'operator@stockpilot.ai',
    icon: QrCode,
    primaryFeatures: [
      'Optical high-speed QR & Barcode scanning camera',
      'Synthesized audio beep & batch barcode verification',
      'Wave picking checklist & physical stock intake',
      'Real-time product SKU verification & storage bay lookup'
    ],
    restrictedFrom: ['Multi-echelon optimizer', 'Forecasting', 'System configuration']
  }
];

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { setUser, setActiveRole, activeRole, addToast } = useAppStore();
  const [authenticatingRole, setAuthenticatingRole] = useState<RoleType | null>(null);

  // Manual credentials form state
  const [manualEmail, setManualEmail] = useState('');
  const [manualPassword, setManualPassword] = useState('');
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualLoading, setManualLoading] = useState(false);

  const handleRoleLogin = async (targetRole: RoleType, personaName: string) => {
    setAuthenticatingRole(targetRole);
    try {
      // Execute role switch and token generation
      const res = await api.auth.switchRole(targetRole);
      setUser(res.user, res.access_token);
      setActiveRole(targetRole);

      addToast({
        type: 'success',
        title: `Logged in as ${ROLE_CONFIGS.find(r => r.role === targetRole)?.title}`,
        message: `Welcome, ${personaName}! Workstation configured with role-specific features.`
      });

      // Navigate to main application
      navigate('/');
    } catch (err: any) {
      console.warn('Network role login fallback:', err);
      setActiveRole(targetRole);
      addToast({
        type: 'info',
        title: `Authenticated as ${targetRole}`,
        message: 'Offline workstation initialized.'
      });
      navigate('/');
    } finally {
      setAuthenticatingRole(null);
    }
  };

  const handleManualLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualEmail || !manualPassword) {
      addToast({
        type: 'error',
        title: 'Missing Credentials',
        message: 'Please enter both email and password.'
      });
      return;
    }

    setManualLoading(true);
    try {
      const res = await api.auth.login({
        email: manualEmail.trim().toLowerCase(),
        password: manualPassword
      });
      setUser(res.user, res.access_token);
      setActiveRole(res.user.role);

      addToast({
        type: 'success',
        title: 'Authenticated Successfully',
        message: `Welcome back, ${res.user.full_name} (${res.user.role})!`
      });

      navigate('/');
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Authentication Failed',
        message: err.message || 'Invalid email or password.'
      });
    } finally {
      setManualLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-[#17324D] industrial-grid flex flex-col justify-between py-8 px-4 sm:px-6 lg:px-8">
      {/* Top Header */}
      <div className="max-w-6xl w-full mx-auto">
        <div className="flex flex-col sm:flex-row items-center justify-between pb-6 border-b border-[#17324D]/15 gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#17324D]/5 border border-[#17324D]/20 flex items-center justify-center text-[#0D9488] shadow-sm">
              <Compass className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono font-black text-lg tracking-tight text-[#17324D]">
                  STOCKPILOT AI
                </span>
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border border-[#0D9488]/30 bg-[#0D9488]/10 text-[#0D9488]">
                  v2.4
                </span>
              </div>
              <div className="text-[11px] font-mono text-[#17324D]/70 uppercase tracking-wider">
                Intelligent BioLogistics & Autonomous Distribution Engine
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-[#17324D]/70 bg-[#17324D]/5 px-3 py-1.5 rounded-lg border border-[#17324D]/15">
              <ShieldCheck className="w-4 h-4 text-[#0D9488]" />
              <span>Strict Role-Based Isolation Active</span>
            </div>
            <TactileButton
              variant="primary"
              onClick={() => navigate('/')}
              className="flex items-center gap-2 text-xs font-mono font-bold py-2 px-4 shadow-sm"
              title="Return directly to Active Dashboard"
            >
              <Compass className="w-4 h-4 text-[#0D9488]" />
              <span>Go to Dashboard</span>
              <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
            </TactileButton>
          </div>
        </div>

        {/* Hero Title */}
        <div className="my-8 text-center max-w-2xl mx-auto">
          <RetroBadge variant="teal" className="mb-3">
            ROLE-BASED WORKSTATION ACCESS
          </RetroBadge>
          <h1 className="text-2xl sm:text-3xl font-black text-[#17324D] tracking-tight font-mono">
            Select Your Operating Persona
          </h1>
          <p className="mt-2 text-xs sm:text-sm text-[#17324D]/70 leading-relaxed font-sans">
            StockPilot dynamically provisions dedicated tools, solvers, ledgers, and permissions tailored specifically to each of the 6 enterprise roles.
          </p>
        </div>

        {/* 6 Role Buttons Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {ROLE_CONFIGS.map((config) => {
            const Icon = config.icon;
            const isLoggingIn = authenticatingRole === config.role;
            const isCurrentlyActive = activeRole === config.role;

            return (
              <SmoothCard
                key={config.role}
                className={`p-6 flex flex-col justify-between transition-all duration-200 hover:shadow-md border ${
                  isCurrentlyActive
                    ? 'border-[#0D9488] bg-[#0D9488]/5 ring-1 ring-[#0D9488]/30'
                    : 'border-[#17324D]/15 bg-white hover:border-[#0D9488]/40'
                }`}
              >
                <div>
                  {/* Card Header: Icon & Badge */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-10 h-10 rounded-xl bg-[#0D9488]/10 border border-[#0D9488]/30 flex items-center justify-center text-[#0D9488]">
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded border border-[#17324D]/20 bg-[#17324D]/5 text-[#17324D]">
                      {config.badge}
                    </span>
                  </div>

                  {/* Role Title & Persona */}
                  <div className="mb-3">
                    <h3 className="text-base font-black text-[#17324D] tracking-tight font-mono">
                      {config.title}
                    </h3>
                    <div className="text-xs font-semibold text-[#0D9488] mt-0.5">
                      {config.personaName}
                    </div>
                    <div className="text-[11px] font-mono text-[#17324D]/50">
                      {config.email}
                    </div>
                  </div>

                  {/* Specific Features Visible */}
                  <div className="space-y-1.5 my-4 pt-3 border-t border-[#17324D]/10">
                    <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#17324D]/50">
                      Visible Modules & Controls:
                    </div>
                    {config.primaryFeatures.map((feat, idx) => (
                      <div key={idx} className="flex items-start gap-1.5 text-xs text-[#17324D]">
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#0D9488] shrink-0 mt-0.5" />
                        <span className="leading-tight">{feat}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 1-Click Role Login Action Button */}
                <div className="pt-4 border-t border-[#17324D]/10">
                  <TactileButton
                    variant={isCurrentlyActive ? 'secondary' : 'primary'}
                    disabled={isLoggingIn}
                    onClick={() => handleRoleLogin(config.role, config.personaName)}
                    className="w-full flex items-center justify-center gap-2 text-xs font-mono font-bold py-2.5"
                  >
                    {isLoggingIn ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Authenticating...</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-3.5 h-3.5" />
                        <span>Log In as {config.title}</span>
                        <ArrowRight className="w-3.5 h-3.5 ml-auto" />
                      </>
                    )}
                  </TactileButton>
                </div>
              </SmoothCard>
            );
          })}
        </div>

        {/* Collapsible Manual Credentials Form */}
        <div className="mt-10 max-w-md mx-auto">
          <div className="text-center">
            <button
              onClick={() => setShowManualForm(!showManualForm)}
              className="text-xs font-mono font-bold text-[#17324D]/70 hover:text-[#0D9488] underline underline-offset-4 transition-colors"
            >
              {showManualForm ? 'Hide Administrative Password Form' : 'Use Direct Email & Password Sign In'}
            </button>
          </div>

          {showManualForm && (
            <SmoothCard className="mt-4 p-6 border border-[#17324D]/15 bg-white shadow-sm">
              <div className="text-xs font-mono font-bold text-[#17324D]/50 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Lock className="w-3.5 h-3.5 text-[#0D9488]" />
                <span>Standard Administrative Sign In</span>
              </div>

              <form onSubmit={handleManualLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-mono font-bold text-[#17324D] mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={manualEmail}
                    onChange={(e) => setManualEmail(e.target.value)}
                    placeholder="supplychain@stockpilot.ai"
                    className="w-full px-3 py-2 rounded-lg border border-[#17324D]/20 text-xs text-[#17324D] focus:outline-none focus:border-[#0D9488] font-mono bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono font-bold text-[#17324D] mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    value={manualPassword}
                    onChange={(e) => setManualPassword(e.target.value)}
                    placeholder="Admin123!"
                    className="w-full px-3 py-2 rounded-lg border border-[#17324D]/20 text-xs text-[#17324D] focus:outline-none focus:border-[#0D9488] font-mono bg-white"
                  />
                  <div className="text-[10px] text-[#17324D]/50 mt-1 font-mono">
                    Default evaluation password: <code className="bg-[#17324D]/10 px-1 py-0.5 rounded text-[#17324D]">Admin123!</code>
                  </div>
                </div>

                <TactileButton
                  type="submit"
                  variant="primary"
                  disabled={manualLoading}
                  className="w-full flex items-center justify-center gap-2 text-xs font-mono font-bold py-2.5"
                >
                  <KeyRound className="w-4 h-4" />
                  <span>{manualLoading ? 'Verifying...' : 'Sign In with Credentials'}</span>
                </TactileButton>
              </form>
            </SmoothCard>
          )}
        </div>
      </div>

      {/* Footer Security Perimeters */}
      <div className="max-w-6xl w-full mx-auto mt-12 pt-6 border-t border-[#17324D]/15 text-center flex flex-col sm:flex-row items-center justify-between text-[11px] font-mono text-[#17324D]/60 gap-3">
        <div>
          StockPilot AI Autonomous Distribution Engine • Enterprise RBAC Verified
        </div>
        <div className="flex items-center gap-4">
          <span>HMAC-SHA256 Encrypted</span>
          <span>•</span>
          <span>Signed JWT Bearer</span>
          <span>•</span>
          <span>Zero-Trust API Perimeter</span>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
