import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useAppStore } from '../store/useAppStore';
import { InventoryItem, InventoryBatch, InventoryMovement, Warehouse, Product } from '../types';
import { KPICard } from '../components/KPICard';
import { 
  Boxes, 
  ArrowDownLeft, 
  ArrowUpRight, 
  FileText, 
  AlertTriangle, 
  CheckCircle2, 
  Plus, 
  Send, 
  SlidersHorizontal,
  ShieldAlert,
  Clock,
  Filter
} from 'lucide-react';

export const InventoryPage: React.FC = () => {
  const { selectedWarehouseId, addToast, user } = useAppStore();
  const [activeTab, setActiveTab] = useState<'inventory' | 'batches' | 'ledger'>('inventory');
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [batches, setBatches] = useState<InventoryBatch[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  // Action Modals
  const [actionModal, setActionModal] = useState<'receive' | 'dispatch' | 'adjust' | null>(null);
  const [formWarehouse, setFormWarehouse] = useState('wh_chicago_01');
  const [formProduct, setFormProduct] = useState('prd_vax_01');
  const [formBatchNumber, setFormBatchNumber] = useState('');
  const [formSupplier, setFormSupplier] = useState('Pfizer-BioNTech-GmbH');
  const [formQuantity, setFormQuantity] = useState(100);
  const [formStorageBin, setFormStorageBin] = useState('CR-1-A08');
  const [formDestination, setFormDestination] = useState('dest_boston_01');
  const [formReason, setFormReason] = useState('Routine replenishment fulfillment');
  const [formExpiryDate, setFormExpiryDate] = useState('2026-11-30');

  useEffect(() => {
    loadAll();
  }, [selectedWarehouseId]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [invData, batData, movData, whData, prdData] = await Promise.all([
        api.inventory.list({ warehouse_id: selectedWarehouseId }),
        api.inventory.listBatches({ warehouse_id: selectedWarehouseId }),
        api.inventory.listMovements(50),
        api.warehouses.list(),
        api.products.list(),
      ]);
      setItems(invData);
      setBatches(batData);
      setMovements(movData);
      setWarehouses(whData);
      setProducts(prdData);
      if (whData.length > 0) setFormWarehouse(whData[0].id);
      if (prdData.length > 0) setFormProduct(prdData[0].id);
    } catch (err: any) {
      addToast({ type: 'error', title: 'Data load error', message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleActionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const correlationId = `WEB-ACT-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    try {
      if (actionModal === 'receive') {
        await api.inventory.receiveStock({
          correlation_id: correlationId,
          warehouse_id: formWarehouse,
          product_id: formProduct,
          batch_number: formBatchNumber || `BN-AUT-${Date.now().toString().slice(-4)}`,
          supplier_reference: formSupplier,
          mfg_date: '2026-01-01',
          expiry_date: formExpiryDate,
          quantity: formQuantity,
          unit_cost: 22.50,
          storage_bin: formStorageBin,
        });
        addToast({ type: 'success', title: 'Stock Receipt Recorded', message: `Added ${formQuantity} units to batch.` });
      } else if (actionModal === 'dispatch') {
        await api.inventory.dispatchStock({
          correlation_id: correlationId,
          warehouse_id: formWarehouse,
          product_id: formProduct,
          destination_id: formDestination,
          quantity: formQuantity,
          reason: formReason,
        });
        addToast({ type: 'success', title: 'Stock Dispatched', message: `Dispatched ${formQuantity} units via FEFO.` });
      } else if (actionModal === 'adjust') {
        // Find first batch for this product in warehouse
        const matchingBatch = batches.find(b => b.warehouse_id === formWarehouse && b.product_id === formProduct);
        if (!matchingBatch) throw new Error('No matching batch found in selected warehouse.');
        await api.inventory.adjustStock({
          correlation_id: correlationId,
          warehouse_id: formWarehouse,
          product_id: formProduct,
          batch_id: matchingBatch.id,
          new_quantity: formQuantity,
          reason: formReason,
        });
        addToast({ type: 'warning', title: 'Cycle Count Reconciled', message: `Adjusted quantity to ${formQuantity}.` });
      }

      setActionModal(null);
      loadAll();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Operation rejected', message: err.message });
    }
  };

  const nearExpiryBatches = batches.filter(b => {
    const days = Math.round((new Date(b.expiry_date).getTime() - Date.now()) / (1000 * 3600 * 24));
    return days <= 30;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-slate-900 border border-slate-800 text-white">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">
              Authoritative Stock Engine
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-bold">
              Append-Only Ledger
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight mt-1">
            Multi-Warehouse Inventory & FEFO Expiry Ledger
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Atomic transactions enforce non-negative stock and idempotency. Tracks First-Expired-First-Out (FEFO) shelf-life batches and records all movements in an append-only ledger.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={() => setActionModal('receive')}
            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-600/30 flex items-center gap-1.5 transition-all"
          >
            <ArrowDownLeft className="w-4 h-4" />
            Receive Stock
          </button>
          <button
            onClick={() => setActionModal('dispatch')}
            className="px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs shadow-md shadow-sky-600/30 flex items-center gap-1.5 transition-all"
          >
            <ArrowUpRight className="w-4 h-4" />
            Dispatch Stock
          </button>
          <button
            onClick={() => setActionModal('adjust')}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors"
          >
            Cycle Count
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Monitored Batches"
          value={batches.length}
          subtitle="Active supplier lot numbers"
          icon={Boxes}
        />
        <KPICard
          title="Near Expiry Batches (<30d)"
          value={nearExpiryBatches.length}
          subtitle="FEFO high-priority liquidation"
          change={nearExpiryBatches.length > 0 ? "Urgent FEFO" : "Nominal"}
          isPositive={nearExpiryBatches.length === 0}
          icon={Clock}
          badge="FEFO"
        />
        <KPICard
          title="Safety Stock Violations"
          value={items.filter(i => i.available_quantity <= i.safety_stock).length}
          subtitle="Replenishment trigger threshold"
          icon={AlertTriangle}
        />
        <KPICard
          title="Ledger Transactions"
          value={movements.length}
          subtitle="Append-only immutable records"
          icon={FileText}
          badge="Audit"
        />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab('inventory')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors ${
            activeTab === 'inventory'
              ? 'bg-sky-500 text-white'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          Warehouse Aggregates ({items.length})
        </button>
        <button
          onClick={() => setActiveTab('batches')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
            activeTab === 'batches'
              ? 'bg-sky-500 text-white'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          Batch & Expiry Controls ({batches.length})
          {nearExpiryBatches.length > 0 && (
            <span className="w-2 h-2 rounded-full bg-amber-400" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('ledger')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors ${
            activeTab === 'ledger'
              ? 'bg-sky-500 text-white'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          Append-Only Transaction Ledger ({movements.length})
        </button>
      </div>

      {/* Tab 1: Warehouse Aggregates Table */}
      {activeTab === 'inventory' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-5 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs table-dense">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 uppercase tracking-wider text-[11px]">
                  <th>Product</th>
                  <th>Warehouse Hub</th>
                  <th>Category / Handling</th>
                  <th className="text-right">Available</th>
                  <th className="text-right">Reserved</th>
                  <th className="text-right">Safety Stock</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono-num">
                {items.map((item) => {
                  const isLow = item.available_quantity <= item.safety_stock;
                  return (
                    <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="font-bold text-slate-900 dark:text-slate-100">
                        <div>{item.product_name}</div>
                        <span className="text-[10px] text-sky-400 font-mono font-normal">{item.product_sku}</span>
                      </td>
                      <td className="text-slate-700 dark:text-slate-300 font-sans font-medium">
                        {item.warehouse_name}
                      </td>
                      <td>
                        <span className={`text-[10px] px-2 py-0.5 rounded font-bold capitalize font-sans ${
                          item.handling === 'cold_chain'
                            ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/20'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                        }`}>
                          {item.handling.replace('_', ' ')}
                        </span>
                      </td>
                      <td className={`text-right font-bold text-sm ${isLow ? 'text-rose-400' : 'text-emerald-400'}`}>
                        {item.available_quantity.toLocaleString()} {item.unit}
                      </td>
                      <td className="text-right text-slate-400">
                        {item.reserved_quantity}
                      </td>
                      <td className="text-right text-slate-400 font-medium">
                        {item.safety_stock}
                      </td>
                      <td>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded font-sans ${
                          isLow ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'
                        }`}>
                          {isLow ? 'LOW STOCK' : 'NOMINAL'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Batch & FEFO Expiry Controls Table */}
      {activeTab === 'batches' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-5 shadow-sm space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs table-dense">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 uppercase tracking-wider text-[11px]">
                  <th>Batch / Lot</th>
                  <th>Product</th>
                  <th>Warehouse</th>
                  <th>Mfg Date</th>
                  <th>Expiry Date</th>
                  <th className="text-right">Quantity</th>
                  <th>Storage Bin</th>
                  <th>FEFO Urgency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono-num">
                {batches.map((b) => {
                  const daysLeft = Math.round((new Date(b.expiry_date).getTime() - Date.now()) / (1000 * 3600 * 24));
                  const isExpiringSoon = daysLeft <= 30;
                  return (
                    <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="font-bold text-sky-400 font-mono">
                        {b.batch_number}
                        <div className="text-[10px] text-slate-500 font-sans font-normal">{b.supplier_reference}</div>
                      </td>
                      <td className="font-bold text-slate-800 dark:text-slate-200 font-sans">
                        {b.product_name}
                      </td>
                      <td className="text-slate-700 dark:text-slate-300 font-sans">
                        {b.warehouse_name}
                      </td>
                      <td className="text-slate-400">{b.mfg_date}</td>
                      <td className={`font-bold ${isExpiringSoon ? 'text-rose-400' : 'text-slate-300'}`}>
                        {b.expiry_date}
                      </td>
                      <td className="text-right font-bold text-white">
                        {b.quantity.toLocaleString()}
                      </td>
                      <td className="text-slate-400 font-mono">{b.storage_bin}</td>
                      <td>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded font-sans ${
                          isExpiringSoon
                            ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30 animate-pulse'
                            : 'bg-emerald-500/10 text-emerald-400'
                        }`}>
                          {isExpiringSoon ? `EXPIRING (${daysLeft}d)` : 'ACTIVE'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Append-Only Immutable Transaction Ledger */}
      {activeTab === 'ledger' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-5 shadow-sm space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs table-dense">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 uppercase tracking-wider text-[11px]">
                  <th>Correlation ID</th>
                  <th>Type</th>
                  <th>Product</th>
                  <th>Source ➔ Destination</th>
                  <th className="text-right">Change</th>
                  <th className="text-right">Balance</th>
                  <th>Actor</th>
                  <th>Timestamp</th>
                  <th>Audit Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono-num">
                {movements.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="font-mono text-sky-400 text-[11px]">
                      {m.correlation_id}
                    </td>
                    <td>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase font-sans ${
                        m.movement_type === 'receipt'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : m.movement_type === 'dispatch'
                          ? 'bg-sky-500/10 text-sky-400'
                          : 'bg-amber-500/10 text-amber-400'
                      }`}>
                        {m.movement_type}
                      </span>
                    </td>
                    <td className="font-bold text-slate-800 dark:text-slate-200 font-sans">
                      {m.product_name}
                    </td>
                    <td className="text-slate-400 font-sans">
                      {m.source_name} ➔ {m.destination_name}
                    </td>
                    <td className={`text-right font-bold ${m.quantity_changed > 0 ? 'text-emerald-400' : 'text-slate-300'}`}>
                      {m.quantity_changed > 0 ? `+${m.quantity_changed}` : m.quantity_changed}
                    </td>
                    <td className="text-right text-white font-bold">
                      {m.balance_after}
                    </td>
                    <td className="text-slate-300 font-sans">{m.actor_name}</td>
                    <td className="text-slate-500 text-[11px] font-mono">{m.timestamp.substring(0, 19).replace('T', ' ')}</td>
                    <td className="text-slate-400 font-sans max-w-xs truncate">{m.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stock Mutation Action Modal */}
      {actionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl">
            <h3 className="text-base font-bold text-slate-900 dark:text-white capitalize">
              {actionModal === 'receive' && 'Receive Stock into Warehouse Batch'}
              {actionModal === 'dispatch' && 'Dispatch Stock to Destination Center'}
              {actionModal === 'adjust' && 'Reconcile Inventory Cycle Count'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Atomic transaction execution with immutable ledger audit trail.
            </p>

            <form onSubmit={handleActionSubmit} className="space-y-4 mt-4 text-xs">
              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Target Warehouse</label>
                <select
                  value={formWarehouse}
                  onChange={(e) => setFormWarehouse(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:border-sky-500"
                >
                  {warehouses.map(w => (
                    <option key={w.id} value={w.id}>{w.name} ({w.city})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Product SKU</label>
                <select
                  value={formProduct}
                  onChange={(e) => setFormProduct(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:border-sky-500"
                >
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                  ))}
                </select>
              </div>

              {actionModal === 'receive' && (
                <>
                  <div>
                    <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Supplier Batch / Lot Number</label>
                    <input
                      type="text"
                      placeholder="e.g. BN-VX-2026-X9"
                      value={formBatchNumber}
                      onChange={(e) => setFormBatchNumber(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Expiry Date</label>
                      <input
                        type="date"
                        value={formExpiryDate}
                        onChange={(e) => setFormExpiryDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Storage Bin</label>
                      <input
                        type="text"
                        value={formStorageBin}
                        onChange={(e) => setFormStorageBin(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
                      />
                    </div>
                  </div>
                </>
              )}

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  {actionModal === 'adjust' ? 'Verified Physically Counted Quantity' : 'Quantity (Units)'}
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  value={formQuantity}
                  onChange={(e) => setFormQuantity(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none font-mono font-bold"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setActionModal(null)}
                  className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold shadow-md shadow-sky-600/30"
                >
                  Execute Mutation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
