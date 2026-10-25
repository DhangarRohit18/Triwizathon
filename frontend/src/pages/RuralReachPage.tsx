import React, { useState, useEffect, useMemo } from 'react';
import { 
  Wifi, 
  WifiOff, 
  RefreshCw, 
  DownloadCloud, 
  UploadCloud, 
  QrCode, 
  Boxes, 
  ArrowDownLeft, 
  ArrowUpRight, 
  AlertTriangle, 
  ClipboardCheck, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  Search, 
  Filter, 
  Sparkles, 
  ShieldAlert, 
  Send, 
  Layers,
  ChevronRight,
  Database,
  Eye,
  Check,
  X
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { 
  offlineStorage, 
  CachedProduct, 
  CachedInventoryItem, 
  CachedBatch, 
  CachedRecommendation, 
  QueuedTransaction, 
  SyncMetadata 
} from '../services/offlineStorage';
import { ruralreachService, RuralReachConflict, SyncOutcome } from '../services/ruralreachService';

export const RuralReachPage: React.FC = () => {
  const { user, selectedWarehouseId, addToast } = useAppStore();

  // Active facility
  const warehouseId = user?.warehouse_id || (selectedWarehouseId !== 'all' ? selectedWarehouseId : 'wh_chicago_01');

  // Network & Sync State
  const [isOnline, setIsOnline] = useState<boolean>(ruralreachService.isOnline());
  const [simulatedOffline, setSimulatedOffline] = useState<boolean>(false);
  const effectiveOnline = isOnline && !simulatedOffline;

  const [syncing, setSyncing] = useState<boolean>(false);
  const [downloading, setDownloading] = useState<boolean>(false);

  // Cached Local Data
  const [catalogue, setCatalogue] = useState<CachedProduct[]>([]);
  const [inventory, setInventory] = useState<CachedInventoryItem[]>([]);
  const [batches, setBatches] = useState<CachedBatch[]>([]);
  const [recommendations, setRecommendations] = useState<CachedRecommendation | null>(null);
  const [pendingQueue, setPendingQueue] = useState<QueuedTransaction[]>([]);
  const [metadata, setMetadata] = useState<SyncMetadata | null>(null);
  const [conflicts, setConflicts] = useState<RuralReachConflict[]>([]);

  // UI Navigation
  const [activeTab, setActiveTab] = useState<'inventory' | 'queue' | 'ai' | 'conflicts'>('inventory');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  // Modal Dialogs
  const [activeModal, setActiveModal] = useState<
    'NONE' | 'RECEIVE' | 'DISPATCH' | 'DAMAGE' | 'COUNT' | 'SCANNER'
  >('NONE');

  // Form State
  const [formProductId, setFormProductId] = useState('');
  const [formBatchId, setFormBatchId] = useState('');
  const [formQuantity, setFormQuantity] = useState<number>(10);
  const [formBatchNumber, setFormBatchNumber] = useState('');
  const [formDestination, setFormDestination] = useState('VILLAGE_HEALTH_CLINIC_01');
  const [formDamageReason, setFormDamageReason] = useState('Damaged during rural transit');
  const [formCountedQty, setFormCountedQty] = useState<number>(0);
  const [formNotes, setFormNotes] = useState('');

  // Scanner state
  const [scannedCode, setScannedCode] = useState('');
  const [scanResult, setScanResult] = useState<{
    product?: CachedProduct;
    inventory?: CachedInventoryItem;
    batches: CachedBatch[];
  } | null>(null);

  // ---------------------------------------------------------------------------
  // Lifecycle & Subscription
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const unsub = ruralreachService.subscribeOnlineStatus((online) => {
      setIsOnline(online);
    });
    return unsub;
  }, []);

  const reloadLocalData = async () => {
    const [c, inv, b, rec, q, m] = await Promise.all([
      offlineStorage.getCachedCatalogue(),
      offlineStorage.getCachedInventory(),
      offlineStorage.getCachedBatches(),
      offlineStorage.getCachedRecommendations(),
      offlineStorage.getPendingQueue(),
      offlineStorage.getSyncMetadata(),
    ]);

    setCatalogue(c);
    setInventory(inv);
    setBatches(b);
    setRecommendations(rec);
    setPendingQueue(q);
    setMetadata(m);

    if (effectiveOnline && warehouseId) {
      try {
        const confs = await ruralreachService.getConflicts(warehouseId);
        setConflicts(confs);
      } catch (e) {
        console.warn('Could not load conflicts:', e);
      }
    }
  };

  useEffect(() => {
    reloadLocalData();
  }, [effectiveOnline, warehouseId]);

  // If no cached data exists, trigger auto-snapshot if online
  useEffect(() => {
    const checkInitialData = async () => {
      const cat = await offlineStorage.getCachedCatalogue();
      if (cat.length === 0 && effectiveOnline) {
        handleDownloadSnapshot();
      }
    };
    checkInitialData();
  }, [effectiveOnline]);

  // ---------------------------------------------------------------------------
  // Action Handlers
  // ---------------------------------------------------------------------------
  const handleDownloadSnapshot = async () => {
    if (!effectiveOnline) {
      addToast({
        type: 'warning',
        title: 'Offline Mode Active',
        message: 'Cannot download fresh snapshot while offline. Reconnect or disable simulator.',
      });
      return;
    }

    setDownloading(true);
    try {
      const snap = await ruralreachService.downloadSnapshot(warehouseId);
      await reloadLocalData();
      addToast({
        type: 'success',
        title: 'RuralReach Snapshot Ready',
        message: `Cached ${snap.products.length} products & ${snap.batches.length} batches for offline execution.`,
      });
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Snapshot Failed',
        message: err.message || 'Error downloading offline bundle',
      });
    } finally {
      setDownloading(false);
    }
  };

  const handleSyncOutbox = async () => {
    if (!effectiveOnline) {
      addToast({
        type: 'warning',
        title: 'Network Required',
        message: 'Reconnection needed to commit queued transactions to central server.',
      });
      return;
    }

    setSyncing(true);
    try {
      const outcome: SyncOutcome = await ruralreachService.syncPendingQueue(warehouseId);
      await reloadLocalData();

      if (outcome.conflict_count > 0) {
        addToast({
          type: 'warning',
          title: 'Sync Completed with Review Items',
          message: `Committed ${outcome.synced_count} items. ${outcome.conflict_count} conflict(s) flagged for manager review.`,
        });
        setActiveTab('conflicts');
      } else {
        addToast({
          type: 'success',
          title: 'All Queued Items Synced',
          message: `Committed ${outcome.synced_count} offline transactions to central ledger.`,
        });
      }
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Synchronization Interrupted',
        message: err.message || 'Could not synchronize outbox queue',
      });
    } finally {
      setSyncing(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Transaction Enqueuing
  // ---------------------------------------------------------------------------
  const handleExecuteReceive = async () => {
    if (!formProductId || formQuantity <= 0) {
      addToast({ type: 'warning', title: 'Invalid Form', message: 'Select product and positive quantity.' });
      return;
    }

    const prod = catalogue.find((p) => p.id === formProductId);
    const bNumber = formBatchNumber.trim() || `RURAL-BAT-${Date.now().toString().slice(-6)}`;

    await offlineStorage.enqueueTransaction(
      'RECEIVE',
      {
        product_id: formProductId,
        quantity: formQuantity,
        batch_number: bNumber,
        warehouse_id: warehouseId,
        supplier_reference: 'Direct Rural Supplier / Hub',
        unit_cost: prod?.unit_cost || 12.0,
        storage_bin: 'RURAL-STAGING',
      },
      formNotes || 'Offline stock inbound receipt'
    );

    addToast({
      type: 'success',
      title: 'Received Inbound (Offline)',
      message: `Added ${formQuantity} units of ${prod?.name || formProductId} to local ledger. Queued for sync.`,
    });

    setActiveModal('NONE');
    setFormQuantity(10);
    setFormNotes('');
    setFormBatchNumber('');
    await reloadLocalData();
  };

  const handleExecuteDispatch = async () => {
    if (!formProductId || formQuantity <= 0) {
      addToast({ type: 'warning', title: 'Invalid Form', message: 'Select product and positive quantity.' });
      return;
    }

    const prod = catalogue.find((p) => p.id === formProductId);
    const inv = inventory.find((i) => i.product_id === formProductId);
    const available = inv ? inv.available_quantity : 0;

    if (formQuantity > available) {
      const confirmExceed = window.confirm(
        `Warning: Requested ${formQuantity} units exceeds locally cached available stock (${available} units). ` +
        `This will be queued, but will trigger a 'NEEDS_REVIEW' conflict if server has insufficient stock. Proceed?`
      );
      if (!confirmExceed) return;
    }

    await offlineStorage.enqueueTransaction(
      'DISPATCH',
      {
        product_id: formProductId,
        quantity: formQuantity,
        destination_id: formDestination,
        warehouse_id: warehouseId,
      },
      formNotes || `Offline dispatch to ${formDestination}`
    );

    addToast({
      type: 'success',
      title: 'Dispatched Outbound (Offline)',
      message: `Logged dispatch of ${formQuantity} units to ${formDestination}. Local balance updated.`,
    });

    setActiveModal('NONE');
    setFormQuantity(10);
    setFormNotes('');
    await reloadLocalData();
  };

  const handleExecuteDamage = async () => {
    if (!formBatchId || formQuantity <= 0) {
      addToast({ type: 'warning', title: 'Invalid Form', message: 'Select batch and quantity damaged.' });
      return;
    }

    const batch = batches.find((b) => b.id === formBatchId);

    await offlineStorage.enqueueTransaction(
      'DAMAGE_REPORT',
      {
        batch_id: formBatchId,
        product_id: batch?.product_id,
        damaged_quantity: formQuantity,
        reason: formDamageReason,
        warehouse_id: warehouseId,
      },
      formNotes || 'Reported damaged in rural storage'
    );

    addToast({
      type: 'warning',
      title: 'Stock Quarantined (Offline)',
      message: `Marked ${formQuantity} units of batch ${batch?.batch_number} as damaged.`,
    });

    setActiveModal('NONE');
    setFormQuantity(10);
    setFormNotes('');
    await reloadLocalData();
  };

  const handleExecuteCycleCount = async () => {
    if (!formBatchId) {
      addToast({ type: 'warning', title: 'Invalid Form', message: 'Select batch to record cycle count.' });
      return;
    }

    const batch = batches.find((b) => b.id === formBatchId);

    await offlineStorage.enqueueTransaction(
      'CYCLE_COUNT',
      {
        batch_id: formBatchId,
        product_id: batch?.product_id,
        counted_quantity: formCountedQty,
        storage_bin: batch?.storage_bin || 'General',
        warehouse_id: warehouseId,
      },
      formNotes || 'Rural field physical count'
    );

    addToast({
      type: 'info',
      title: 'Cycle Count Logged (Offline)',
      message: `Physical count of ${formCountedQty} units logged for batch ${batch?.batch_number}.`,
    });

    setActiveModal('NONE');
    setFormCountedQty(0);
    setFormNotes('');
    await reloadLocalData();
  };

  const handleResolveConflict = async (
    conflictId: string,
    action: 'APPROVE_OVERRIDE' | 'DISCARD_DRAFT' | 'ADJUST_DIFFERENCE'
  ) => {
    try {
      await ruralreachService.resolveConflict(conflictId, action, 'Resolved via RuralReach Manager Portal');
      addToast({
        type: 'success',
        title: 'Conflict Resolved',
        message: `Action ${action} applied successfully.`,
      });
      await reloadLocalData();
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Resolution Failed',
        message: err.message || 'Could not resolve conflict',
      });
    }
  };

  // ---------------------------------------------------------------------------
  // Barcode / QR Scanner Resolution
  // ---------------------------------------------------------------------------
  const handleScanCode = async (code: string) => {
    if (!code.trim()) return;
    const res = await offlineStorage.lookupBarcode(code);
    setScanResult(res);

    if (res.product) {
      setFormProductId(res.product.id);
      addToast({
        type: 'info',
        title: 'SKU Resolved Offline',
        message: `${res.product.name} (${res.product.sku}) identified in cached catalogue.`,
      });
    } else {
      addToast({
        type: 'warning',
        title: 'Unrecognized Barcode',
        message: `Code '${code}' not found in cached offline bundle. Will require server sync.`,
      });
    }
  };

  // Filtered catalogue & inventory items
  const filteredProducts = useMemo(() => {
    return catalogue.filter((p) => {
      const matchSearch =
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.barcode && p.barcode.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchCat = selectedCategory === 'ALL' || p.category === selectedCategory;
      return matchSearch && matchCat;
    });
  }, [catalogue, searchQuery, selectedCategory]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    catalogue.forEach((p) => p.category && set.add(p.category));
    return ['ALL', ...Array.from(set)];
  }, [catalogue]);

  return (
    <div className="space-y-6 pb-12">
      {/* --------------------------------------------------------------------- */}
      {/* 1. RuralReach Mode Header & Prominent High-Contrast Status Banner    */}
      {/* --------------------------------------------------------------------- */}
      <div className="bg-[#17324D] rounded-2xl p-6 text-white shadow-xl border border-[#17324D]/20">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🌾</span>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                  StockPilot RuralReach Mode
                  <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                    OFFLINE-FIRST HUB
                  </span>
                </h1>
                <p className="text-sm text-slate-300">
                  Zero-connectivity inventory operations for remote villages, rural health dispensaries, and field distribution depots.
                </p>
              </div>
            </div>
          </div>

          {/* Status Indicators & Control Actions */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Live Connection Pill */}
            <div
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-mono font-bold tracking-wide transition-all shadow-sm ${
                effectiveOnline
                  ? 'bg-emerald-500 text-slate-950 border border-emerald-400'
                  : 'bg-amber-500 text-slate-950 border border-amber-400'
              }`}
            >
              {effectiveOnline ? (
                <>
                  <Wifi className="w-4 h-4 animate-pulse" />
                  <span>ONLINE: SYNC ENABLED</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-4 h-4" />
                  <span>OFFLINE MODE ACTIVE</span>
                </>
              )}
            </div>

            {/* Pending Outbox Counter Pill */}
            <div
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-mono font-bold transition-all ${
                pendingQueue.length > 0
                  ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                  : 'bg-white/10 text-slate-300 border border-white/10'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>{pendingQueue.length} PENDING OUTBOX</span>
            </div>

            {/* Offline Simulation Toggle for Testing */}
            <button
              onClick={() => setSimulatedOffline(!simulatedOffline)}
              title="Simulate zero-connectivity mode on your laptop or device"
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium border transition-colors cursor-pointer ${
                simulatedOffline
                  ? 'bg-amber-600 text-white border-amber-400'
                  : 'bg-white/10 hover:bg-white/20 text-slate-200 border-white/20'
              }`}
            >
              {simulatedOffline ? 'Resume Online' : 'Simulate Offline'}
            </button>

            {/* Download Snapshot Button */}
            <button
              onClick={handleDownloadSnapshot}
              disabled={downloading || !effectiveOnline}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold border border-white/20 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <DownloadCloud className={`w-4 h-4 ${downloading ? 'animate-bounce' : ''}`} />
              <span>{downloading ? 'Updating Bundle...' : 'Fetch Snapshot'}</span>
            </button>

            {/* Synchronize Queue Button */}
            <button
              onClick={handleSyncOutbox}
              disabled={syncing || pendingQueue.length === 0 || !effectiveOnline}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#0D9488] hover:bg-[#0f766e] text-white text-xs font-bold shadow-md disabled:opacity-40 transition-all cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? 'Synchronizing...' : `Sync Outbox (${pendingQueue.length})`}</span>
            </button>
          </div>
        </div>

        {/* Facility Metadata Footer */}
        <div className="mt-4 pt-4 border-t border-white/10 flex flex-wrap items-center justify-between text-xs text-slate-300 font-mono">
          <div className="flex items-center gap-4">
            <span>Facility ID: <strong className="text-white">{warehouseId}</strong></span>
            <span>•</span>
            <span>Last Snapshot: <strong className="text-white">{metadata?.last_snapshot_at ? new Date(metadata.last_snapshot_at).toLocaleTimeString() : 'Not Loaded'}</strong></span>
            <span>•</span>
            <span>Catalogue Items: <strong className="text-white">{catalogue.length}</strong></span>
          </div>
          <div className="text-slate-400">
            Device ID: {offlineStorage.getDeviceId().slice(0, 18)}...
          </div>
        </div>
      </div>

      {/* --------------------------------------------------------------------- */}
      {/* 2. Large Touch-Friendly Operator Workstation Controls (Gloves-Ready) */}
      {/* --------------------------------------------------------------------- */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Receive Stock Button */}
        <button
          onClick={() => setActiveModal('RECEIVE')}
          className="flex flex-col items-center justify-center gap-2 p-5 bg-white hover:bg-slate-50 border-2 border-emerald-500 rounded-2xl shadow-sm transition-all transform active:scale-95 cursor-pointer text-left group"
        >
          <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 group-hover:scale-110 transition-transform">
            <ArrowDownLeft className="w-7 h-7" />
          </div>
          <div className="text-center">
            <div className="text-base font-bold text-slate-900">Receive Stock</div>
            <div className="text-xs text-slate-500 font-medium">Inbound receipt & batching</div>
          </div>
        </button>

        {/* Dispatch Stock Button */}
        <button
          onClick={() => setActiveModal('DISPATCH')}
          className="flex flex-col items-center justify-center gap-2 p-5 bg-white hover:bg-slate-50 border-2 border-blue-500 rounded-2xl shadow-sm transition-all transform active:scale-95 cursor-pointer text-left group"
        >
          <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center text-blue-700 group-hover:scale-110 transition-transform">
            <ArrowUpRight className="w-7 h-7" />
          </div>
          <div className="text-center">
            <div className="text-base font-bold text-slate-900">Dispatch Outbound</div>
            <div className="text-xs text-slate-500 font-medium">Ship to clinic / field retail</div>
          </div>
        </button>

        {/* Quarantine / Damage Report */}
        <button
          onClick={() => setActiveModal('DAMAGE')}
          className="flex flex-col items-center justify-center gap-2 p-5 bg-white hover:bg-slate-50 border-2 border-amber-500 rounded-2xl shadow-sm transition-all transform active:scale-95 cursor-pointer text-left group"
        >
          <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700 group-hover:scale-110 transition-transform">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <div className="text-center">
            <div className="text-base font-bold text-slate-900">Damage Quarantine</div>
            <div className="text-xs text-slate-500 font-medium">Isolate broken / spoiled stock</div>
          </div>
        </button>

        {/* Physical Cycle Count / Optical Scanner */}
        <button
          onClick={() => setActiveModal('SCANNER')}
          className="flex flex-col items-center justify-center gap-2 p-5 bg-white hover:bg-slate-50 border-2 border-[#17324D] rounded-2xl shadow-sm transition-all transform active:scale-95 cursor-pointer text-left group"
        >
          <div className="w-12 h-12 rounded-xl bg-[#17324D]/10 flex items-center justify-center text-[#17324D] group-hover:scale-110 transition-transform">
            <QrCode className="w-7 h-7" />
          </div>
          <div className="text-center">
            <div className="text-base font-bold text-slate-900">Scan & Lookup</div>
            <div className="text-xs text-slate-500 font-medium">Offline QR & barcode reader</div>
          </div>
        </button>
      </div>

      {/* --------------------------------------------------------------------- */}
      {/* 3. Navigation Tabs                                                    */}
      {/* --------------------------------------------------------------------- */}
      <div className="flex items-center gap-2 border-b border-slate-200">
        <button
          onClick={() => setActiveTab('inventory')}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-bold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'inventory'
              ? 'border-[#0D9488] text-[#0D9488]'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Boxes className="w-4 h-4" />
          <span>Cached Stock & FEFO Batches ({inventory.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('queue')}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-bold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'queue'
              ? 'border-[#0D9488] text-[#0D9488]'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>Pending Outbox Queue ({pendingQueue.length})</span>
          {pendingQueue.length > 0 && (
            <span className="w-2 h-2 rounded-full bg-amber-500" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('ai')}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-bold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'ai'
              ? 'border-[#0D9488] text-[#0D9488]'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>Cached AI Allocation Plan</span>
        </button>

        {conflicts.length > 0 && (
          <button
            onClick={() => setActiveTab('conflicts')}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-bold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'conflicts'
                ? 'border-red-500 text-red-600'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShieldAlert className="w-4 h-4" />
            <span>Needs Review ({conflicts.length})</span>
            <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700 font-mono font-bold">
              {conflicts.length}
            </span>
          </button>
        )}
      </div>

      {/* --------------------------------------------------------------------- */}
      {/* TAB 1: Cached Local Inventory & Batches                               */}
      {/* --------------------------------------------------------------------- */}
      {activeTab === 'inventory' && (
        <div className="space-y-4">
          {/* Search & Category Filter Controls */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
              <input
                type="text"
                placeholder="Search products by SKU, name or barcode..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0D9488]"
              />
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    selectedCategory === cat
                      ? 'bg-[#17324D] text-white'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Inventory Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-700">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  <tr>
                    <th className="px-6 py-3.5">SKU & Item Details</th>
                    <th className="px-6 py-3.5">Category</th>
                    <th className="px-6 py-3.5 text-right">Available Stock</th>
                    <th className="px-6 py-3.5">FEFO Active Batches</th>
                    <th className="px-6 py-3.5 text-center">Threshold Status</th>
                    <th className="px-6 py-3.5 text-right">Quick Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                        No cached inventory found matching filters.
                      </td>
                    </tr>
                  ) : (
                    filteredProducts.map((p) => {
                      const inv = inventory.find((i) => i.product_id === p.id);
                      const pBatches = batches.filter((b) => b.product_id === p.id);
                      const available = inv ? inv.available_quantity : 0;
                      const isLowStock = available <= (p.min_safety_stock || 50);

                      return (
                        <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="px-6 py-4">
                            <div className="font-bold text-slate-900">{p.name}</div>
                            <div className="text-xs text-slate-400 font-mono mt-0.5">
                              SKU: {p.sku} {p.barcode && `• Barcode: ${p.barcode}`}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
                              {p.category}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <span className={`text-base font-extrabold ${isLowStock ? 'text-amber-600' : 'text-slate-900'}`}>
                              {available.toLocaleString()}
                            </span>
                            <span className="text-xs text-slate-500 ml-1">{p.unit}</span>
                          </td>
                          <td className="px-6 py-4">
                            {pBatches.length === 0 ? (
                              <span className="text-xs text-slate-400 italic">No batches cached</span>
                            ) : (
                              <div className="flex flex-wrap gap-1.5 max-w-xs">
                                {pBatches.slice(0, 3).map((b) => (
                                  <span
                                    key={b.id}
                                    title={`Bin: ${b.storage_bin} | Expiry: ${b.expiry_date}`}
                                    className="px-2 py-0.5 rounded text-[11px] font-mono bg-blue-50 text-blue-700 border border-blue-200"
                                  >
                                    {b.batch_number} ({b.quantity})
                                  </span>
                                ))}
                                {pBatches.length > 3 && (
                                  <span className="text-[11px] text-slate-400 self-center">
                                    +{pBatches.length - 3} more
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 text-center">
                            {isLowStock ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                                <AlertTriangle className="w-3 h-3" />
                                <span>Low Safety Stock</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Optimal</span>
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => {
                                  setFormProductId(p.id);
                                  setActiveModal('RECEIVE');
                                }}
                                className="px-2.5 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold text-xs transition-colors cursor-pointer"
                              >
                                + Receive
                              </button>
                              <button
                                onClick={() => {
                                  setFormProductId(p.id);
                                  setActiveModal('DISPATCH');
                                }}
                                className="px-2.5 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold text-xs transition-colors cursor-pointer"
                              >
                                - Dispatch
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* TAB 2: Pending Outbox Queue                                           */}
      {/* --------------------------------------------------------------------- */}
      {activeTab === 'queue' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">
              Offline Mutations Awaiting Central Synchronization ({pendingQueue.length})
            </h2>
            {pendingQueue.length > 0 && (
              <button
                onClick={() => {
                  if (window.confirm('Clear all pending offline mutations? This cannot be undone.')) {
                    offlineStorage.clearPendingQueue().then(reloadLocalData);
                  }
                }}
                className="text-xs text-red-600 hover:text-red-700 font-medium cursor-pointer"
              >
                Clear Entire Outbox
              </button>
            )}
          </div>

          {pendingQueue.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-2xl border border-slate-200">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
              <div className="text-base font-bold text-slate-800">Outbox is Completely Synchronized</div>
              <div className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                All local receiving, dispatching, and cycle counts have been committed to the central authoritative ledger.
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {pendingQueue.map((item) => (
                <div
                  key={item.transaction_id}
                  className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${
                          item.action === 'RECEIVE'
                            ? 'bg-emerald-100 text-emerald-800'
                            : item.action === 'DISPATCH'
                            ? 'bg-blue-100 text-blue-800'
                            : item.action === 'DAMAGE_REPORT'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-purple-100 text-purple-800'
                        }`}
                      >
                        {item.action}
                      </span>
                      <span className="text-xs font-mono text-slate-400">
                        ID: {item.transaction_id}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          item.status === 'SYNCING'
                            ? 'bg-blue-100 text-blue-700 animate-pulse'
                            : item.status === 'NEEDS_REVIEW'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>

                    <div className="text-xs text-slate-700 font-medium">
                      {item.client_notes || 'No description entered'}
                    </div>

                    <div className="text-[11px] text-slate-400 font-mono">
                      Payload: {JSON.stringify(item.payload)}
                    </div>
                  </div>

                  <div className="text-right text-xs text-slate-400 font-mono shrink-0">
                    <div>{new Date(item.timestamp).toLocaleTimeString()}</div>
                    <div className="text-[10px]">{new Date(item.timestamp).toLocaleDateString()}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* TAB 3: Cached AI Allocation Plan                                     */}
      {/* --------------------------------------------------------------------- */}
      {activeTab === 'ai' && (
        <div className="space-y-4">
          <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-900 leading-relaxed">
              <strong className="font-bold">Offline Optimization Advisory:</strong> The allocation recommendations below were calculated by Google OR-Tools on the central server and cached for offline field guidance. Please adjust allocations if local emergency demands differ.
            </div>
          </div>

          {recommendations ? (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-[#0D9488]" />
                      OR-Tools Optimized Distribution Plan
                    </h3>
                    <p className="text-xs text-slate-500 font-mono mt-0.5">
                      Plan ID: {recommendations.plan_id || 'MIP-CACHED'} • Generated:{' '}
                      {recommendations.generated_at ? new Date(recommendations.generated_at).toLocaleString() : 'Recent snapshot'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {recommendations.allocations && recommendations.allocations.length > 0 ? (
                    recommendations.allocations.map((alloc, idx) => (
                      <div
                        key={idx}
                        className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-white transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900 text-sm">
                            {alloc.product_name || alloc.product_id}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                              alloc.priority === 'CRITICAL'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-blue-100 text-blue-800'
                            }`}
                          >
                            {alloc.priority || 'STANDARD'}
                          </span>
                        </div>

                        <div className="mt-2 flex items-baseline justify-between">
                          <span className="text-xs text-slate-500">Target Destination:</span>
                          <span className="text-xs font-semibold text-slate-800">
                            {alloc.destination_name || alloc.destination_id}
                          </span>
                        </div>

                        <div className="mt-1 flex items-baseline justify-between">
                          <span className="text-xs text-slate-500">Recommended Allocation:</span>
                          <span className="text-base font-extrabold text-[#0D9488]">
                            {alloc.recommended_quantity} units
                          </span>
                        </div>

                        {alloc.rationale && (
                          <div className="mt-2 pt-2 border-t border-slate-200 text-xs text-slate-600 italic">
                            "{alloc.rationale}"
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="col-span-2 text-center text-xs text-slate-400 py-6">
                      No active allocations recommended for this facility.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-12 text-center bg-white rounded-2xl border border-slate-200">
              <Sparkles className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <div className="text-base font-bold text-slate-800">No Cached Recommendations Available</div>
              <div className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                Connect online to download the latest OR-Tools optimization run from central headquarters.
              </div>
            </div>
          )}
        </div>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* TAB 4: Conflict Resolution (Needs Review)                             */}
      {/* --------------------------------------------------------------------- */}
      {activeTab === 'conflicts' && (
        <div className="space-y-4">
          <div className="p-4 bg-red-50 rounded-xl border border-red-200 text-xs text-red-900 leading-relaxed">
            <strong className="font-bold">Authoritative Ledger Discrepancies:</strong> These mutations were recorded while offline but encountered a concurrency or inventory collision upon sync. Central server stock was protected, and the items were isolated below for manager decision.
          </div>

          <div className="space-y-3">
            {conflicts.map((conf) => (
              <div
                key={conf.id}
                className="p-5 bg-white rounded-2xl border-2 border-red-200 shadow-sm space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5 text-red-600" />
                    <span className="font-bold text-slate-900 text-sm">Conflict ID: {conf.id}</span>
                    <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-red-100 text-red-800">
                      NEEDS_REVIEW
                    </span>
                  </div>
                  <span className="text-xs font-mono text-slate-400">
                    Logged: {new Date(conf.created_at).toLocaleString()}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div className="p-3 bg-slate-50 rounded-xl">
                    <span className="text-slate-500 block">Mutation Action:</span>
                    <strong className="text-slate-900 text-sm">{conf.action}</strong>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl">
                    <span className="text-slate-500 block">Requested Offline Quantity:</span>
                    <strong className="text-amber-700 text-sm">{conf.requested_quantity || 'N/A'} units</strong>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl">
                    <span className="text-slate-500 block">Server Available Stock:</span>
                    <strong className="text-red-700 text-sm">{conf.server_available_quantity ?? 'N/A'} units</strong>
                  </div>
                </div>

                <div className="p-3 bg-red-50/50 rounded-xl text-xs text-red-900 font-medium">
                  <strong>Reason:</strong> {conf.reason}
                </div>

                {/* Manager Resolution Action Buttons */}
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    onClick={() => handleResolveConflict(conf.id, 'DISCARD_DRAFT')}
                    className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
                  >
                    Discard Offline Entry
                  </button>
                  <button
                    onClick={() => handleResolveConflict(conf.id, 'APPROVE_OVERRIDE')}
                    className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer"
                  >
                    Force Authoritative Override
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* MODAL: Receive Stock Inbound                                         */}
      {/* --------------------------------------------------------------------- */}
      {activeModal === 'RECEIVE' && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <ArrowDownLeft className="w-5 h-5 text-emerald-600" />
                Offline Inbound Stock Receipt
              </h3>
              <button onClick={() => setActiveModal('NONE')} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Target Product</label>
                <select
                  value={formProductId}
                  onChange={(e) => setFormProductId(e.target.value)}
                  className="w-full p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-[#0D9488]"
                >
                  <option value="">-- Choose Product from Cached Catalogue --</option>
                  {catalogue.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Receipt Quantity</label>
                <input
                  type="number"
                  min="1"
                  value={formQuantity}
                  onChange={(e) => setFormQuantity(Number(e.target.value))}
                  className="w-full p-2.5 border border-slate-300 rounded-xl font-mono text-base font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Batch Number (Optional - Auto generated)</label>
                <input
                  type="text"
                  placeholder="e.g. BN-VILLAGE-2026-01"
                  value={formBatchNumber}
                  onChange={(e) => setFormBatchNumber(e.target.value)}
                  className="w-full p-2.5 border border-slate-300 rounded-xl font-mono text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Receipt Notes</label>
                <input
                  type="text"
                  placeholder="e.g. Delivered by rural logistics van #12"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  className="w-full p-2.5 border border-slate-300 rounded-xl text-sm"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t">
              <button
                onClick={() => setActiveModal('NONE')}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteReceive}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md cursor-pointer"
              >
                Commit Receipt to Offline Ledger
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* MODAL: Dispatch Outbound                                             */}
      {/* --------------------------------------------------------------------- */}
      {activeModal === 'DISPATCH' && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <ArrowUpRight className="w-5 h-5 text-blue-600" />
                Offline Outbound Dispatch
              </h3>
              <button onClick={() => setActiveModal('NONE')} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Target Product</label>
                <select
                  value={formProductId}
                  onChange={(e) => setFormProductId(e.target.value)}
                  className="w-full p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- Choose Product from Cached Catalogue --</option>
                  {catalogue.map((p) => {
                    const inv = inventory.find((i) => i.product_id === p.id);
                    return (
                      <option key={p.id} value={p.id}>
                        {p.name} ({inv ? inv.available_quantity : 0} available)
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Dispatch Quantity</label>
                <input
                  type="number"
                  min="1"
                  value={formQuantity}
                  onChange={(e) => setFormQuantity(Number(e.target.value))}
                  className="w-full p-2.5 border border-slate-300 rounded-xl font-mono text-base font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Destination Facility</label>
                <select
                  value={formDestination}
                  onChange={(e) => setFormDestination(e.target.value)}
                  className="w-full p-2.5 border border-slate-300 rounded-xl text-sm"
                >
                  <option value="VILLAGE_HEALTH_CLINIC_01">Village Health Clinic #01 (Emergency)</option>
                  <option value="RURAL_COMMUNITY_POST_02">Rural Community Health Post #02</option>
                  <option value="FIELD_DISPENSARY_NORTH">Field Dispensary North Sector</option>
                  <option value="MOBILE_CLINIC_VAN_03">Mobile Vaccination Unit #03</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Dispatch Reference / Reason</label>
                <input
                  type="text"
                  placeholder="e.g. Urgent distribution to child clinic"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  className="w-full p-2.5 border border-slate-300 rounded-xl text-sm"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t">
              <button
                onClick={() => setActiveModal('NONE')}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteDispatch}
                className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md cursor-pointer"
              >
                Log Outbound Dispatch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* MODAL: Damage / Quarantine Report                                    */}
      {/* --------------------------------------------------------------------- */}
      {activeModal === 'DAMAGE' && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                Report Damaged / Quarantined Stock
              </h3>
              <button onClick={() => setActiveModal('NONE')} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Target Batch</label>
                <select
                  value={formBatchId}
                  onChange={(e) => setFormBatchId(e.target.value)}
                  className="w-full p-2.5 border border-slate-300 rounded-xl text-sm"
                >
                  <option value="">-- Choose Affected Batch --</option>
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.batch_number} ({b.quantity} in {b.storage_bin})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Damaged Quantity</label>
                <input
                  type="number"
                  min="1"
                  value={formQuantity}
                  onChange={(e) => setFormQuantity(Number(e.target.value))}
                  className="w-full p-2.5 border border-slate-300 rounded-xl font-mono text-base font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Damage Reason</label>
                <select
                  value={formDamageReason}
                  onChange={(e) => setFormDamageReason(e.target.value)}
                  className="w-full p-2.5 border border-slate-300 rounded-xl text-sm"
                >
                  <option value="Damaged during rural transit">Damaged during rural transit</option>
                  <option value="Temperature excursion in solar cold box">Temperature excursion in solar cold box</option>
                  <option value="Vial packaging seal fracture">Vial packaging seal fracture</option>
                  <option value="Product expired past FEFO date">Product expired past FEFO date</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t">
              <button
                onClick={() => setActiveModal('NONE')}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteDamage}
                className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-md cursor-pointer"
              >
                Quarantine Stock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* MODAL: Offline QR / Barcode Scanner Workstation                      */}
      {/* --------------------------------------------------------------------- */}
      {activeModal === 'SCANNER' && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <QrCode className="w-5 h-5 text-[#17324D]" />
                Offline Optical QR & Barcode Station
              </h3>
              <button onClick={() => setActiveModal('NONE')} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-sm">
              <div className="p-4 bg-slate-100 rounded-2xl border border-slate-200 flex flex-col items-center justify-center gap-2">
                <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center shadow-inner text-[#0D9488]">
                  <QrCode className="w-8 h-8 animate-pulse" />
                </div>
                <div className="text-xs text-slate-500 font-medium text-center">
                  Ready to scan optical barcode, GS1 DataMatrix, or manual entry.
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Enter or Scan Barcode / SKU
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="e.g. VAX-001 or BAR-VAX-01"
                    value={scannedCode}
                    onChange={(e) => setScannedCode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleScanCode(scannedCode);
                    }}
                    className="flex-1 p-2.5 border border-slate-300 rounded-xl font-mono text-sm focus:ring-2 focus:ring-[#0D9488]"
                  />
                  <button
                    onClick={() => handleScanCode(scannedCode)}
                    className="px-4 py-2.5 rounded-xl bg-[#17324D] text-white font-bold text-xs hover:bg-slate-800 cursor-pointer"
                  >
                    Lookup
                  </button>
                </div>
              </div>

              {scanResult && scanResult.product && (
                <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <strong className="text-emerald-900 font-bold text-sm">
                      {scanResult.product.name}
                    </strong>
                    <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-emerald-200 text-emerald-800">
                      MATCH FOUND
                    </span>
                  </div>
                  <div className="text-xs text-emerald-800 font-mono">
                    SKU: {scanResult.product.sku} • Available: {scanResult.inventory?.available_quantity || 0} {scanResult.product.unit}
                  </div>
                  <div className="pt-2 flex items-center gap-2">
                    <button
                      onClick={() => {
                        setFormProductId(scanResult.product!.id);
                        setActiveModal('RECEIVE');
                      }}
                      className="flex-1 py-1.5 rounded-lg bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 cursor-pointer"
                    >
                      Receive This Item
                    </button>
                    <button
                      onClick={() => {
                        setFormProductId(scanResult.product!.id);
                        setActiveModal('DISPATCH');
                      }}
                      className="flex-1 py-1.5 rounded-lg bg-blue-600 text-white font-bold text-xs hover:bg-blue-700 cursor-pointer"
                    >
                      Dispatch This Item
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end pt-3 border-t">
              <button
                onClick={() => setActiveModal('NONE')}
                className="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs cursor-pointer"
              >
                Close Station
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RuralReachPage;
