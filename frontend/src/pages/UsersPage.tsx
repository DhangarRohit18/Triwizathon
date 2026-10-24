import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useAppStore } from '../store/useAppStore';
import { User, Warehouse, RoleType } from '../types';
import { KPICard } from '../components/KPICard';
import { 
  Users, 
  ShieldCheck, 
  UserPlus, 
  Lock, 
  Building2, 
  FileCheck2, 
  Search, 
  CheckCircle2, 
  Clock, 
  Filter,
  RefreshCw
} from 'lucide-react';

export const UsersPage: React.FC = () => {
  const { addToast, activeRole } = useAppStore();
  const [users, setUsers] = useState<User[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Invite Modal
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<RoleType>('operator');
  const [inviteWarehouse, setInviteWarehouse] = useState('wh_chicago_01');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [uData, whData, aData] = await Promise.all([
        api.auth.listUsers(),
        api.warehouses.list(),
        api.audit.list(50),
      ]);
      setUsers(uData);
      setWarehouses(whData);
      setAuditLogs(aData);
      if (whData.length > 0) setInviteWarehouse(whData[0].id);
    } catch (err: any) {
      addToast({ type: 'error', title: 'User sync error', message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.auth.inviteUser({
        full_name: inviteName,
        email: inviteEmail,
        role: inviteRole,
        warehouse_id: inviteWarehouse,
      });
      addToast({
        type: 'success',
        title: 'User Successfully Provisioned',
        message: `Account created for ${inviteName} (${inviteRole}).`
      });
      setInviteModalOpen(false);
      setInviteName('');
      setInviteEmail('');
      loadData();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Provisioning failed', message: err.message });
    }
  };

  const filteredUsers = users.filter(u => 
    u.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.role.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-slate-900 border border-slate-800 text-white">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-indigo-400">
              Enterprise Identity & Access Governance
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono font-bold">
              6-Tier RBAC & Audit Ledger
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight mt-1">
            User Administration & Security Audit Trails
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Enforces server-side role-based authorization across Super Admin, Organization Admin, Supply Chain Managers, Warehouse Managers, Distributors, and Operators.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={() => setInviteModalOpen(true)}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md shadow-indigo-600/30 flex items-center gap-2 transition-all"
          >
            <UserPlus className="w-4 h-4" />
            Provision Operator
          </button>
          <button
            onClick={loadData}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Active Users"
          value={users.length}
          subtitle="Provisioned across 6 enterprise tiers"
          icon={Users}
        />
        <KPICard
          title="Tenant Isolation"
          value="ENFORCED"
          subtitle="Scoped to org_triwiz_01"
          isPositive={true}
          icon={Building2}
          badge="Acuity BioLogistics"
        />
        <KPICard
          title="Security Audit Events"
          value={auditLogs.length}
          subtitle="Immutable operational event ledger"
          icon={FileCheck2}
        />
        <KPICard
          title="Privilege Guards"
          value="STRICT"
          subtitle="Server-validated authorizations"
          icon={Lock}
          badge="Zero Trust"
        />
      </div>

      {/* User Directory Table */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">
              Authorized Personnel Directory ({filteredUsers.length})
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Users have access restricted exclusively to permitted endpoints and assigned warehouse operations.
            </p>
          </div>

          <div className="relative w-64">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, email, or role..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs table-dense">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 uppercase tracking-wider text-[11px]">
                <th>User / Name</th>
                <th>Role Tier</th>
                <th>Assigned Warehouse</th>
                <th>WhatsApp Phone</th>
                <th>Account Status</th>
                <th>Joined Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono-num">
              {filteredUsers.map((u) => {
                const assignedWh = warehouses.find(w => w.id === u.warehouse_id);
                return (
                  <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                    <td>
                      <div className="font-bold text-slate-900 dark:text-slate-100 font-sans">
                        {u.full_name}
                      </div>
                      <span className="text-[11px] text-slate-400 font-mono font-normal">
                        {u.email}
                      </span>
                    </td>
                    <td>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded font-sans uppercase bg-sky-500/10 text-sky-400 border border-sky-500/20">
                        {u.role.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="text-slate-700 dark:text-slate-300 font-sans">
                      {assignedWh ? `${assignedWh.name} (${assignedWh.code})` : 'Network Global'}
                    </td>
                    <td className="text-slate-400 font-mono text-[11px]">
                      {u.phone_number || 'Not Linked'}
                    </td>
                    <td>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded font-sans bg-emerald-500/10 text-emerald-400">
                        ACTIVE
                      </span>
                    </td>
                    <td className="text-slate-500 text-[11px] font-mono">
                      {u.created_at ? u.created_at.substring(0, 10) : '2026-10-24'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Security Audit Ledger */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">
              Immutable Security & Compliance Audit Trail ({auditLogs.length} Events)
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Every sensitive operation (invites, transfer approvals, large stock adjustments, disruption toggles) is permanently recorded with actor identity, IP, and correlation payloads.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[350px]">
          <table className="w-full text-left text-xs table-dense">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 uppercase tracking-wider text-[11px]">
                <th>Action</th>
                <th>Actor Name & Role</th>
                <th>Target Entity</th>
                <th>Entity ID</th>
                <th>Timestamp</th>
                <th>Audit Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono-num">
              {auditLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded font-mono bg-indigo-500/10 text-indigo-400">
                      {log.action}
                    </span>
                  </td>
                  <td className="font-sans">
                    <span className="font-bold text-slate-800 dark:text-slate-200">{log.actor_name}</span>
                    <span className="text-[10px] text-slate-400 ml-1.5 uppercase font-mono">({log.actor_role})</span>
                  </td>
                  <td className="font-sans text-slate-400 capitalize">{log.target_entity}</td>
                  <td className="font-mono text-sky-400 text-[11px]">{log.entity_id}</td>
                  <td className="text-slate-500 text-[11px] font-mono">{log.timestamp.substring(11, 19)}</td>
                  <td className="font-sans text-slate-400 max-w-xs truncate">
                    {JSON.stringify(log.details)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invite Modal */}
      {inviteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Provision New Enterprise User
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Associate role credentials and assign to authorized distribution warehouse.
            </p>

            <form onSubmit={handleInviteSubmit} className="space-y-4 mt-4 text-xs">
              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rachel Adams"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Corporate Email</label>
                <input
                  type="email"
                  required
                  placeholder="rachel.adams@stockpilot.ai"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Assigned Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as RoleType)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="operator">Warehouse Operator</option>
                  <option value="warehouse_manager">Warehouse Manager</option>
                  <option value="distributor">Distributor</option>
                  <option value="supply_chain_manager">Supply Chain Manager</option>
                  <option value="org_admin">Organization Admin</option>
                </select>
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Warehouse Assignment</label>
                <select
                  value={inviteWarehouse}
                  onChange={(e) => setInviteWarehouse(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name} ({w.city})</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setInviteModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-md shadow-indigo-600/30"
                >
                  Confirm Provisioning
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
