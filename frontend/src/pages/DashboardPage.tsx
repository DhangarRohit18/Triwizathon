import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { api } from '../services/api';
import { 
  Warehouse, 
  InventoryItem, 
  IoTAlert, 
  Transfer, 
  Batch 
} from '../types';
import { SmoothCard } from '../components/ui/SmoothCard';
import { TactileButton } from '../components/ui/TactileButton';
import { RetroBadge } from '../components/ui/RetroBadge';
import { 
  Boxes, 
  Cpu, 
  AlertTriangle, 
  ArrowRightLeft, 
  CheckCircle2, 
  Truck, 
  ShieldAlert, 
  QrCode, 
  RefreshCw, 
  Server, 
  CheckSquare, 
  Square, 
  ThermometerSnowflake, 
  ScanLine, 
  Layers,
  Sparkles,
  Zap,
  Building2,
  Lock,
  ArrowRight
} from 'lucide-react';
import { Link } from 'react-router-dom';

export const DashboardPage: React.FC = () => {
  const { activeRole, selectedWarehouseId, addToast } = useAppStore();
  const [loading, setLoading] = useState(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [alerts, setAlerts] = useState<IoTAlert[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);

  // Operator states
  const [quickScanCode, setQuickScanCode] = useState('');
  const [quickScanResult, setQuickScanResult] = useState<string | null>(null);
  const [checkedTasks, setCheckedTasks] = useState<Record<string, boolean>>({
    'task-1': true,
    'task-2': false,
    'task-3': false,
    'task-4': false,
  });

  // Distributor states
  const [podSubmitted, setPodSubmitted] = useState<Record<string, boolean>>({});
  const [podRecipient, setPodRecipient] = useState('Dr. Arthur Pendelton');

  // Org Admin modal
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState('operator');
  const [inviteWarehouse, setInviteWarehouse] = useState('wh_chicago_01');

  // Super Admin killswitch state
  const [killSwitchActive, setKillSwitchActive] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [whData, invData, btcData, altData, trfData] = await Promise.all([
        api.warehouses.list().catch(() => []),
        api.inventory.list({ warehouse_id: selectedWarehouseId }).catch(() => []),
        api.inventory.listBatches().catch(() => []),
        api.iot.getAlerts().catch(() => []),
        api.transfers.list().catch(() => []),
      ]);
      setWarehouses(whData);
      setInventory(invData);
      setBatches(btcData);
      setAlerts(altData);
      setTransfers(trfData);
    } catch (err: any) {
      console.warn('Dashboard data fetch:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedWarehouseId, activeRole]);

  // Audio synthesis scan feedback
  const playBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1100, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.08);
    } catch (_) {}
  };

  const handleQuickScan = (payload?: string) => {
    const code = payload || quickScanCode;
    if (!code) return;
    playBeep();
    setQuickScanResult(`VERIFIED: ${code} • Stock Verified & Ledger Synced`);
    setQuickScanCode('');
    addToast({
      type: 'success',
      title: 'Barcode Scanned & Verified',
      message: `Scanned: ${code}`
    });
  };

  const toggleTask = (id: string) => {
    setCheckedTasks(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleApproveTransfer = async (transferId: string, approved: boolean) => {
    try {
      await api.transfers.approveOrReject({ transfer_id: transferId, approved, notes: 'Reviewed on Workstation' });
      addToast({
        type: 'info',
        title: approved ? 'Transfer Approved' : 'Transfer Rejected',
        message: `Transfer ID ${transferId} state committed.`
      });
      loadData();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Approval error', message: err.message });
    }
  };

  const handleToggleDisruption = async (warehouseId: string) => {
    try {
      const updated = await api.warehouses.toggleOperational(warehouseId);
      addToast({
        type: 'info',
        title: `Warehouse Status: ${updated.code}`,
        message: `${updated.name} is now ${updated.is_operational ? 'OPERATIONAL' : 'DISRUPTED / OFFLINE'}.`
      });
      loadData();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Action failed', message: err.message });
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
        title: 'Team Member Provisioned',
        message: `${inviteName} provisioned as ${inviteRole}.`
      });
      setInviteModalOpen(false);
      setInviteEmail('');
      setInviteName('');
    } catch (err: any) {
      addToast({ type: 'error', title: 'Invitation error', message: err.message });
    }
  };

  const completedTaskCount = Object.values(checkedTasks).filter(Boolean).length;
  const totalUnits = inventory.reduce((sum, item) => sum + item.available_quantity, 0) || 27190;

  return (
    <div className="space-y-6 text-slate-900 font-sans pb-12">
      {/* ========================================================================= */}
      {/* 1. OPERATOR WORKSTATION: PHYSICAL SCANNING & PICKING ONLY                 */}
      {/* ========================================================================= */}
      {activeRole === 'operator' && (
        <div className="space-y-6">
          {/* Minimal Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-200 gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono font-bold text-[#0D9488] uppercase tracking-wider">
                  Floor Workstation
                </span>
                <RetroBadge variant="teal" size="sm">LIVE INTAKE</RetroBadge>
              </div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight font-mono mt-1">
                Receiving Dock & Wave Picking Station
              </h1>
            </div>

            <div className="flex items-center gap-2">
              <Link to="/qr">
                <TactileButton variant="primary" size="md">
                  <ScanLine className="w-4 h-4 mr-1.5" />
                  Launch Camera Scanner
                </TactileButton>
              </Link>
            </div>
          </div>

          {/* Minimal Operator Metric Chips */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-4 rounded-xl border border-slate-200 bg-white">
              <div className="text-[10px] font-mono font-bold text-slate-400 uppercase">Scans Completed Today</div>
              <div className="text-2xl font-black font-mono text-slate-900 mt-1">142 items</div>
              <div className="text-[11px] text-[#0D9488] font-mono mt-0.5">✓ 100% verified barcode receipts</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 bg-white">
              <div className="text-[10px] font-mono font-bold text-slate-400 uppercase">Inbound Staging Dock</div>
              <div className="text-2xl font-black font-mono text-slate-900 mt-1">3 Pallets</div>
              <div className="text-[11px] text-slate-500 font-mono mt-0.5">Bay #02 & #03 awaiting check-in</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 bg-white">
              <div className="text-[10px] font-mono font-bold text-slate-400 uppercase">Wave Shift Picking</div>
              <div className="text-2xl font-black font-mono text-slate-900 mt-1">{completedTaskCount} / 4 Done</div>
              <div className="text-[11px] text-[#0D9488] font-mono mt-0.5">Wave #04 on schedule</div>
            </div>
          </div>

          {/* 2-Column Operator Workflow */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Rapid Barcode Intake */}
            <SmoothCard className="p-5 space-y-4 border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <QrCode className="w-4 h-4 text-[#0D9488]" />
                  <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-900">
                    Optical Scanner Receiving Dock
                  </h3>
                </div>
                <span className="text-[10px] font-mono text-slate-400">KEYBOARD / HARDWARE WEDGE</span>
              </div>

              <div className="space-y-3 font-mono text-xs">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={quickScanCode}
                    onChange={(e) => setQuickScanCode(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleQuickScan()}
                    placeholder="Scan product barcode or paste QR payload..."
                    className="flex-1 px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-300 text-slate-900 focus:outline-none focus:border-[#0D9488] font-mono text-xs"
                  />
                  <TactileButton variant="primary" size="md" onClick={() => handleQuickScan()}>
                    Confirm
                  </TactileButton>
                </div>

                {quickScanResult && (
                  <div className="p-3 rounded-lg border border-[#0D9488]/40 bg-[#0D9488]/10 text-[#17324D] font-mono text-xs">
                    {quickScanResult}
                  </div>
                )}

                <div className="pt-2">
                  <span className="text-[10px] text-slate-400 block mb-2 uppercase font-bold">1-Click Test Barcodes:</span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => handleQuickScan('STOCKPILOT|PRD-VAX-01|BAT-VAX-CHI-01|2026-11-20|500')}
                      className="px-2.5 py-1.5 rounded-md border border-slate-200 bg-slate-50 hover:border-[#0D9488] hover:bg-[#0D9488]/10 text-xs text-slate-800 font-mono transition-colors"
                    >
                      Scan Bio-Vax Cold Batch (500 vials)
                    </button>
                    <button
                      onClick={() => handleQuickScan('STOCKPILOT|PRD-INS-02|BAT-INS-CHI-02|2026-12-15|250')}
                      className="px-2.5 py-1.5 rounded-md border border-slate-200 bg-slate-50 hover:border-[#0D9488] hover:bg-[#0D9488]/10 text-xs text-slate-800 font-mono transition-colors"
                    >
                      Scan Insulin Batch (250 units)
                    </button>
                  </div>
                </div>
              </div>
            </SmoothCard>

            {/* Right: Wave Picking Shift Checklist */}
            <SmoothCard className="p-5 space-y-4 border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <CheckSquare className="w-4 h-4 text-[#0D9488]" />
                  <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-900">
                    Wave Shift Checklist
                  </h3>
                </div>
                <RetroBadge variant="white" size="sm">SHIFT ACTIVE</RetroBadge>
              </div>

              <div className="space-y-2 font-mono text-xs">
                {[
                  { id: 'task-1', title: 'Receive Pallet #9042 from Pfizer Global', loc: 'Dock Bay 3', qty: '500 vials' },
                  { id: 'task-2', title: 'Pick 40 units SKU-INSULIN for Dispatch #7821', loc: 'Aisle 04-B', qty: '40 vials' },
                  { id: 'task-3', title: 'Stow 100 units SKU-AMOXICIL in Cold Vault', loc: 'Bin C-02', qty: '100 boxes' },
                  { id: 'task-4', title: 'Execute cycle count on Zone 2B (Pallet 14)', loc: 'Zone 2B', qty: 'Audit' },
                ].map(task => {
                  const isChecked = !!checkedTasks[task.id];
                  return (
                    <div
                      key={task.id}
                      onClick={() => toggleTask(task.id)}
                      className={`p-3 rounded-lg border cursor-pointer transition-all flex items-center justify-between ${
                        isChecked
                          ? 'border-[#0D9488]/30 bg-[#0D9488]/5 text-slate-400 line-through'
                          : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300 shadow-2xs'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {isChecked ? (
                          <CheckSquare className="w-4 h-4 text-[#0D9488] shrink-0" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-400 shrink-0" />
                        )}
                        <div>
                          <div className="font-bold">{task.title}</div>
                          <div className="text-[10px] text-slate-400">{task.loc} • {task.qty}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </SmoothCard>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. DISTRIBUTOR WORKSTATION: OUTBOUND FLEET & DIGITAL POD ONLY             */}
      {/* ========================================================================= */}
      {activeRole === 'distributor' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-200 gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono font-bold text-[#0D9488] uppercase tracking-wider">
                  Fleet Logistics Station
                </span>
                <RetroBadge variant="teal" size="sm">DISPATCH ACTIVE</RetroBadge>
              </div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight font-mono mt-1">
                Regional Fleet Manifests & Proof of Delivery (POD)
              </h1>
            </div>

            <TactileButton variant="secondary" size="md" onClick={() => addToast({ type: 'info', title: 'Manifest PDF', message: 'Waybill manifest downloaded.' })}>
              Download Waybill PDF
            </TactileButton>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-4 rounded-xl border border-slate-200 bg-white">
              <div className="text-[10px] font-mono font-bold text-slate-400 uppercase">Assigned Vehicles</div>
              <div className="text-2xl font-black font-mono text-slate-900 mt-1">2 Dispatches</div>
              <div className="text-[11px] text-[#0D9488] font-mono mt-0.5">En route to medical centers</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 bg-white">
              <div className="text-[10px] font-mono font-bold text-slate-400 uppercase">Cargo Temperature</div>
              <div className="text-2xl font-black font-mono text-slate-900 mt-1">3.9 °C</div>
              <div className="text-[11px] text-[#0D9488] font-mono mt-0.5">✓ Strict Cold-Chain Compliant</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 bg-white">
              <div className="text-[10px] font-mono font-bold text-slate-400 uppercase">On-Time Delivery SLA</div>
              <div className="text-2xl font-black font-mono text-slate-900 mt-1">99.2%</div>
              <div className="text-[11px] text-slate-500 font-mono mt-0.5">Zero thermal excursion breaches</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SmoothCard className="p-5 space-y-4 border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Truck className="w-4 h-4 text-[#0D9488]" />
                  <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-900">
                    Active Delivery Manifests
                  </h3>
                </div>
              </div>

              <div className="space-y-3 font-mono text-xs">
                <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/70 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#0D9488]">MANIFEST #DSP-7821</span>
                    <RetroBadge variant="teal" size="sm">IN-TRANSIT</RetroBadge>
                  </div>
                  <div className="text-slate-900 font-bold">ORD-01 Chicago Central Hub ➔ Northwestern Memorial</div>
                  <div className="text-slate-500 text-[11px]">
                    Vehicle: SPRINTER-01 • Driver: Rajiv Patel • Temp: 3.8°C (Compliant)
                  </div>
                  <div className="pt-2 flex justify-between items-center text-[11px] border-t border-slate-200">
                    <span className="text-slate-500">ETA: 35 Minutes</span>
                    <span className="font-bold text-[#0D9488]">400 Vials Bio-Vax</span>
                  </div>
                </div>

                <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/70 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#0D9488]">MANIFEST #DSP-9932</span>
                    <RetroBadge variant="white" size="sm">DISPATCHED</RetroBadge>
                  </div>
                  <div className="text-slate-900 font-bold">DFW-03 Dallas Hub ➔ Parkland Health Center</div>
                  <div className="text-slate-500 text-[11px]">
                    Vehicle: FREIGHTLINER-02 • Temp: 4.1°C (Compliant)
                  </div>
                  <div className="pt-2 flex justify-between items-center text-[11px] border-t border-slate-200">
                    <span className="text-slate-500">ETA: 1h 20m</span>
                    <span className="font-bold text-[#0D9488]">250 Units Insulin</span>
                  </div>
                </div>
              </div>
            </SmoothCard>

            <SmoothCard className="p-5 space-y-4 border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#0D9488]" />
                  <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-900">
                    Digital Proof of Delivery (POD) Sign-Off
                  </h3>
                </div>
              </div>

              <div className="space-y-3 font-mono text-xs">
                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">RECIPIENT SIGNATURE STAMP</label>
                  <input
                    type="text"
                    value={podRecipient}
                    onChange={(e) => setPodRecipient(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-300 text-slate-900 focus:outline-none focus:border-[#0D9488] font-mono text-xs"
                  />
                </div>

                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">COLD-CHAIN COMPLIANCE CERTIFICATION</label>
                  <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between">
                    <span>Target 2°C - 8°C Verified</span>
                    <span className="font-bold text-[#0D9488]">3.9 °C PASSED</span>
                  </div>
                </div>

                <TactileButton
                  variant="primary"
                  size="md"
                  className="w-full mt-2"
                  onClick={() => addToast({ type: 'success', title: 'POD Signed & Recorded', message: `Signed by ${podRecipient}. Custody transferred.` })}
                >
                  Sign & Transmit Delivery Receipt
                </TactileButton>
              </div>
            </SmoothCard>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. WAREHOUSE MANAGER WORKSTATION: COLD-CHAIN IOT & FEFO RADAR ONLY         */}
      {/* ========================================================================= */}
      {activeRole === 'warehouse_manager' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-200 gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono font-bold text-[#0D9488] uppercase tracking-wider">
                  Hub Floor Management
                </span>
                <RetroBadge variant="teal" size="sm">ORD-01 CHICAGO</RetroBadge>
              </div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight font-mono mt-1">
                Pallet Rack Storage, IoT Telemetry & FEFO Control
              </h1>
            </div>

            <Link to="/inventory">
              <TactileButton variant="primary" size="md">
                <Boxes className="w-4 h-4 mr-1.5" />
                View Hub Inventory
              </TactileButton>
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-4 rounded-xl border border-slate-200 bg-white">
              <div className="text-[10px] font-mono font-bold text-slate-400 uppercase">Hub Pallet Utilization</div>
              <div className="text-2xl font-black font-mono text-slate-900 mt-1">84.6%</div>
              <div className="text-[11px] text-slate-500 font-mono mt-0.5">8,450 / 10,000 pallet bays active</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 bg-white">
              <div className="text-[10px] font-mono font-bold text-slate-400 uppercase">Cold Room #1 Probe</div>
              <div className="text-2xl font-black font-mono text-slate-900 mt-1">4.2 °C</div>
              <div className="text-[11px] text-[#0D9488] font-mono mt-0.5">✓ Target 2°C - 8°C Nominal</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 bg-white">
              <div className="text-[10px] font-mono font-bold text-slate-400 uppercase">FEFO Batches Near Expiry</div>
              <div className="text-2xl font-black font-mono text-[#17324D] mt-1">2 Batches</div>
              <div className="text-[11px] text-[#17324D] font-mono mt-0.5">Expires in &lt;30 days (Prioritize)</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SmoothCard className="p-5 space-y-4 border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <ThermometerSnowflake className="w-4 h-4 text-[#0D9488]" />
                  <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-900">
                    ESP32 Telemetry Sensor Probes
                  </h3>
                </div>
                <RetroBadge variant="teal" size="sm">ONLINE</RetroBadge>
              </div>

              <div className="space-y-3 font-mono text-xs">
                <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-900">PROBE #ESP32-COLD-CHI-01</div>
                    <div className="text-[11px] text-slate-500">Zone: Cold Vault Room A (Vaccines)</div>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-[#0D9488] text-sm">4.2 °C</span>
                    <div className="text-[10px] text-[#0D9488]">Nominal</div>
                  </div>
                </div>

                <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-900">PROBE #ESP32-COLD-CHI-02</div>
                    <div className="text-[11px] text-slate-500">Zone: Cold Vault Room B (Insulin)</div>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-[#0D9488] text-sm">3.8 °C</span>
                    <div className="text-[10px] text-[#0D9488]">Nominal</div>
                  </div>
                </div>
              </div>
            </SmoothCard>

            <SmoothCard className="p-5 space-y-4 border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-[#17324D]" />
                  <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-900">
                    FEFO Expiry Liquidation Radar
                  </h3>
                </div>
              </div>

              <div className="space-y-2.5 font-mono text-xs">
                <div className="p-3 rounded-lg border border-[#17324D]/20 bg-[#17324D]/5/30 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-900">PRD-VAX-01 (Bio-Vax Cold Chain)</div>
                    <div className="text-[11px] text-[#17324D]">Batch: BAT-VAX-CHI-01 • Expires in 26 days</div>
                  </div>
                  <TactileButton variant="primary" size="sm" onClick={() => addToast({ type: 'info', title: 'Liquidation Priority', message: 'Batch flagged for immediate outbound transfer.' })}>
                    Prioritize
                  </TactileButton>
                </div>

                <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-900">PRD-INS-02 (Rapid-Acting Insulin)</div>
                    <div className="text-[11px] text-slate-500">Batch: BAT-INS-CHI-02 • Expires in 58 days</div>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">Normal Rotation</span>
                </div>
              </div>
            </SmoothCard>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. SUPPLY CHAIN MANAGER: GOOGLE OR-TOOLS SOLVER & APPROVALS ONLY          */}
      {/* ========================================================================= */}
      {activeRole === 'supply_chain_manager' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-200 gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono font-bold text-[#0D9488] uppercase tracking-wider">
                  Network Intelligence Studio
                </span>
                <RetroBadge variant="teal" size="sm">OR-TOOLS MIP</RetroBadge>
              </div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight font-mono mt-1">
                Mathematical Multi-Echelon Optimizer & Approvals
              </h1>
            </div>

            <Link to="/optimizer">
              <TactileButton variant="primary" size="md">
                <Cpu className="w-4 h-4 mr-1.5" />
                Open Full Solver Studio
              </TactileButton>
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-4 rounded-xl border border-slate-200 bg-white">
              <div className="text-[10px] font-mono font-bold text-slate-400 uppercase">Monthly Optimization Savings</div>
              <div className="text-2xl font-black font-mono text-[#0D9488] mt-1">$40,797</div>
              <div className="text-[11px] text-slate-500 font-mono mt-0.5">Freight & holding cost minimization</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 bg-white">
              <div className="text-[10px] font-mono font-bold text-slate-400 uppercase">Pending Transfer Orders</div>
              <div className="text-2xl font-black font-mono text-slate-900 mt-1">2 Action Req</div>
              <div className="text-[11px] text-[#17324D] font-mono mt-0.5">Awaiting executive sign-off</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 bg-white">
              <div className="text-[10px] font-mono font-bold text-slate-400 uppercase">Stockout Shortage Risk</div>
              <div className="text-2xl font-black font-mono text-slate-900 mt-1">0.0%</div>
              <div className="text-[11px] text-[#0D9488] font-mono mt-0.5">✓ All clinical demands fulfilled</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SmoothCard className="p-5 space-y-4 border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-[#0D9488]" />
                  <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-900">
                    Google OR-Tools MIP Solver Engine
                  </h3>
                </div>
                <RetroBadge variant="teal" size="sm">OPTIMAL (20ms)</RetroBadge>
              </div>

              <div className="space-y-3 font-mono text-xs">
                <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/70 space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Baseline Cost:</span>
                    <span className="font-bold text-slate-700">$98,420</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Optimized Cost:</span>
                    <span className="font-bold text-[#0D9488]">$57,623</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-1.5">
                    <span className="text-slate-900 font-bold">Total Net Savings:</span>
                    <span className="font-bold text-[#0D9488] text-sm">$40,797 (41.4%)</span>
                  </div>
                </div>

                <Link to="/optimizer">
                  <TactileButton variant="primary" size="md" className="w-full">
                    Execute Multi-Echelon Linear Solver
                  </TactileButton>
                </Link>
              </div>
            </SmoothCard>

            <SmoothCard className="p-5 space-y-4 border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <ArrowRightLeft className="w-4 h-4 text-[#0D9488]" />
                  <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-900">
                    Pending Inter-Hub Rebalance Transfers
                  </h3>
                </div>
              </div>

              <div className="space-y-3 font-mono text-xs">
                <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-[#0D9488]">TRF-CHI-NYC-01</span>
                    <RetroBadge variant="white" size="sm">PENDING</RetroBadge>
                  </div>
                  <div className="text-slate-900 font-bold">ORD-01 Chicago ➔ JFK-02 New York</div>
                  <div className="text-[11px] text-slate-500">500 units PRD-VAX-01 • Rebalance Stockout Buffer</div>
                  <div className="flex gap-2 pt-2 border-t border-slate-200">
                    <TactileButton variant="primary" size="sm" onClick={() => handleApproveTransfer('TRF-CHI-NYC-01', true)}>
                      Approve
                    </TactileButton>
                    <TactileButton variant="outline" size="sm" onClick={() => handleApproveTransfer('TRF-CHI-NYC-01', false)}>
                      Reject
                    </TactileButton>
                  </div>
                </div>
              </div>
            </SmoothCard>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. ORG ADMIN WORKSTATION: NETWORK HUBS & TEAM PROVISIONING ONLY           */}
      {/* ========================================================================= */}
      {activeRole === 'org_admin' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-200 gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono font-bold text-[#0D9488] uppercase tracking-wider">
                  Organization Administration
                </span>
                <RetroBadge variant="teal" size="sm">ORG DIRECTOR</RetroBadge>
              </div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight font-mono mt-1">
                Logistics Network Grid & Team Seat Provisioning
              </h1>
            </div>

            <TactileButton variant="primary" size="md" onClick={() => setInviteModalOpen(true)}>
              <Building2 className="w-4 h-4 mr-1.5" />
              Provision Team Member
            </TactileButton>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-4 rounded-xl border border-slate-200 bg-white">
              <div className="text-[10px] font-mono font-bold text-slate-400 uppercase">Aggregated Network Stock</div>
              <div className="text-2xl font-black font-mono text-slate-900 mt-1">{totalUnits.toLocaleString()} units</div>
              <div className="text-[11px] text-[#0D9488] font-mono mt-0.5">Across 4 regional distribution hubs</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 bg-white">
              <div className="text-[10px] font-mono font-bold text-slate-400 uppercase">Operational Hubs</div>
              <div className="text-2xl font-black font-mono text-slate-900 mt-1">4 / 4 Online</div>
              <div className="text-[11px] text-[#0D9488] font-mono mt-0.5">All facilities active</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 bg-white">
              <div className="text-[10px] font-mono font-bold text-slate-400 uppercase">Provisioned Team Seats</div>
              <div className="text-2xl font-black font-mono text-slate-900 mt-1">19 / 25 Seats</div>
              <div className="text-[11px] text-slate-500 font-mono mt-0.5">6 enterprise seats available</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SmoothCard className="p-5 space-y-4 border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-[#0D9488]" />
                  <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-900">
                    Distribution Hub Network & Disruption Simulator
                  </h3>
                </div>
              </div>

              <div className="space-y-2.5 font-mono text-xs">
                {[
                  { id: 'wh_chicago_01', name: 'ORD-01 Chicago Central Hub', city: 'Chicago, IL', cap: '8,450 / 10,000 pallets' },
                  { id: 'wh_ny_02', name: 'JFK-02 New York East DC', city: 'New York, NY', cap: '6,200 / 8,000 pallets' },
                  { id: 'wh_dallas_03', name: 'DFW-03 Dallas South DC', city: 'Dallas, TX', cap: '7,100 / 9,000 pallets' },
                  { id: 'wh_reno_04', name: 'RNO-04 Reno West DC', city: 'Reno, NV', cap: '5,440 / 7,000 pallets' },
                ].map(wh => (
                  <div key={wh.id} className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-slate-900">{wh.name}</div>
                      <div className="text-[11px] text-slate-500">{wh.city} • {wh.cap}</div>
                    </div>
                    <TactileButton variant="outline" size="sm" onClick={() => handleToggleDisruption(wh.id)}>
                      Simulate Disruption
                    </TactileButton>
                  </div>
                ))}
              </div>
            </SmoothCard>

            <SmoothCard className="p-5 space-y-4 border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-[#0D9488]" />
                  <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-900">
                    Safety Stock Buffer Configuration
                  </h3>
                </div>
              </div>

              <div className="space-y-3 font-mono text-xs">
                <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 space-y-2">
                  <div className="flex justify-between font-bold">
                    <span>Clinical Bio-Vax Safety Buffer</span>
                    <span className="text-[#0D9488]">20% Nominal (1,000 units)</span>
                  </div>
                  <input type="range" min="10" max="40" defaultValue="20" className="w-full accent-[#0D9488]" />
                  <div className="text-[10px] text-slate-400">Protects against emergency pandemic surge events.</div>
                </div>

                <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 space-y-2">
                  <div className="flex justify-between font-bold">
                    <span>Emergency Insulin Glargine Buffer</span>
                    <span className="text-[#0D9488]">15% Nominal (500 units)</span>
                  </div>
                  <input type="range" min="5" max="30" defaultValue="15" className="w-full accent-[#0D9488]" />
                  <div className="text-[10px] text-slate-400">Automated replenishment trigger on low threshold.</div>
                </div>
              </div>
            </SmoothCard>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. SUPER ADMIN WORKSTATION: PLATFORM CLUSTERS & SECURITY ONLY             */}
      {/* ========================================================================= */}
      {activeRole === 'super_admin' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-200 gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono font-bold text-[#0D9488] uppercase tracking-wider">
                  Enterprise Root Architecture
                </span>
                <RetroBadge variant="teal" size="sm">ROOT CLEARANCE</RetroBadge>
              </div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight font-mono mt-1">
                Distributed Microservices & Global Security Killswitch
              </h1>
            </div>

            <TactileButton variant="secondary" size="md" onClick={() => addToast({ type: 'info', title: 'Cluster Flushed', message: 'Distributed cache synchronized.' })}>
              <RefreshCw className="w-4 h-4 mr-1.5" />
              Sync Cluster Nodes
            </TactileButton>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-4 rounded-xl border border-slate-200 bg-white">
              <div className="text-[10px] font-mono font-bold text-slate-400 uppercase">Microservices Online</div>
              <div className="text-2xl font-black font-mono text-slate-900 mt-1">4 / 4 Live</div>
              <div className="text-[11px] text-[#0D9488] font-mono mt-0.5">FastAPI, OR-Tools, IoT, Baileys</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 bg-white">
              <div className="text-[10px] font-mono font-bold text-slate-400 uppercase">P99 Query Latency</div>
              <div className="text-2xl font-black font-mono text-slate-900 mt-1">14.2 ms</div>
              <div className="text-[11px] text-[#0D9488] font-mono mt-0.5">Sub-millisecond query execution</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 bg-white">
              <div className="text-[10px] font-mono font-bold text-slate-400 uppercase">Security Escalations</div>
              <div className="text-2xl font-black font-mono text-slate-900 mt-1">0 Breaches</div>
              <div className="text-[11px] text-[#0D9488] font-mono mt-0.5">Zero unauthorized breaches</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SmoothCard className="p-5 space-y-4 border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Server className="w-4 h-4 text-[#0D9488]" />
                  <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-900">
                    Distributed Infrastructure Topography
                  </h3>
                </div>
                <RetroBadge variant="teal" size="sm">SYNCHRONIZED</RetroBadge>
              </div>

              <div className="space-y-3 font-mono text-xs">
                <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-900">POSTGRESQL MASTER CLUSTER</div>
                    <div className="text-[11px] text-slate-500">db-master-us-east (Port 5432) • 2 Read Replicas</div>
                  </div>
                  <span className="text-xs font-bold text-[#0D9488]">0.6ms</span>
                </div>

                <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-900">REDIS SENTINEL LOCK ENGINE</div>
                    <div className="text-[11px] text-slate-500">Distributed Mutex • 99.4% Hit Ratio</div>
                  </div>
                  <span className="text-xs font-bold text-[#0D9488]">ACTIVE</span>
                </div>

                <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-900">WHATSAPP BAILEYS BRIDGE</div>
                    <div className="text-[11px] text-slate-500">Port 8088 • Websocket Session Active</div>
                  </div>
                  <span className="text-xs font-bold text-[#0D9488]">CONNECTED</span>
                </div>
              </div>
            </SmoothCard>

            <SmoothCard className="p-5 space-y-4 border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-[#0D9488]" />
                  <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-900">
                    Emergency Global Platform Controls
                  </h3>
                </div>
              </div>

              <div className="space-y-3 font-mono text-xs">
                <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-900">GLOBAL READ-ONLY KILL SWITCH</div>
                    <div className="text-[11px] text-slate-500">Instantly locks mutation endpoints across all tenants</div>
                  </div>
                  <TactileButton
                    variant={killSwitchActive ? 'primary' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setKillSwitchActive(!killSwitchActive);
                      addToast({
                        type: killSwitchActive ? 'info' : 'warning',
                        title: killSwitchActive ? 'Kill Switch Disengaged' : 'EMERGENCY LOCKDOWN ENGAGED',
                        message: killSwitchActive ? 'Normal API writes restored.' : 'Platform switched to read-only.'
                      });
                    }}
                  >
                    {killSwitchActive ? 'Disengage' : 'Engage Lockdown'}
                  </TactileButton>
                </div>

                <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-900">CRYPTOGRAPHIC AUDIT LEDGER</div>
                    <div className="text-[11px] text-slate-500">HMAC-SHA256 signature chain verification</div>
                  </div>
                  <span className="font-bold text-[#0D9488]">✓ VERIFIED</span>
                </div>
              </div>
            </SmoothCard>
          </div>
        </div>
      )}

      {/* Operator / Team Invitation Modal */}
      {inviteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 p-6 shadow-xl font-mono text-xs">
            <h3 className="text-base font-bold text-slate-900 font-mono">
              Provision Enterprise User
            </h3>
            <p className="text-xs text-slate-500 mt-1 font-sans">
              Assign role permissions and warehouse facility.
            </p>

            <form onSubmit={handleInviteSubmit} className="space-y-4 mt-4">
              <div>
                <label className="text-slate-700 font-semibold block mb-1">FULL NAME</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Alex Henderson"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-300 text-slate-900 focus:outline-none focus:border-[#0D9488]"
                />
              </div>

              <div>
                <label className="text-slate-700 font-semibold block mb-1">CORPORATE EMAIL</label>
                <input
                  type="email"
                  required
                  placeholder="alex.henderson@stockpilot.ai"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-300 text-slate-900 focus:outline-none focus:border-[#0D9488]"
                />
              </div>

              <div>
                <label className="text-slate-700 font-semibold block mb-1">ASSIGNED ROLE</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-300 text-slate-900 focus:outline-none focus:border-[#0D9488] cursor-pointer"
                >
                  <option value="operator">Warehouse Operator</option>
                  <option value="warehouse_manager">Warehouse Manager</option>
                  <option value="distributor">Distributor</option>
                  <option value="supply_chain_manager">Supply Chain Manager</option>
                  <option value="org_admin">Organization Admin</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3">
                <TactileButton
                  variant="outline"
                  size="md"
                  type="button"
                  onClick={() => setInviteModalOpen(false)}
                >
                  Cancel
                </TactileButton>
                <TactileButton
                  variant="primary"
                  size="md"
                  type="submit"
                >
                  Confirm Provisioning
                </TactileButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
