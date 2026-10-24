import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';
import { api } from '../services/api';
import { useAppStore } from '../store/useAppStore';
import { Product, InventoryBatch } from '../types';
import { 
  QrCode, 
  Search, 
  Printer, 
  CheckCircle2, 
  ShieldAlert, 
  ArrowDownLeft, 
  ArrowUpRight,
  Barcode,
  RefreshCw,
  ClipboardCheck,
  History,
  Camera,
  CameraOff,
  SwitchCamera,
  Upload,
  Volume2,
  Sparkles,
  Zap
} from 'lucide-react';

export const QRScannerPage: React.FC = () => {
  const { addToast } = useAppStore();
  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<InventoryBatch[]>([]);
  const [recentMovements, setRecentMovements] = useState<any[]>([]);

  // Scan modes: 'camera' | 'upload' | 'manual'
  const [scanMode, setScanMode] = useState<'camera' | 'upload' | 'manual'>('camera');
  
  // Real-time camera state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Video & Scanner references
  const videoRef = useRef<HTMLVideoElement>(null);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<any>(null);

  // Scan / Resolve state
  const [queryPayload, setQueryPayload] = useState('STOCKPILOT://SKU/PRD-VAX-01/ORG/org_triwiz_01');
  const [resolving, setResolving] = useState(false);
  const [resolvedResult, setResolvedResult] = useState<any>(null);

  // Label generator view mode: 'batches' | 'products'
  const [labelGeneratorTab, setLabelGeneratorTab] = useState<'batches' | 'products'>('batches');

  // Floor operation modal state
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [actionType, setActionType] = useState<'RECEIVE' | 'DISPATCH' | 'CYCLE_COUNT' | 'DAMAGE'>('RECEIVE');
  const [actionQty, setActionQty] = useState(50);
  const [actionReason, setActionReason] = useState('Floor workflow execution');
  const [actionDestination, setActionDestination] = useState('dest_boston_01');
  const [actionBin, setActionBin] = useState('BIN-A-01');
  const [submittingAction, setSubmittingAction] = useState(false);

  // Audio beep synthesized via Web Audio API (identical to warehouse handheld scanners)
  const playScanBeep = () => {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(950, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1400, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch {
      // Audio playback restrictions fallback
    }
  };

  const loadData = () => {
    api.products.list().then(prods => setProducts(prods)).catch(console.error);
    api.inventory.listBatches().then(b => setBatches(b)).catch(console.error);
    api.inventory.listMovements(10).then(m => setRecentMovements(m)).catch(console.error);
  };

  useEffect(() => {
    loadData();
    handleResolveCode('STOCKPILOT://SKU/PRD-VAX-01/ORG/org_triwiz_01');
  }, []);

  // Manage Real-Time Camera lifecycle
  useEffect(() => {
    if (scanMode === 'camera') {
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [scanMode, cameraFacing]);

  const startCamera = async () => {
    stopCamera();
    setCameraError(null);
    setCameraActive(true);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Webcam access not supported in this browser environment.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: cameraFacing, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute("playsinline", "true");
        await videoRef.current.play();
      }

      startDetectionLoop();
    } catch (err: any) {
      console.warn("Camera start failed, falling back to manual entry:", err);
      setCameraError(err.message || "Camera permission denied or camera device unavailable.");
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  const startDetectionLoop = () => {
    if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);

    scanIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || videoRef.current.readyState < 2) return;

      // 1. Native BarcodeDetector acceleration if available (Chrome 88+)
      if ("BarcodeDetector" in window) {
        try {
          const detector = new (window as any).BarcodeDetector({
            formats: ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e"]
          });
          const barcodes = await detector.detect(videoRef.current);
          if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
            const raw = barcodes[0].rawValue;
            if (raw !== lastScannedCode) {
              setLastScannedCode(raw);
              setQueryPayload(raw);
              playScanBeep();
              if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
              handleResolveCode(raw);
            }
          }
        } catch {
          // ignore detection frame errors
        }
      }
    }, 350);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const html5Qr = new Html5Qrcode("hidden-qr-reader");
      const decodedText = await html5Qr.scanFile(file, true);
      playScanBeep();
      setQueryPayload(decodedText);
      setLastScannedCode(decodedText);
      handleResolveCode(decodedText);
      addToast({
        type: 'success',
        title: 'Image Barcode Scanned',
        message: `Extracted: ${decodedText}`
      });
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Image Scan Failed',
        message: 'Could not detect a legible QR or Barcode in the uploaded image.'
      });
    }
  };

  const handleResolveCode = async (codeToResolve?: string) => {
    const target = codeToResolve || queryPayload;
    if (!target.trim()) return;
    setResolving(true);
    try {
      const data = await api.products.resolveQr(target.trim());
      setResolvedResult(data);
      addToast({
        type: 'success',
        title: 'Identifier Verified',
        message: `Validated ${data.resolved_type.toUpperCase()}: ${data.product_name || data.product?.name || data.batch?.batch_number}`
      });
    } catch (err: any) {
      setResolvedResult(null);
      addToast({ type: 'error', title: 'Resolution Failed', message: err.message });
    } finally {
      setResolving(false);
    }
  };

  const handleExecuteOperation = async () => {
    if (!resolvedResult) return;
    setSubmittingAction(true);

    const correlationId = `WEB-${actionType}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const productId = resolvedResult.product_id || resolvedResult.product?.id || 'prd_vax_01';
    const warehouseId = resolvedResult.warehouse_id || resolvedResult.batch?.warehouse_id || 'wh_chicago_01';
    const batchId = resolvedResult.batch_id || resolvedResult.batch?.id || 'bat_vax_chi_01';
    const batchNumber = resolvedResult.batch_number || resolvedResult.batch?.batch_number || `LOT-${Date.now().toString().slice(-4)}`;

    try {
      if (actionType === 'RECEIVE') {
        await api.inventory.receiveStock({
          correlation_id: correlationId,
          warehouse_id: warehouseId,
          product_id: productId,
          batch_number: batchNumber,
          supplier_reference: 'Vendor Delivery Direct',
          mfg_date: '2026-01-01',
          expiry_date: '2027-01-01',
          quantity: actionQty,
          unit_cost: resolvedResult.unit_cost || 22.50,
          storage_bin: actionBin,
        });
      } else if (actionType === 'DISPATCH') {
        await api.inventory.dispatchStock({
          correlation_id: correlationId,
          warehouse_id: warehouseId,
          product_id: productId,
          destination_id: actionDestination,
          quantity: actionQty,
          batch_id: batchId,
          reason: actionReason,
        });
      } else if (actionType === 'CYCLE_COUNT') {
        await api.inventory.cycleCount({
          correlation_id: correlationId,
          warehouse_id: warehouseId,
          product_id: productId,
          batch_id: batchId,
          counted_quantity: actionQty,
          storage_bin: actionBin,
          notes: actionReason,
        });
      } else if (actionType === 'DAMAGE') {
        await api.inventory.reportDamage({
          correlation_id: correlationId,
          warehouse_id: warehouseId,
          product_id: productId,
          batch_id: batchId,
          damaged_quantity: actionQty,
          reason: actionReason,
        });
      }

      addToast({
        type: 'success',
        title: 'Transaction Committed',
        message: `${actionType} of ${actionQty} units committed. Correlation ID: ${correlationId}`
      });
      setActionModalOpen(false);
      loadData();
      handleResolveCode(queryPayload);
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Transaction Rejected',
        message: err.message
      });
    } finally {
      setSubmittingAction(false);
    }
  };

  const handlePrintLabels = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Hidden container for image decoding */}
      <div id="hidden-qr-reader" className="hidden" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-slate-900 border border-slate-800 text-white">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-[#0D9488]">
              Floor Mobility & Barcode Inspection
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-[#0D9488]/20 text-[#0D9488] font-mono font-bold flex items-center gap-1">
              <Zap className="w-3 h-3 text-[#0D9488] animate-pulse" /> Real-Time Live Optical Scanner
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight mt-1">
            Real-Time Optical Camera QR & Barcode Scanner
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Live camera video feed with auto-targeting reticle, ultrasonic scan beep, GS1 barcode decoding, instant authoritative database resolution, and append-only ledger transaction execution.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              soundEnabled ? 'bg-[#0D9488]/15 border-[#0D9488]/40 text-[#0D9488]' : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}
            title="Toggle scanner audio feedback"
          >
            <Volume2 className="w-4 h-4" />
            <span className="text-[11px] hidden sm:inline">{soundEnabled ? 'Beep On' : 'Muted'}</span>
          </button>

          <button
            onClick={handlePrintLabels}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs border border-slate-700 shadow-sm flex items-center gap-2 transition-colors shrink-0"
          >
            <Printer className="w-4 h-4 text-[#0D9488]" />
            Print Pallet Labels
          </button>
        </div>
      </div>

      {/* Top Split: Live Camera / Scanner Viewport & Resolution Display */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Real-Time Optical Scanner Viewport */}
        <div className="lg:col-span-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-5 shadow-sm space-y-4">
          
          {/* Scanner Mode Switcher */}
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setScanMode('camera')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                  scanMode === 'camera'
                    ? 'bg-[#0D9488]/100 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Camera className="w-3.5 h-3.5" /> Live Camera
              </button>
              <button
                type="button"
                onClick={() => setScanMode('upload')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                  scanMode === 'upload'
                    ? 'bg-[#0D9488]/100 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Upload className="w-3.5 h-3.5" /> Upload File
              </button>
              <button
                type="button"
                onClick={() => setScanMode('manual')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                  scanMode === 'manual'
                    ? 'bg-[#0D9488]/100 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Barcode className="w-3.5 h-3.5" /> Gun / Input
              </button>
            </div>

            {scanMode === 'camera' && cameraActive && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCameraFacing(prev => prev === 'environment' ? 'user' : 'environment')}
                  className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-200"
                  title="Switch Front/Rear Camera"
                >
                  <SwitchCamera className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="p-1.5 rounded-lg bg-[#17324D]/15 text-[#17324D] hover:bg-[#17324D]/20"
                  title="Stop Camera Stream"
                >
                  <CameraOff className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Camera Viewport */}
          {scanMode === 'camera' && (
            <div className="relative rounded-2xl overflow-hidden bg-black aspect-video border border-slate-800 shadow-inner flex items-center justify-center">
              {cameraActive ? (
                <>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />

                  {/* Animated Laser Scanning Line */}
                  <div className="scanner-laser-line" />

                  {/* Viewfinder Target Reticle */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-8">
                    <div className="relative w-48 h-48 sm:w-56 sm:h-56">
                      {/* Corner brackets */}
                      <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-[#0D9488] rounded-tl-lg" />
                      <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-[#0D9488] rounded-tr-lg" />
                      <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-[#0D9488] rounded-bl-lg" />
                      <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-[#0D9488] rounded-br-lg" />
                      
                      {/* Central crosshair */}
                      <div className="absolute inset-0 m-auto w-3 h-3 border border-[#0D9488]/40 rounded-full animate-ping" />
                    </div>
                  </div>

                  {/* Real-Time Status HUD */}
                  <div className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-black/75 backdrop-blur-md text-[10px] font-mono text-[#0D9488] flex items-center gap-1.5 border border-[#0D9488]/30">
                    <span className="w-2 h-2 rounded-full bg-[#0D9488] animate-pulse" />
                    LIVE OPTICAL STREAM • {cameraFacing.toUpperCase()}
                  </div>

                  {lastScannedCode && (
                    <div className="absolute bottom-3 inset-x-3 p-2 rounded-xl bg-slate-900/90 backdrop-blur-md border border-[#0D9488]/40 text-[11px] font-mono text-[#0D9488] flex items-center justify-between">
                      <div className="truncate mr-2">
                        <span className="text-slate-400">DETECTED: </span>{lastScannedCode}
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#0D9488]/20 text-[#0D9488] font-bold shrink-0">
                        RESOLVED
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center p-6 space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
                    <Camera className="w-6 h-6" />
                  </div>
                  <div className="text-xs text-slate-300 font-semibold">Camera is currently paused or inactive</div>
                  {cameraError && (
                    <div className="text-[11px] text-[#17324D] max-w-sm font-mono mx-auto">
                      {cameraError}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={startCamera}
                    className="px-4 py-2 rounded-xl bg-[#0D9488]/100 hover:bg-[#0D9488] text-white font-bold text-xs shadow-md shadow-sm"
                  >
                    Activate Optical Camera
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Upload Mode */}
          {scanMode === 'upload' && (
            <div className="p-8 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl text-center space-y-3 bg-slate-50 dark:bg-slate-950/40">
              <Upload className="w-8 h-8 text-[#0D9488] mx-auto" />
              <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Drop QR / Barcode image file or browse from device
              </div>
              <p className="text-[11px] text-slate-400">
                Supports PNG, JPG, WEBP, carton packaging photos, and shipping manifests.
              </p>
              <label className="inline-block px-4 py-2 rounded-xl bg-[#0D9488]/100 hover:bg-[#0D9488] text-white font-bold text-xs cursor-pointer shadow-md">
                <span>Select Image File</span>
                <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
              </label>
            </div>
          )}

          {/* Manual Input Mode */}
          {scanMode === 'manual' && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Identifier String / Handheld Scanner Input
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={queryPayload}
                    onChange={(e) => setQueryPayload(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleResolveCode()}
                    placeholder="e.g. PRD-VAX-01, BN-VX-2026-A1, or STOCKPILOT://SKU/..."
                    className="w-full pl-9 pr-3 py-2.5 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-mono focus:outline-none focus:border-[#0D9488]"
                  />
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleResolveCode()}
                disabled={resolving}
                className="w-full py-2.5 rounded-xl bg-[#0D9488] hover:bg-[#0D9488] text-white font-bold text-xs shadow-md shadow-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              >
                <QrCode className="w-4 h-4" />
                {resolving ? 'Resolving Identifier...' : 'Resolve Stock Record'}
              </button>
            </div>
          )}

          {/* Quick Demo Pre-Fills */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
              Instant 1-Click Verification Samples:
            </span>
            <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
              <button
                type="button"
                onClick={() => {
                  const c = 'STOCKPILOT://SKU/PRD-VAX-01/ORG/org_triwiz_01';
                  setQueryPayload(c);
                  playScanBeep();
                  handleResolveCode(c);
                }}
                className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800/70 hover:bg-[#0D9488]/10 border border-slate-200 dark:border-slate-700 hover:border-[#0D9488]/40 text-left truncate text-[#0D9488]"
              >
                ➔ PRD-VAX-01 (Vaccine SKU)
              </button>
              <button
                type="button"
                onClick={() => {
                  const c = 'STOCKPILOT://BATCH/BN-VX-2026-A1/WH/wh_chicago_01';
                  setQueryPayload(c);
                  playScanBeep();
                  handleResolveCode(c);
                }}
                className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800/70 hover:bg-[#0D9488]/10 border border-slate-200 dark:border-slate-700 hover:border-[#0D9488]/40 text-left truncate text-[#0D9488]"
              >
                ➔ Batch BN-VX-2026-A1 (FEFO)
              </button>
              <button
                type="button"
                onClick={() => {
                  const c = '8901234567891';
                  setQueryPayload(c);
                  playScanBeep();
                  handleResolveCode(c);
                }}
                className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800/70 hover:bg-[#0D9488]/10 border border-slate-200 dark:border-slate-700 hover:border-[#0D9488]/40 text-left truncate text-[#0D9488]"
              >
                ➔ Barcode: 8901234567891 (EAN)
              </button>
              <button
                type="button"
                onClick={() => {
                  const c = 'STOCKPILOT://TRANSFER/trf_001_chi_ny';
                  setQueryPayload(c);
                  playScanBeep();
                  handleResolveCode(c);
                }}
                className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800/70 hover:bg-[#0D9488]/10 border border-slate-200 dark:border-slate-700 hover:border-[#0D9488]/40 text-left truncate text-[#0D9488]"
              >
                ➔ Transfer trf_001_chi_ny
              </button>
            </div>
          </div>
        </div>

        {/* Resolved Details View */}
        <div className="lg:col-span-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#0D9488]" />
              Authoritative Inventory Context
            </h3>
            {resolvedResult && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#0D9488]/10 text-[#0D9488] border border-[#0D9488]/20">
                VERIFIED MATCH ({resolvedResult.resolved_type?.toUpperCase()})
              </span>
            )}
          </div>

          {!resolvedResult ? (
            <div className="p-12 text-center text-xs text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
              Point camera at a pharmaceutical barcode or click a demo payload above to inspect records and trigger floor ledger operations.
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              {/* Product Header */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-[#0D9488] text-sm">
                      {resolvedResult.sku || resolvedResult.product?.sku || 'SKU'}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {resolvedResult.handling || resolvedResult.product?.handling || 'STANDARD'}
                    </span>
                    {resolvedResult.batch_number && (
                      <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-teal-500/10 text-teal-400 border border-teal-500/20">
                        BATCH #{resolvedResult.batch_number}
                      </span>
                    )}
                  </div>
                  <h4 className="text-base font-bold text-slate-900 dark:text-white mt-1">
                    {resolvedResult.product_name || resolvedResult.product?.name || 'Item'}
                  </h4>
                  <div className="text-[11px] text-slate-500 mt-1">
                    {resolvedResult.storage_bin && `Storage Bin: ${resolvedResult.storage_bin} • `}
                    {resolvedResult.expiry_date && `Expiry: ${resolvedResult.expiry_date} • `}
                    Category: {resolvedResult.category || resolvedResult.product?.category || 'Biologics'}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Available Stock</div>
                  <div className="text-2xl font-black text-[#0D9488] font-mono-num">
                    {resolvedResult.total_available ?? resolvedResult.current_stock ?? 0} units
                  </div>
                </div>
              </div>

              {/* Action Buttons to trigger transactions */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setActionType('RECEIVE');
                    setActionModalOpen(true);
                  }}
                  className="py-2.5 px-3 rounded-xl bg-[#0D9488]/15 hover:bg-[#0D9488]/25 border border-[#0D9488]/30 text-[#0D9488] font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <ArrowDownLeft className="w-3.5 h-3.5" />
                  Receive Stock
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActionType('DISPATCH');
                    setActionModalOpen(true);
                  }}
                  className="py-2.5 px-3 rounded-xl bg-[#0D9488]/10 hover:bg-[#0D9488]/15 border border-[#0D9488]/30 text-[#0D9488] font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <ArrowUpRight className="w-3.5 h-3.5" />
                  Dispatch Stock
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActionType('CYCLE_COUNT');
                    setActionModalOpen(true);
                  }}
                  className="py-2.5 px-3 rounded-xl bg-[#17324D]/10 hover:bg-[#17324D]/15 border border-[#17324D]/20 text-[#17324D] font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <ClipboardCheck className="w-3.5 h-3.5" />
                  Cycle Count
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActionType('DAMAGE');
                    setActionModalOpen(true);
                  }}
                  className="py-2.5 px-3 rounded-xl bg-[#17324D]/10 hover:bg-[#17324D]/15 border border-[#17324D]/25 text-[#17324D] font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Report Damage
                </button>
              </div>

              {/* Active Batches or Transfer info */}
              {resolvedResult.active_batches && resolvedResult.active_batches.length > 0 && (
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
                          <span className="font-mono font-bold text-[#0D9488]">{b.batch_number}</span>
                          <span className="text-slate-400 ml-2">({b.supplier_reference || 'Standard Lot'})</span>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            Bin: {b.storage_bin} • Expiry: {b.expiry_date}
                          </div>
                        </div>
                        <div className="text-right font-mono-num">
                          <span className="font-bold text-slate-900 dark:text-white">{b.quantity} units</span>
                          <div className="text-[10px] text-[#0D9488] font-bold">ACTIVE</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* If Transfer details */}
              {resolvedResult.resolved_type === 'transfer' && resolvedResult.transfer && (
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-900/40 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-[#0D9488]">Transfer Route:</span>
                    <span className="font-mono text-[#0D9488] font-bold">{resolvedResult.status}</span>
                  </div>
                  <div className="text-[11px] text-slate-300">
                    From: {resolvedResult.source_warehouse?.name || 'Origin'} ➔ To: {resolvedResult.target_warehouse?.name || 'Destination'}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Cargo: {resolvedResult.items?.map((i: any) => `${i.product_name} (${i.quantity} units)`).join(', ')}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Movement Audit Log for Floor Actions */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-[#0D9488]" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">
              Authoritative Floor Movement Audit Trail
            </h3>
          </div>
          <button
            onClick={loadData}
            className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-[10px] uppercase font-bold text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-2.5 px-3">Transaction ID</th>
                <th className="py-2.5 px-3">Action Type</th>
                <th className="py-2.5 px-3">Product / Batch</th>
                <th className="py-2.5 px-3">Route / Location</th>
                <th className="py-2.5 px-3">Quantity Delta</th>
                <th className="py-2.5 px-3">Actor</th>
                <th className="py-2.5 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono text-[11px]">
              {recentMovements.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-500 font-sans">
                    No recent inventory movements recorded.
                  </td>
                </tr>
              ) : (
                recentMovements.slice(0, 6).map((m: any) => (
                  <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                    <td className="py-2.5 px-3 text-[#0D9488] truncate max-w-[120px]">{m.id}</td>
                    <td className="py-2.5 px-3 uppercase font-bold text-slate-300">{m.movement_type}</td>
                    <td className="py-2.5 px-3 text-slate-200">{m.product_sku || m.product_name}</td>
                    <td className="py-2.5 px-3 text-slate-400">{m.source_name} ➔ {m.destination_name}</td>
                    <td className={`py-2.5 px-3 font-bold ${m.quantity_changed > 0 ? 'text-[#0D9488]' : 'text-[#17324D]'}`}>
                      {m.quantity_changed > 0 ? `+${m.quantity_changed}` : m.quantity_changed} {m.unit}
                    </td>
                    <td className="py-2.5 px-3 text-slate-400">{m.actor_name || 'Operator'}</td>
                    <td className="py-2.5 px-3">
                      <span className="px-1.5 py-0.5 rounded bg-[#0D9488]/10 text-[#0D9488] text-[10px] font-bold">
                        {m.resulting_status || 'COMMITTED'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Batch & Product QR Generator Panel */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">
              Printable Pallet & Batch QR Label Generator
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Generates high-contrast printable thermal pallet labels with encoded GS1 / StockPilot batch and product identifiers.
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
            <button
              onClick={() => setLabelGeneratorTab('batches')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                labelGeneratorTab === 'batches'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Batch Pallet Labels ({batches.length})
            </button>
            <button
              onClick={() => setLabelGeneratorTab('products')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                labelGeneratorTab === 'products'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Product Catalog Codes ({products.length})
            </button>
          </div>
        </div>

        {labelGeneratorTab === 'batches' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {batches.slice(0, 6).map((b) => (
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

                  <div className="flex items-center gap-4">
                    <div className="p-2 border border-slate-300 rounded-xl bg-white shadow-sm shrink-0">
                      <QRCodeSVG
                        value={`STOCKPILOT://BATCH/${b.batch_number}/WH/${b.warehouse_id}`}
                        size={88}
                        level="M"
                      />
                    </div>
                    <div className="space-y-1 text-[11px] font-mono">
                      <div><span className="font-bold text-slate-600">LOT:</span> {b.batch_number}</div>
                      <div><span className="font-bold text-slate-600">QTY:</span> {b.quantity} units</div>
                      <div><span className="font-bold text-slate-600">EXP:</span> {b.expiry_date}</div>
                      <div><span className="font-bold text-slate-600">REF:</span> {b.supplier_reference}</div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-2 border-t border-slate-200 text-[10px] text-slate-500 flex justify-between items-center">
                  <span>Authoritative Pallet Tag</span>
                  <span className="font-mono text-[#0D9488] font-bold">FEFO MONITORED</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {products.slice(0, 6).map((p) => (
              <div
                key={p.id}
                className="p-5 rounded-2xl border-2 border-slate-300 dark:border-slate-700 bg-white text-slate-950 flex flex-col justify-between shadow-lg"
              >
                <div>
                  <div className="flex justify-between items-start border-b-2 border-slate-950 pb-2 mb-3">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-wider">STOCKPILOT AI</span>
                      <h4 className="text-sm font-black tracking-tight">{p.name}</h4>
                    </div>
                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 bg-[#17324D] text-white rounded uppercase">
                      {p.handling}
                    </span>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="p-2 border border-slate-300 rounded-xl bg-white shadow-sm shrink-0">
                      <QRCodeSVG
                        value={p.qr_code_payload || `STOCKPILOT://SKU/${p.sku}/ORG/${p.org_id}`}
                        size={88}
                        level="M"
                      />
                    </div>
                    <div className="space-y-1 text-[11px] font-mono">
                      <div><span className="font-bold text-slate-600">SKU:</span> {p.sku}</div>
                      <div><span className="font-bold text-slate-600">CAT:</span> {p.category}</div>
                      <div><span className="font-bold text-slate-600">BARCODE:</span> {p.barcode || '8901234567891'}</div>
                      <div><span className="font-bold text-slate-600">SHELF:</span> {p.shelf_life_days} days</div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-2 border-t border-slate-200 text-[10px] text-slate-500 flex justify-between items-center">
                  <span>Standard Catalog Code</span>
                  <span className="font-mono text-[#0D9488] font-bold">VALIDATED SKU</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Floor Action Execution Modal */}
      {actionModalOpen && resolvedResult && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 text-white space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2 text-[#0D9488]">
                <ClipboardCheck className="w-4 h-4" />
                Commit Floor Action: {actionType}
              </h3>
              <button
                type="button"
                onClick={() => setActionModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700 text-xs space-y-1">
              <div className="font-bold text-[#0D9488] text-sm">
                {resolvedResult.product_name || resolvedResult.product?.name} ({resolvedResult.sku || resolvedResult.product?.sku})
              </div>
              <div className="text-[11px] text-slate-400">
                Facility: {resolvedResult.warehouse_id || 'wh_chicago_01'} • Available: {resolvedResult.total_available ?? resolvedResult.current_stock ?? 0} units
              </div>
            </div>

            <div className="space-y-3 pt-2 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">
                  Quantity ({actionType === 'CYCLE_COUNT' ? 'Physical Count' : 'Movement Units'})
                </label>
                <input
                  type="number"
                  min="1"
                  value={actionQty}
                  onChange={(e) => setActionQty(parseInt(e.target.value) || 0)}
                  className="w-full p-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white font-mono focus:outline-none focus:border-[#0D9488]"
                />
              </div>

              {actionType === 'DISPATCH' && (
                <div>
                  <label className="block text-slate-300 font-bold mb-1">Destination Facility</label>
                  <select
                    value={actionDestination}
                    onChange={(e) => setActionDestination(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white focus:outline-none focus:border-[#0D9488]"
                  >
                    <option value="dest_boston_01">Boston General Hospital (Level 1 Trauma)</option>
                    <option value="dest_metro_icu_02">Metropolitan Clinic ICU</option>
                    <option value="dest_mayo_pharma_03">Mayo Regional Dispensary</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-slate-300 font-bold mb-1">Storage Bay / Bin</label>
                <input
                  type="text"
                  value={actionBin}
                  onChange={(e) => setActionBin(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white font-mono focus:outline-none focus:border-[#0D9488]"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">Reason / Operator Notes</label>
                <input
                  type="text"
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  placeholder="e.g. Scanned pallet receipt at loading dock 4"
                  className="w-full p-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white focus:outline-none focus:border-[#0D9488]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setActionModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteOperation}
                disabled={submittingAction || actionQty <= 0}
                className="px-5 py-2 rounded-xl bg-[#0D9488] hover:bg-[#0D9488] text-white text-xs font-bold shadow-lg shadow-sm flex items-center gap-1.5 disabled:opacity-50"
              >
                {submittingAction ? 'Committing Transaction...' : `Confirm ${actionType}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QRScannerPage;
