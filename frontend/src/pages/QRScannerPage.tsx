import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../services/api';
import { useAppStore } from '../store/useAppStore';
import { Product, InventoryBatch } from '../types';
import { 
  QrCode, 
  Search, 
  Printer, 
  CheckCircle2, 
  Boxes, 
  ShieldAlert, 
  ArrowDownLeft, 
  ArrowUpRight,
  Sparkles,
  Barcode
} from 'lucide-react';

export const QRScannerPage: React.FC = () => {
  const { addToast } = useAppStore();
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [batches, setBatches] = useState<InventoryBatch[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<InventoryBatch | null>(null);

  // Scan / Resolve state
  const [queryPayload, setQueryPayload] = useState('STOCKPILOT://SKU/PRD-VAX-01/ORG/org_triwiz_01');
  const [resolving, setResolving] = useState(false);
  const [resolvedResult, setResolvedResult] = useState<any>(null);

  useEffect(() => {
    api.products.list().then(prods => {
      setProducts(prods);
      if (prods.length > 0) setSelectedProduct(prods[0]);
    }).catch(console.error);

    api.inventory.listBatches().then(b => {
      setBatches(b);
      if (b.length > 0) setSelectedBatch(b[0]);
    }).catch(console.error);

    // Initial resolution
    handleResolveCode('STOCKPILOT://SKU/PRD-VAX-01/ORG/org_triwiz_01');
  }, []);

  const handleResolveCode = async (codeToResolve?: string) => {
    const target = codeToResolve || queryPayload;
    if (!target.trim()) return;
    setResolving(true);
    try {
      const data = await api.products.resolveQr(target.trim());
      setResolvedResult(data);
      addToast({
        type: 'success',
        title: 'QR Code Resolved',
        message: `Found ${data.resolved_type}: ${data.product?.name || data.batch?.batch_number}`
      });
    } catch (err: any) {
      addToast({ type: 'error', title: 'Resolution failed', message: err.message });
    } finally {
      setResolving(false);
    }
  };

  const handlePrintLabels = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-slate-900 border border-slate-800 text-white">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">
              Floor Identification & Mobility
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-bold">
              GS1 Barcode & Secure QR
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight mt-1">
            QR Code Generator & Real-Time Scanner Resolver
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Generates compliant pharmaceutical batch QR tags and resolves scanned camera/handheld payloads to authoritative inventory records and instant floor actions.
          </p>
        </div>

        <button
          onClick={handlePrintLabels}
          className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs border border-slate-700 shadow-sm flex items-center gap-2 transition-colors shrink-0"
        >
          <Printer className="w-4 h-4 text-sky-400" />
          Print Pallet Labels
        </button>
      </div>

      {/* Top Split: Scanner Input & Resolution Display */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Scanner Resolver Input */}
        <div className="lg:col-span-1 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <QrCode className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">
              Scan / Resolve QR Payload
            </h3>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Paste a scanned barcode, SKU, or opaque application URL to retrieve database records.
          </p>

          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block mb-1">
                Scanned Payload String or SKU
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={queryPayload}
                  onChange={(e) => setQueryPayload(e.target.value)}
                  placeholder="e.g. PRD-VAX-01 or STOCKPILOT://SKU/..."
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-mono focus:outline-none focus:border-sky-500"
                />
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
            </div>

            {/* Quick Demo Pre-fills */}
            <div className="text-[10px] space-y-1">
              <span className="font-bold text-slate-400 uppercase tracking-wider">Quick Sample Payloads:</span>
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const c = 'STOCKPILOT://SKU/PRD-VAX-01/ORG/org_triwiz_01';
                    setQueryPayload(c);
                    handleResolveCode(c);
                  }}
                  className="text-left text-sky-400 hover:underline font-mono truncate"
                >
                  ➔ PRD-VAX-01 (Vaccine SKU)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const c = 'STOCKPILOT://BATCH/BN-VX-2026-A1/WH/wh_chicago_01';
                    setQueryPayload(c);
                    handleResolveCode(c);
                  }}
                  className="text-left text-sky-400 hover:underline font-mono truncate"
                >
                  ➔ Batch BN-VX-2026-A1 (FEFO Batch)
                </button>
              </div>
            </div>

            <button
              onClick={() => handleResolveCode()}
              disabled={resolving}
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-600/30 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            >
              <QrCode className="w-4 h-4" />
              {resolving ? 'Resolving Payload...' : 'Resolve Stock Record'}
            </button>
          </div>
        </div>

        {/* Resolved Details View */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">
              Resolved Inventory Context
            </h3>
            {resolvedResult && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                VERIFIED MATCH
              </span>
            )}
          </div>

          {!resolvedResult ? (
            <div className="p-12 text-center text-xs text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
              Scan or enter a QR payload to inspect associated batches and warehouse availability.
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              {/* Product Header */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-sky-400 text-sm">
                      {resolvedResult.product?.sku}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {resolvedResult.product?.handling}
                    </span>
                  </div>
                  <h4 className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                    {resolvedResult.product?.name}
                  </h4>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Barcode: {resolvedResult.product?.barcode} • Category: {resolvedResult.product?.category}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Network Stock</div>
                  <div className="text-2xl font-black text-emerald-400 font-mono-num">
                    {resolvedResult.total_available ?? resolvedResult.batch?.quantity} units
                  </div>
                </div>
              </div>

              {/* Active Batches or Batch info */}
              {resolvedResult.active_batches && (
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                    Active Batches in Network ({resolvedResult.active_batches.length})
                  </div>
                  <div className="space-y-2">
                    {resolvedResult.active_batches.map((b: any) => (
                      <div
                        key={b.id}
                        className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between"
                      >
                        <div>
                          <span className="font-mono font-bold text-sky-400">{b.batch_number}</span>
                          <span className="text-slate-400 ml-2">({b.supplier_reference})</span>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            Bin: {b.storage_bin} • Expiry: {b.expiry_date}
                          </div>
                        </div>
                        <div className="text-right font-mono-num">
                          <span className="font-bold text-white">{b.quantity} units</span>
                          <div className="text-[10px] text-emerald-400">FEFO ACTIVE</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Batch QR Generator & Printable Labels Panel */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">
              Printable Cold-Chain Batch QR Label Generator
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Generates high-contrast printable thermal pallet labels with encoded GS1 / StockPilot batch metadata.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {batches.slice(0, 3).map((b) => (
            <div
              key={b.id}
              className="p-5 rounded-2xl border-2 border-slate-300 dark:border-slate-700 bg-white text-slate-950 flex flex-col justify-between shadow-lg"
            >
              <div>
                <div className="flex justify-between items-start border-b-2 border-slate-950 pb-2 mb-3">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider">STOCKPILOT AI</span>
                    <h4 className="text-sm font-black tracking-tight">{b.product_name}</h4>
                  </div>
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 bg-slate-950 text-white rounded">
                    {b.storage_bin}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-4 my-2">
                  <div className="space-y-1 font-mono text-[11px]">
                    <div><strong>BATCH:</strong> {b.batch_number}</div>
                    <div><strong>EXPIRY:</strong> {b.expiry_date}</div>
                    <div><strong>QTY:</strong> {b.quantity} units</div>
                    <div><strong>LOT:</strong> {b.supplier_reference.substring(0, 16)}</div>
                  </div>

                  {/* High Resolution Printable QR Code */}
                  <div className="p-2 border border-slate-200 rounded-lg bg-white shrink-0">
                    <QRCodeSVG
                      value={b.qr_code_id}
                      size={88}
                      level="H"
                      includeMargin={false}
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-300 pt-2 mt-2 flex items-center justify-between text-[9px] text-slate-600 font-mono">
                <span>{b.qr_code_id}</span>
                <Barcode className="w-6 h-4 text-slate-800" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
