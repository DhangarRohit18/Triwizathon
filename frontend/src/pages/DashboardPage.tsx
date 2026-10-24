import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { api } from '../services/api';
import { Warehouse, Destination, InventoryItem, IoTAlert, Transfer, InventoryMovement } from '../types';
import { KPICard } from '../components/KPICard';
import { NetworkMap } from '../components/NetworkMap';
import { 
  Boxes, 
  Cpu, 
  TrendingUp, 
  ThermometerSnowflake, 
  AlertTriangle, 
  ArrowRightLeft, 
  CheckCircle2, 
  Truck, 
  ShieldAlert, 
  QrCode, 
  FileText, 
  PlusCircle,
  PackageCheck,
  Send,
  RefreshCw,
  Users
} from 'lucide-react';
import { Link } from 'react-router-dom';

export const DashboardPage: React.FC = () => {
  const { activeRole, selectedWarehouseId, addToast } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [alerts, setAlerts] = useState<IoTAlert[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);

  // Modals
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState('operator');
  const [inviteWarehouse, setInviteWarehouse] = useState('wh_chicago_01');

  const loadData = async () => {
    setLoading(true);
    try {
      const [whData, dstData, invData, altData, trfData, movData] = await Promise.all([
        api.warehouses.list(),
        api.warehouses.listDestinations(),
        api.inventory.list({ warehouse_id: selectedWarehouseId }),
        api.iot.getAlerts(),
        api.transfers.list(),
        api.inventory.listMovements(15),
      ]);
      setWarehouses(whData);
      setDestinations(dstData);
      setInventory(invData);
      setAlerts(altData);
      setTransfers(trfData);
      setMovements(movData);
    } catch (err: any) {
      addToast({ type: 'error', title: 'Data sync error', message: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedWarehouseId]);

  const handleToggleDisruption = async (warehouseId: string) => {
    try {
      const updated = await api.warehouses.toggleOperational(warehouseId);
      addToast({
        type: updated.is_operational ? 'success' : 'warning',
        title: `Warehouse Status: ${updated.code}`,
        message: `${updated.name} is now ${updated.is_operational ? 'OPERATIONAL' : 'DISRUPTED / OFFLINE'}.`
      });
      loadData();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Action failed', message: err.message });
    }
  };

  const handleApproveTransfer = async (transferId: string, approved: boolean) => {
    try {
      await api.transfers.approveOrReject({ transfer_id: transferId, approved, notes: 'Reviewed on Dashboard' });
      addToast({
        type: approved ? 'success' : 'info',
        title: approved ? 'Transfer Approved' : 'Transfer Rejected',
        message: `Transfer ID ${transferId} has been updated.`
      });
      loadData();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Approval error', message: err.message });
    }
  };

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.auth.inviteUser({
        email: inviteEmail,
        full_name: inviteName,
        role: inviteRole,
        warehouse_id: inviteWarehouse,
      });
      addToast({
        type: 'success',
        title: 'User Invitation Dispatched',
        message: `${inviteName} invited as ${inviteRole}.`
      });
      setInviteModalOpen(false);
      setInviteEmail('');
      setInviteName('');
    } catch (err: any) {
      addToast({ type: 'error', title: 'Invitation error', message: err.message });
    }
  };

  // Metrics calculations
  const totalUnits = inventory.reduce((sum, item) => sum + item.available_quantity, 0);
  const lowStockItems = inventory.filter((item) => item.available_quantity <= item.safety_stock);
  const pendingTransfers = transfers.filter((t) => t.status === 'pending');
  const criticalAlerts = alerts.filter((a) => !a.acknowledged && a.severity === 'critical');

  return (
    <div className="space-y-6">
      {/* Role Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900/90 to-slate-800 border border-slate-800 text-white shadow-xl">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-sky-400">
              Active Operational Persona
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 font-mono font-bold capitalize">
              {activeRole.replace('_', ' ')}
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight mt-1">
            {activeRole === 'super_admin' && 'Enterprise Platform Health & Tenant Administration'}
            {activeRole === 'org_admin' && 'Organization Governance, Products & Logistics Hubs'}
            {activeRole === 'supply_chain_manager' && 'Distribution Intelligence & Network Optimization'}
            {activeRole === 'warehouse_manager' && 'Hub Storage, Cold-Chain Telemetry & Expiry Control'}
            {activeRole === 'distributor' && 'Regional Dispatch Fulfillment & Delivery Logs'}
            {activeRole === 'operator' && 'Floor Operations, Scanning & Stock Transactions'}
          </h1>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl">
            {activeRole === 'super_admin' && 'Monitor tenant isolation, operational errors, and global infrastructure health across all distributed instances.'}
            {activeRole === 'org_admin' && 'Manage catalog items, invite warehouse operators, configure safety policies, and inspect cross-hub performance.'}
            {activeRole === 'supply_chain_manager' && 'Simulate network disruptions, run Google OR-Tools MIP solver, and minimize transport shortage penalties.'}
            {activeRole === 'warehouse_manager' && 'Supervise incoming cold-chain shipments, approve replenishment transfers, and resolve sensor temperature excursions.'}
            {activeRole === 'distributor' && 'Track outbound deliveries to hospital networks, verify custody transfers, and record logistical exceptions.'}
            {activeRole === 'operator' && 'Execute atomic stock receipts, pick-and-pack fulfillment orders, and generate batch QR labels.'}
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {activeRole === 'org_admin' && (
            <button
              onClick={() => setInviteModalOpen(true)}
              className="px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs shadow-md shadow-sky-600/30 flex items-center gap-2 transition-all"
            >
              <PlusCircle className="w-4 h-4" />
              Invite Operator
            </button>
          )}

          {activeRole === 'supply_chain_manager' && (
            <Link
              to="/optimizer"
              className="px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs shadow-md shadow-sky-600/30 flex items-center gap-2 transition-all"
            >
              <Cpu className="w-4 h-4" />
              Launch Optimizer
            </Link>
          )}

          {activeRole === 'operator' && (
            <Link
              to="/qr"
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-md shadow-emerald-600/30 flex items-center gap-2 transition-all"
            >
              <QrCode className="w-4 h-4" />
              Open QR Scanner
            </Link>
          )}

          <button
            onClick={loadData}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title="Refresh database records"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Top Operational KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total Available Stock"
          value={totalUnits.toLocaleString()}
          subtitle={`${inventory.length} distinct product SKUs`}
          icon={Boxes}
          badge="Live"
        />
        <KPICard
          title="Stockout Risk SKUs"
          value={lowStockItems.length}
          subtitle="At or below safety stock threshold"
          change={lowStockItems.length > 0 ? "Caution" : "Optimal"}
          isPositive={lowStockItems.length === 0}
          icon={AlertTriangle}
        />
        <KPICard
          title="Pending Transfers"
          value={pendingTransfers.length}
          subtitle="Awaiting manager sign-off"
          icon={ArrowRightLeft}
          badge={pendingTransfers.length > 0 ? "Action Req" : undefined}
        />
        <KPICard
          title="IoT Cold-Chain Alerts"
          value={criticalAlerts.length}
          subtitle={`${alerts.filter(a => !a.acknowledged).length} unacknowledged total`}
          change={criticalAlerts.length > 0 ? "Breach" : "Nominal"}
          isPositive={criticalAlerts.length === 0}
          icon={ThermometerSnowflake}
        />
      </div>

      {/* Interactive Multi-Warehouse Distribution Map */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
              Live Logistics Network & Routing Topography
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Click any warehouse hub node to inspect storage capacity, or simulate regional disruptions.
            </p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
            {warehouses.filter(w => w.is_operational).length} / {warehouses.length} Hubs Operational
          </span>
        </div>

        <NetworkMap
          warehouses={warehouses}
          destinations={destinations}
          activeAllocations={[]}
          onToggleDisruption={handleToggleDisruption}
        />
      </div>

      {/* Operational Split: Pending Approvals & Real-Time Immutable Movement Ledger */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending Transfer Approval Requests */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-sky-500" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">
                Inter-Warehouse Transfers
              </h3>
            </div>
            <span className="text-xs font-mono font-bold text-slate-500">
              {pendingTransfers.length} Pending
            </span>
          </div>

          {pendingTransfers.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
              ✓ No pending inter-warehouse transfers require approval.
            </div>
          ) : (
            <div className="space-y-3">
              {pendingTransfers.slice(0, 4).map((trf) => (
                <div
                  key={trf.id}
                  className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-between gap-4"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-sky-400">{trf.transfer_number}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-bold">
                        PENDING
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mt-1">
                      {trf.source_warehouse_name} ➔ {trf.target_warehouse_name}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {trf.items.length} product(s) • Est. Freight: ${trf.estimated_transport_cost.toFixed(2)}
                    </div>
                  </div>

                  {['super_admin', 'org_admin', 'supply_chain_manager', 'warehouse_manager'].includes(activeRole) && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleApproveTransfer(trf.id, true)}
                        className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleApproveTransfer(trf.id, false)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-700 hover:bg-rose-600 text-slate-200 hover:text-white text-xs font-bold transition-colors"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Real-time Movement Ledger */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-emerald-500" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">
                Immutable Transaction Ledger
              </h3>
            </div>
            <Link to="/inventory" className="text-xs font-semibold text-sky-400 hover:underline">
              View All ➔
            </Link>
          </div>

          <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
            {movements.slice(0, 5).map((mov) => (
              <div
                key={mov.id}
                className="p-3 rounded-xl border border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-950/50 text-xs flex items-center justify-between gap-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      mov.movement_type === 'receipt'
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : mov.movement_type === 'dispatch'
                        ? 'bg-sky-500/10 text-sky-400'
                        : 'bg-amber-500/10 text-amber-400'
                    }`}>
                      {mov.movement_type.toUpperCase()}
                    </span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">{mov.product_name}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Actor: {mov.actor_name} • Reason: {mov.reason}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className={`font-mono-num font-bold text-xs ${mov.quantity_changed > 0 ? 'text-emerald-400' : 'text-slate-300'}`}>
                    {mov.quantity_changed > 0 ? `+${mov.quantity_changed}` : mov.quantity_changed}
                  </span>
                  <div className="text-[10px] text-slate-500">
                    Bal: {mov.balance_after}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Org Admin Operator Invitation Modal */}
      {inviteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Provision Enterprise User / Operator
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
                  placeholder="e.g. Alex Henderson"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Corporate Email</label>
                <input
                  type="email"
                  required
                  placeholder="alex.henderson@stockpilot.ai"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Assigned Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:border-sky-500 cursor-pointer"
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
                  className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:border-sky-500 cursor-pointer"
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
                  className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold shadow-md shadow-sky-600/30"
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
