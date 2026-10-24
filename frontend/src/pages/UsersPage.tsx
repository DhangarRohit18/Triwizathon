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
  RefreshCw,
  Edit2,
  Power,
  MapPin,
  X
} from 'lucide-react';

export const UsersPage: React.FC = () => {
  const { addToast, user: currentUser } = useAppStore();
  const [users, setUsers] = useState<User[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Invite Modal State
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<RoleType>('operator');
  const [inviteWarehouse, setInviteWarehouse] = useState('wh_chicago_01');
  const [inviteWarehouseScopes, setInviteWarehouseScopes] = useState<string[]>(['wh_chicago_01']);

  // Edit Modal State
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<RoleType>('operator');
  const [editWarehouseId, setEditWarehouseId] = useState('');
  const [editWarehouseScopes, setEditWarehouseScopes] = useState<string[]>([]);
  const [actionLoading, setActionLoading] = useState(false);

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
      if (whData.length > 0) {
        setInviteWarehouse(whData[0].id);
        setInviteWarehouseScopes([whData[0].id]);
      }
    } catch (err: any) {
      addToast({ type: 'error', title: 'User sync error', message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    try {
      await api.auth.inviteUser({
        full_name: inviteName,
        email: inviteEmail,
        role: inviteRole,
        warehouse_id: inviteWarehouse,
        warehouse_ids: inviteWarehouseScopes,
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
    } finally {
      setActionLoading(false);
    }
  };

  const openEditModal = (u: User) => {
    setEditingUser(u);
    setEditName(u.full_name);
    setEditRole(u.role);
    setEditWarehouseId(u.warehouse_id || (warehouses[0]?.id || ''));
    setEditWarehouseScopes(u.warehouse_ids && u.warehouse_ids.length > 0 ? u.warehouse_ids : (u.warehouse_id ? [u.warehouse_id] : []));
    setEditModalOpen(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setActionLoading(true);
    try {
      await api.auth.updateUser(editingUser.id, {
        full_name: editName,
        role: editRole,
        warehouse_id: editWarehouseId,
        warehouse_ids: editWarehouseScopes,
      });
      addToast({
        type: 'success',
        title: 'User Profile Updated',
        message: `Updated permissions and assignments for ${editName}.`
      });
      setEditModalOpen(false);
      setEditingUser(null);
      loadData();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Update failed', message: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleActive = async (u: User) => {
    try {
      await api.auth.toggleUserActive(u.id);
      addToast({
        type: 'success',
        title: 'Account Status Updated',
        message: `${u.full_name} is now ${u.is_active ? 'deactivated' : 'activated'}.`
      });
      loadData();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Status toggle failed', message: err.message });
    }
  };

  const toggleInviteScope = (whId: string) => {
    setInviteWarehouseScopes(prev => 
      prev.includes(whId) ? (prev.length > 1 ? prev.filter(id => id !== whId) : prev) : [...prev, whId]
    );
  };

  const toggleEditScope = (whId: string) => {
    setEditWarehouseScopes(prev => 
      prev.includes(whId) ? (prev.length > 1 ? prev.filter(id => id !== whId) : prev) : [...prev, whId]
    );
  };

  const filteredUsers = users.filter(u => 
    u.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.role.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-white border border-[#17324D]/15 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-widest text-[#0D9488]">
              Identity & Access Governance
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-[#0D9488]/10 text-[#0D9488] font-mono font-bold border border-[#0D9488]/30">
              6-Role RBAC & Location Scopes
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-[#17324D] tracking-tight mt-1">
            User Administration & Security Audit Trails
          </h1>
          <p className="text-xs text-[#17324D]/60 mt-1 max-w-2xl">
            Enforces server-side role authorizations and warehouse location scoping. Administrators manage user roles, location assignments, activation states, and audit logs.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={() => setInviteModalOpen(true)}
            className="px-4 py-2 rounded-xl bg-[#0D9488] hover:bg-[#0D9488]/90 text-white font-bold text-xs shadow-sm flex items-center gap-2 transition-all cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            Provision User
          </button>
          <button
            onClick={loadData}
            title="Refresh Directory"
            className="p-2 rounded-xl border border-[#17324D]/15 bg-white hover:bg-[#17324D]/5 text-[#17324D] transition-all cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-[#0D9488]' : ''}`} />
          </button>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Active Users"
          value={users.filter(u => u.is_active).length}
          subtitle={`Total provisioned: ${users.length}`}
          icon={Users}
        />
        <KPICard
          title="Location Isolation"
          value="ENFORCED"
          subtitle="Warehouse & Org Scoped"
          isPositive={true}
          icon={Building2}
          badge="Acuity BioLogistics"
        />
        <KPICard
          title="Security Audit Events"
          value={auditLogs.length}
          subtitle="Immutable event ledger"
          icon={FileCheck2}
        />
        <KPICard
          title="Privilege Boundaries"
          value="STRICT"
          subtitle="Server-validated checks"
          icon={Lock}
          badge="Zero Trust"
        />
      </div>

      {/* User Directory Table */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#17324D]">
              Authorized Personnel Directory ({filteredUsers.length})
            </h3>
            <p className="text-[11px] text-[#17324D]/60">
              Users have access strictly scoped to assigned warehouses and permitted feature endpoints.
            </p>
          </div>

          <div className="relative w-64">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, email, or role..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl bg-white border border-[#17324D]/20 text-[#17324D] focus:outline-none focus:border-[#0D9488]"
            />
            <Search className="w-3.5 h-3.5 text-[#17324D]/40 absolute left-2.5 top-2.5" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs table-dense">
            <thead>
              <tr className="border-b border-[#17324D]/15 text-[#17324D]/60 uppercase tracking-wider text-[11px]">
                <th>User / Identity</th>
                <th>Role Tier</th>
                <th>Location Scopes</th>
                <th>Contact</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#17324D]/10 font-mono-num">
              {filteredUsers.map((u) => {
                const assignedWh = warehouses.find(w => w.id === u.warehouse_id);
                const assignedWhList = (u.warehouse_ids || (u.warehouse_id ? [u.warehouse_id] : []))
                  .map(id => warehouses.find(w => w.id === id)?.name || id);

                return (
                  <tr key={u.id} className="hover:bg-[#17324D]/5 transition-colors">
                    <td>
                      <div className="font-bold text-[#17324D] font-sans">
                        {u.full_name}
                      </div>
                      <span className="text-[11px] text-[#17324D]/50 font-mono font-normal">
                        {u.email}
                      </span>
                    </td>
                    <td>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded font-sans uppercase bg-[#0D9488]/10 text-[#0D9488] border border-[#0D9488]/30">
                        {u.role.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="text-[#17324D] font-sans max-w-xs">
                      {assignedWhList.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {assignedWhList.map((whName, i) => (
                            <span key={i} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[#17324D]/5 text-[#17324D] border border-[#17324D]/15">
                              <MapPin className="w-2.5 h-2.5 text-[#17324D]/40" />
                              {whName}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[#17324D]/40 italic text-[11px]">Network Global (All)</span>
                      )}
                    </td>
                    <td className="text-[#17324D]/60 font-mono text-[11px]">
                      {u.phone_number || '—'}
                    </td>
                    <td>
                      {u.is_active ? (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded font-sans bg-[#0D9488]/10 text-[#0D9488] border border-[#0D9488]/30">
                          ACTIVE
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded font-sans bg-[#17324D]/10 text-[#17324D] border border-[#17324D]/30">
                          INACTIVE
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => openEditModal(u)}
                          className="px-2 py-1 rounded-md text-[11px] font-medium border border-[#17324D]/15 hover:border-[#0D9488] hover:bg-[#0D9488]/10 text-[#17324D] flex items-center gap-1 transition-all cursor-pointer"
                          title="Edit Permissions & Warehouses"
                        >
                          <Edit2 className="w-3 h-3 text-[#17324D]/40" />
                          Edit
                        </button>
                        <button
                          onClick={() => handleToggleActive(u)}
                          disabled={currentUser?.id === u.id}
                          className={`px-2 py-1 rounded-md text-[11px] font-medium border flex items-center gap-1 transition-all cursor-pointer ${
                            currentUser?.id === u.id 
                              ? 'opacity-40 cursor-not-allowed border-[#17324D]/15 text-[#17324D]/40' 
                              : u.is_active 
                                ? 'border-[#17324D]/25 hover:bg-[#17324D]/10 text-[#17324D]' 
                                : 'border-[#0D9488]/35 hover:bg-[#0D9488]/10 text-[#0D9488]'
                          }`}
                          title={currentUser?.id === u.id ? 'Cannot deactivate self' : (u.is_active ? 'Deactivate Account' : 'Activate Account')}
                        >
                          <Power className="w-3 h-3" />
                          {u.is_active ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Security Audit Ledger */}
      <div className="rounded-2xl border border-[#17324D]/15 bg-white p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#17324D]">
              Immutable Security & Compliance Audit Trail ({auditLogs.length} Events)
            </h3>
            <p className="text-[11px] text-[#17324D]/60">
              Every sensitive operation (user updates, activations, transfer approvals, large stock adjustments) is permanently recorded with actor identity and timestamp.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[350px]">
          <table className="w-full text-left text-xs table-dense">
            <thead>
              <tr className="border-b border-[#17324D]/15 text-[#17324D]/60 uppercase tracking-wider text-[11px]">
                <th>Action</th>
                <th>Actor Identity</th>
                <th>Target Entity</th>
                <th>Entity ID</th>
                <th>Timestamp</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#17324D]/10 font-mono-num">
              {auditLogs.map((log) => (
                <tr key={log.id} className="hover:bg-[#17324D]/5 transition-colors">
                  <td>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded font-mono bg-[#0D9488]/10 text-[#0D9488] border border-[#0D9488]/30">
                      {log.action}
                    </span>
                  </td>
                  <td className="font-sans">
                    <span className="font-bold text-[#17324D]">{log.actor_name}</span>
                    <span className="text-[10px] text-[#17324D]/50 ml-1.5 uppercase font-mono">({log.actor_role})</span>
                  </td>
                  <td className="font-sans text-[#17324D]/70 capitalize">{log.target_entity}</td>
                  <td className="font-mono text-[#0D9488] text-[11px]">{log.entity_id}</td>
                  <td className="text-[#17324D]/60 text-[11px] font-mono">{log.timestamp ? log.timestamp.substring(11, 19) : '—'}</td>
                  <td className="font-sans text-[#17324D]/70 max-w-xs truncate text-[11px]">
                    {typeof log.details === 'object' ? JSON.stringify(log.details) : String(log.details || '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit User Modal */}
      {editModalOpen && editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#17324D]/40 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-white border border-[#17324D]/15 p-6 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#17324D]/10">
              <div>
                <h3 className="text-base font-bold text-[#17324D]">
                  Edit Role & Location Access
                </h3>
                <p className="text-xs text-[#17324D]/60 mt-0.5">
                  Update permissions for {editingUser.email}
                </p>
              </div>
              <button 
                onClick={() => setEditModalOpen(false)}
                className="p-1 rounded-lg text-[#17324D]/40 hover:text-[#17324D] hover:bg-[#17324D]/5 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-4 mt-4 text-xs">
              <div>
                <label className="font-bold text-[#17324D] block mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#17324D]/20 text-[#17324D] focus:outline-none focus:border-[#0D9488]"
                />
              </div>

              <div>
                <label className="font-bold text-[#17324D] block mb-1">Assigned Role Tier</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as RoleType)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#17324D]/20 text-[#17324D] focus:outline-none focus:border-[#0D9488] cursor-pointer"
                >
                  <option value="operator">Warehouse Operator</option>
                  <option value="warehouse_manager">Warehouse Manager</option>
                  <option value="distributor">Distributor / Field Operator</option>
                  <option value="supply_chain_manager">Supply Chain Manager</option>
                  <option value="org_admin">Organization Admin</option>
                  {currentUser?.role === 'super_admin' && (
                    <option value="super_admin">Super Admin</option>
                  )}
                </select>
                <p className="text-[11px] text-[#17324D]/50 mt-1">
                  Server strictly enforces permission boundaries corresponding to this role tier.
                </p>
              </div>

              <div>
                <label className="font-bold text-[#17324D] block mb-1">Primary Warehouse</label>
                <select
                  value={editWarehouseId}
                  onChange={(e) => setEditWarehouseId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#17324D]/20 text-[#17324D] focus:outline-none focus:border-[#0D9488] cursor-pointer"
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name} ({w.city})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-bold text-[#17324D] block mb-1">Permitted Warehouse Scopes</label>
                <div className="grid grid-cols-1 gap-1.5 p-2 rounded-lg border border-[#17324D]/15 bg-[#17324D]/5 max-h-36 overflow-y-auto">
                  {warehouses.map((w) => {
                    const checked = editWarehouseScopes.includes(w.id);
                    return (
                      <label key={w.id} className="flex items-center gap-2 text-[11px] text-[#17324D] cursor-pointer hover:bg-white p-1 rounded">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleEditScope(w.id)}
                          className="rounded accent-[#0D9488] focus:ring-0 cursor-pointer"
                        />
                        <span>{w.name} ({w.city})</span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-[11px] text-[#17324D]/50 mt-1">
                  Users can only inspect and transact stock within their permitted scopes.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#17324D]/10">
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-[#17324D]/10 text-[#17324D] font-semibold cursor-pointer hover:bg-[#17324D]/15"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 rounded-lg bg-[#0D9488] hover:bg-[#0D9488]/90 text-white font-semibold shadow-sm transition-all cursor-pointer"
                >
                  {actionLoading ? 'Saving...' : 'Save Permissions'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invite Modal */}
      {inviteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#17324D]/40 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-white border border-[#17324D]/15 p-6 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#17324D]/10">
              <div>
                <h3 className="text-base font-bold text-[#17324D]">
                  Provision New Enterprise User
                </h3>
                <p className="text-xs text-[#17324D]/60 mt-0.5">
                  Assign role credentials and permitted warehouse locations.
                </p>
              </div>
              <button 
                onClick={() => setInviteModalOpen(false)}
                className="p-1 rounded-lg text-[#17324D]/40 hover:text-[#17324D] hover:bg-[#17324D]/5 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleInviteSubmit} className="space-y-4 mt-4 text-xs">
              <div>
                <label className="font-bold text-[#17324D] block mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rachel Adams"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#17324D]/20 text-[#17324D] focus:outline-none focus:border-[#0D9488]"
                />
              </div>

              <div>
                <label className="font-bold text-[#17324D] block mb-1">Corporate Email</label>
                <input
                  type="email"
                  required
                  placeholder="rachel.adams@stockpilot.ai"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#17324D]/20 text-[#17324D] focus:outline-none focus:border-[#0D9488]"
                />
              </div>

              <div>
                <label className="font-bold text-[#17324D] block mb-1">Assigned Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as RoleType)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#17324D]/20 text-[#17324D] focus:outline-none focus:border-[#0D9488] cursor-pointer"
                >
                  <option value="operator">Warehouse Operator</option>
                  <option value="warehouse_manager">Warehouse Manager</option>
                  <option value="distributor">Distributor / Field Operator</option>
                  <option value="supply_chain_manager">Supply Chain Manager</option>
                  <option value="org_admin">Organization Admin</option>
                </select>
              </div>

              <div>
                <label className="font-bold text-[#17324D] block mb-1">Primary Warehouse</label>
                <select
                  value={inviteWarehouse}
                  onChange={(e) => setInviteWarehouse(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#17324D]/20 text-[#17324D] focus:outline-none focus:border-[#0D9488] cursor-pointer"
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name} ({w.city})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-bold text-[#17324D] block mb-1">Authorized Warehouse Scopes</label>
                <div className="grid grid-cols-1 gap-1.5 p-2 rounded-lg border border-[#17324D]/15 bg-[#17324D]/5 max-h-36 overflow-y-auto">
                  {warehouses.map((w) => {
                    const checked = inviteWarehouseScopes.includes(w.id);
                    return (
                      <label key={w.id} className="flex items-center gap-2 text-[11px] text-[#17324D] cursor-pointer hover:bg-white p-1 rounded">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleInviteScope(w.id)}
                          className="rounded accent-[#0D9488] focus:ring-0 cursor-pointer"
                        />
                        <span>{w.name} ({w.city})</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#17324D]/10">
                <button
                  type="button"
                  onClick={() => setInviteModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-[#17324D]/10 text-[#17324D] font-semibold cursor-pointer hover:bg-[#17324D]/15"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 rounded-lg bg-[#0D9488] hover:bg-[#0D9488]/90 text-white font-semibold shadow-sm transition-all cursor-pointer"
                >
                  {actionLoading ? 'Provisioning...' : 'Confirm Provisioning'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
