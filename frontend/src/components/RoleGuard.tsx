import React from 'react';
import { Navigate, Link } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { RoleType } from '../types';
import { ShieldAlert, ArrowRight, LogIn, Lock } from 'lucide-react';
import { api } from '../services/api';
import { TactileButton } from './ui/TactileButton';
import { RetroBadge } from './ui/RetroBadge';

interface RoleGuardProps {
  children: React.ReactNode;
  allowedRoles?: RoleType[];
}

const ROLE_DISPLAY_NAMES: Record<RoleType, string> = {
  super_admin: 'Super Admin',
  org_admin: 'Organization Admin',
  supply_chain_manager: 'Supply Chain Manager',
  warehouse_manager: 'Warehouse Manager',
  distributor: 'Distributor / Fleet',
  operator: 'Warehouse Operator',
};

export const RoleGuard: React.FC<RoleGuardProps> = ({ children, allowedRoles }) => {
  const { activeRole } = useAppStore();

  if (!allowedRoles || allowedRoles.length === 0 || allowedRoles.includes(activeRole)) {
    return <>{children}</>;
  }

  const recommendedRole = allowedRoles[0];

  return (
    <div className="max-w-3xl mx-auto my-12 p-8 rounded-2xl bg-white border border-[#17324D]/15 text-[#17324D] font-sans">
      <div className="flex items-center gap-3 mb-6 pb-6 border-b border-[#17324D]/10">
        <div className="w-12 h-12 rounded-xl bg-[#17324D]/5 border border-[#17324D]/15 flex items-center justify-center text-[#17324D]">
          <ShieldAlert className="w-6 h-6 text-[#0D9488]" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#17324D]/70">
              Role Security Perimeter
            </span>
            <RetroBadge variant="teal">RESTRICTED</RetroBadge>
          </div>
          <h2 className="text-xl font-bold text-[#17324D] tracking-tight font-mono mt-0.5">
            Module Restricted to Authorized Roles
          </h2>
        </div>
      </div>

      <div className="space-y-4 text-sm text-[#17324D]/80 mb-8 leading-relaxed">
        <p>
          This enterprise feature requires specialized clearance. Your current active session is authenticated as{' '}
          <span className="font-bold font-mono text-[#17324D] px-2 py-0.5 rounded bg-[#17324D]/5 border border-[#17324D]/15">
            {ROLE_DISPLAY_NAMES[activeRole] || activeRole}
          </span>
          .
        </p>

        <div className="p-4 rounded-xl bg-white border border-[#17324D]/15">
          <div className="text-xs font-mono font-bold text-[#17324D]/50 uppercase tracking-wider mb-2">
            Authorized Roles for this Feature:
          </div>
          <div className="flex flex-wrap gap-2">
            {allowedRoles.map((r) => (
              <span
                key={r}
                className="text-xs font-mono font-bold px-2.5 py-1 rounded-lg border border-[#17324D]/20 bg-white text-[#17324D]"
              >
                {ROLE_DISPLAY_NAMES[r]}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-3 pt-6 border-t border-[#17324D]/10">
        <Link to="/login" className="w-full sm:w-auto">
          <TactileButton variant="primary" className="w-full sm:w-auto">
            <LogIn className="w-4 h-4 mr-2" />
            Sign In with Authorized Account
          </TactileButton>
        </Link>

        <Link to="/" className="w-full sm:w-auto">
          <TactileButton variant="outline" className="w-full">
            <ArrowRight className="w-4 h-4 mr-2" />
            Return to Dashboard
          </TactileButton>
        </Link>
      </div>
    </div>
  );
};
