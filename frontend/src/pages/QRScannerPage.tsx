import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';
import { api } from '../services/api';
import { useAppStore } from '../store/useAppStore';
import { Product, InventoryBatch, Warehouse } from '../types';
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
  Zap,
  Download,
  PlusCircle,
  AlertTriangle,
  SlidersHorizontal,
  Layers,
  Eye,
  X,
  PackagePlus,
  Boxes,
  Check
} from 'lucide-react';

export const QRScannerPage: React.FC = () => {
  const { addToast } = useAppStore();
  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<InventoryBatch[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
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
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<any>(null);

  // Scan / Resolve state
  const [queryPayload, setQueryPayload] = useState('STOCKPILOT://SKU/PRD-VAX-01/ORG/org_triwiz_01');
  const [resolving, setResolving] = useState(false);
  const [resolvedResult, setResolvedResult] = useState<any>(null);
  const [resolutionError, setResolutionError] = useState<{ code: string; message: string } | null>(null);

  // Label generator view mode: 'batches' | 'products'
  const [labelGeneratorTab, setLabelGeneratorTab] = useState<'batches' | 'products'>('batches');

  // Floor operation modal state
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [actionType, setActionType] = useState<'RECEIVE' | 'DISPATCH' | 'ADJUST' | 'CYCLE_COUNT' | 'DAMAGE'>('RECEIVE');
  const [actionQty, setActionQty] = useState(50);
  const [actionReason, setActionReason] = useState('Floor workflow execution');
  const [actionDestination, setActionDestination] = useState('dest_boston_01');
  const [actionWarehouseId, setActionWarehouseId] = useState('wh_chicago_01');
  const [actionBatchId, setActionBatchId] = useState('');
  const [actionBin, setActionBin] = useState('BIN-A-01');
  const [submittingAction, setSubmittingAction] = useState(false);

  // Product Registration Modal state
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [registerSubmitting, setRegisterSubmitting] = useState(false);
  const [newProductForm, setNewProductForm] = useState({
    sku: '',
    name: '',
    category: 'Biologics',
    description: '',
    unit: 'vials',
    unit_cost: 24.50,
    selling_price: 48.00,
    handling: 'cold_chain' as 'cold_chain' | 'deep_freeze' | 'ambient' | 'hazardous' | 'fragile',
    min_safety_stock: 50,
    reorder_point: 100,
    shelf_life_days: 365,
    initial_warehouse_id: 'wh_chicago_01',
    initial_quantity: 50,
    initial_bin: 'BIN-COLD-01'
  });

  // Enlarged QR Preview modal
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewQrData, setPreviewQrData] = useState<{
    title: string;
    subtitle: string;
    code: string;
    details: Record<string, string>;
    id: string;
  } | null>(null);

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
    api.warehouses.list().then(w => {
      setWarehouses(w);
      if (w.length > 0) {
        setActionWarehouseId(prev => prev || w[0].id);
        setNewProductForm(prev => ({
          ...prev,
          initial_warehouse_id: prev.initial_warehouse_id || w[0].id
        }));
      }
    }).catch(console.error);
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
          // ignore frame detection errors
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
    } catch {
      addToast({
        type: 'error',
        title: 'Image Scan Failed',
        message: 'Could not detect a legible QR or Barcode in the uploaded image.'
      });
    }
  };

  const handleResolveCode = async (codeToResolve?: string) => {
    const target = (codeToResolve !== undefined ? codeToResolve : queryPayload).trim();
    if (!target) return;
    setResolving(true);
    setResolutionError(null);
    try {
      const data = await api.products.resolveQr(target);
      setResolvedResult(data);
      setResolutionError(null);
      if (data.warehouse_id) setActionWarehouseId(data.warehouse_id);
      if (data.batch_id) setActionBatchId(data.batch_id);
      else if (data.active_batches && data.active_batches.length > 0) {
        setActionBatchId(data.active_batches[0].id);
      }
      addToast({
        type: 'success',
        title: 'Identifier Verified',
        message: `Validated ${data.resolved_type.toUpperCase()}: ${data.product_name || data.product?.name || data.batch?.batch_number}`
      });
    } catch (err: any) {
      setResolvedResult(null);
      setResolutionError({
        code: target,
        message: err.message || 'No product, batch, or transfer found matching QR payload.'
      });
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
    const warehouseId = actionWarehouseId || resolvedResult.warehouse_id || resolvedResult.batch?.warehouse_id || 'wh_chicago_01';
    const batchId = actionBatchId || resolvedResult.batch_id || resolvedResult.batch?.id || resolvedResult.active_batches?.[0]?.id || 'bat_vax_chi_01';
    const batchNumber = resolvedResult.batch_number || resolvedResult.batch?.batch_number || `LOT-${Date.now().toString().slice(-4)}`;

    try {
      if (actionType === 'RECEIVE') {
        await api.inventory.receiveStock({
          correlation_id: correlationId,
          warehouse_id: warehouseId,
          product_id: productId,
          batch_number: batchNumber,
          supplier_reference: 'Vendor Delivery Direct',
          mfg_date: new Date().toISOString().split('T')[0],
          expiry_date: new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0],
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
      } else if (actionType === 'ADJUST') {
        if (!batchId) {
          throw new Error("A valid active inventory batch is required to adjust stock quantity.");
        }
        await api.inventory.adjustStock({
          correlation_id: correlationId,
          warehouse_id: warehouseId,
          product_id: productId,
          batch_id: batchId,
          new_quantity: actionQty,
          reason: actionReason || 'Manual inventory reconciliation via QR scanner',
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

  // Client-side high-resolution PNG download for thermal labels
  const downloadQrCode = (svgId: string, filename: string) => {
    const svg = document.getElementById(svgId);
    if (!svg) {
      addToast({ type: 'error', title: 'Download Error', message: 'QR Code element not found in DOM.' });
      return;
    }
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    
    img.onload = () => {
      canvas.width = 512;
      canvas.height = 512;
      if (ctx) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, 512, 512);
        ctx.drawImage(img, 32, 32, 448, 448);
        const pngUrl = canvas.toDataURL('image/png');
        const downloadLink = document.createElement('a');
        downloadLink.download = `${filename}.png`;
        downloadLink.href = pngUrl;
        downloadLink.click();
        addToast({
          type: 'success',
          title: 'Label Downloaded',
          message: `Saved high-res PNG: ${filename}.png`
        });
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const handlePrintLabels = () => {
    window.print();
  };

  // Product Registration Handler
  const handleRegisterProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProductForm.sku.trim() || !newProductForm.name.trim()) {
      addToast({ type: 'error', title: 'Validation Error', message: 'Product SKU and Name are required.' });
      return;
    }

    setRegisterSubmitting(true);
    try {
      const cleanSku = newProductForm.sku.trim().toUpperCase();
      const createdProd = await api.products.create({
        sku: cleanSku,
        name: newProductForm.name.trim(),
        category: newProductForm.category.trim(),
        description: newProductForm.description.trim(),
        unit: newProductForm.unit,
        unit_cost: Number(newProductForm.unit_cost) || 15,
        selling_price: Number(newProductForm.selling_price) || 30,
        handling: newProductForm.handling,
        min_safety_stock: Number(newProductForm.min_safety_stock) || 50,
        reorder_point: Number(newProductForm.reorder_point) || 100,
        shelf_life_days: Number(newProductForm.shelf_life_days) || 365,
        weight_kg: 0.5
      });

      // If initial stock was specified, seed initial batch immediately
      if (newProductForm.initial_quantity > 0) {
        const correlationId = `INIT-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const batchNum = `LOT-${cleanSku}-${new Date().getFullYear()}`;
        await api.inventory.receiveStock({
          correlation_id: correlationId,
          warehouse_id: newProductForm.initial_warehouse_id || 'wh_chicago_01',
          product_id: createdProd.id,
          batch_number: batchNum,
          supplier_reference: 'Initial Product Registration Stock',
          mfg_date: new Date().toISOString().split('T')[0],
          expiry_date: new Date(Date.now() + (newProductForm.shelf_life_days || 365) * 86400000).toISOString().split('T')[0],
          quantity: Number(newProductForm.initial_quantity),
          unit_cost: Number(newProductForm.unit_cost) || 15,
          storage_bin: newProductForm.initial_bin || 'BIN-A-01',
        });
      }

      addToast({
        type: 'success',
        title: 'Product Registered',
        message: `Registered ${createdProd.name} (${createdProd.sku}). Authoritative QR code generated.`
      });

      setRegisterModalOpen(false);
      loadData();

      // Automatically inspect the newly registered product
      const targetPayload = createdProd.qr_code_payload || `STOCKPILOT://SKU/${createdProd.sku}/ORG/${createdProd.org_id}`;
      setQueryPayload(targetPayload);
      handleResolveCode(targetPayload);
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Registration Rejected',
        message: err.message
      });
    } finally {
      setRegisterSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Hidden container for image file decoding */}
      <div id="hidden-qr-reader" className="hidden" />

      {/* Embedded Print Styles for Clean Thermal Label Output */}
      <style>{`
        @media print {
          body {
            background: #ffffff !important;
            color: #000000 !important;
          }
          header, nav, aside, .no-print, .scanner-laser-line, button, input {
            display: none !important;
          }
          .printable-label {
            break-inside: avoid;
            page-break-inside: avoid;
            margin-bottom: 1.5rem;
            border: 2px solid #000 !important;
            box-shadow: none !important;
          }
        }
      `}</style>

      {/* Header with 3-Color Strict Theme (#FFFFFF, #17324D, #0D9488) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-[#17324D] text-white shadow-sm border border-[#17324D]/30 no-print">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-[#0D9488]">
              Floor Mobility & Barcode Inspection
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-[#0D9488]/20 text-[#0D9488] font-mono font-bold flex items-center gap-1 border border-[#0D9488]/30">
              <Zap className="w-3 h-3 text-[#0D9488] animate-pulse" /> Real-Time Live Optical Scanner
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight mt-1">
            QR & Barcode Inventory Tracking Engine
          </h1>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl">
            Live camera video feed with auto-targeting reticle, ultrasonic scan feedback, GS1 / EAN decoding, instant authoritative database resolution, product registration, and ledger updates.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              soundEnabled ? 'bg-[#0D9488]/20 border-[#0D9488]/50 text-[#0D9488]' : 'bg-[#17324D] border-slate-700 text-slate-400'
            }`}
            title="Toggle scanner audio feedback"
          >
            <Volume2 className="w-4 h-4" />
            <span className="text-[11px] hidden sm:inline">{soundEnabled ? 'Beep On' : 'Muted'}</span>
          </button>

          <button
            onClick={() => setRegisterModalOpen(true)}
            className="px-4 py-2.5 rounded-xl bg-[#0D9488] hover:bg-[#0D9488]/90 text-white font-bold text-xs shadow-md flex items-center gap-2 transition-all shrink-0"
          >
            <PackagePlus className="w-4 h-4" />
            Register Product
          </button>

          <button
            onClick={handlePrintLabels}
            className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs border border-white/20 shadow-sm flex items-center gap-2 transition-colors shrink-0"
          >
            <Printer className="w-4 h-4 text-[#0D9488]" />
            Print Labels
          </button>
        </div>
      </div>

      {/* Top Split: Live Camera / Scanner Viewport & Resolution Display */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 no-print">
        
        {/* Real-Time Optical Scanner Viewport */}
        <div className="lg:col-span-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          
          {/* Scanner Mode Switcher */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setScanMode('camera')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                  scanMode === 'camera'
                    ? 'bg-[#0D9488] text-white shadow-sm'
                    : 'text-[#17324D]/70 hover:text-[#17324D]'
                }`}
              >
                <Camera className="w-3.5 h-3.5" /> Live Camera
              </button>
              <button
                type="button"
                onClick={() => setScanMode('upload')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                  scanMode === 'upload'
                    ? 'bg-[#0D9488] text-white shadow-sm'
                    : 'text-[#17324D]/70 hover:text-[#17324D]'
                }`}
              >
                <Upload className="w-3.5 h-3.5" /> Upload File
              </button>
              <button
                type="button"
                onClick={() => setScanMode('manual')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                  scanMode === 'manual'
                    ? 'bg-[#0D9488] text-white shadow-sm'
                    : 'text-[#17324D]/70 hover:text-[#17324D]'
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
                  className="p-1.5 rounded-lg bg-slate-100 text-[#17324D] hover:bg-slate-200"
                  title="Switch Front/Rear Camera"
                >
                  <SwitchCamera className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="p-1.5 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100"
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
                      {/* Corner brackets in #0D9488 Teal */}
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
                    <div className="text-[11px] text-rose-400 max-w-sm font-mono mx-auto">
                      {cameraError}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={startCamera}
                    className="px-4 py-2 rounded-xl bg-[#0D9488] hover:bg-[#0D9488]/90 text-white font-bold text-xs shadow-md"
                  >
                    Activate Optical Camera
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Upload Mode */}
          {scanMode === 'upload' && (
            <div className="p-8 border-2 border-dashed border-slate-300 rounded-2xl text-center space-y-3 bg-slate-50">
              <Upload className="w-8 h-8 text-[#0D9488] mx-auto" />
              <div className="text-xs font-bold text-[#17324D]">
                Drop QR / Barcode image file or browse from device
              </div>
              <p className="text-[11px] text-slate-500">
                Supports PNG, JPG, WEBP, carton packaging photos, and shipping manifests.
              </p>
              <label className="inline-block px-4 py-2 rounded-xl bg-[#0D9488] hover:bg-[#0D9488]/90 text-white font-bold text-xs cursor-pointer shadow-md">
                <span>Select Image File</span>
                <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
              </label>
            </div>
          )}

          {/* Manual Input Mode */}
          {scanMode === 'manual' && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-[#17324D] block mb-1">
                  Identifier String / Handheld Scanner Gun Input
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={queryPayload}
                    onChange={(e) => setQueryPayload(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleResolveCode()}
                    placeholder="e.g. PRD-VAX-01, BN-VX-2026-A1, or STOCKPILOT://SKU/..."
                    className="w-full pl-9 pr-3 py-2.5 text-xs rounded-xl bg-slate-50 border border-slate-200 text-[#17324D] font-mono focus:outline-none focus:border-[#0D9488]"
                  />
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleResolveCode()}
                disabled={resolving}
                className="w-full py-2.5 rounded-xl bg-[#0D9488] hover:bg-[#0D9488]/90 text-white font-bold text-xs shadow-md flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              >
                <QrCode className="w-4 h-4" />
                {resolving ? 'Resolving Identifier...' : 'Resolve Stock Record'}
              </button>
            </div>
          )}

          {/* Quick Verification Samples */}
          <div className="pt-2 border-t border-slate-100">
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
                className="p-2 rounded-lg bg-slate-50 hover:bg-[#0D9488]/10 border border-slate-200 hover:border-[#0D9488]/40 text-left truncate text-[#0D9488] font-semibold"
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
                className="p-2 rounded-lg bg-slate-50 hover:bg-[#0D9488]/10 border border-slate-200 hover:border-[#0D9488]/40 text-left truncate text-[#0D9488] font-semibold"
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
                className="p-2 rounded-lg bg-slate-50 hover:bg-[#0D9488]/10 border border-slate-200 hover:border-[#0D9488]/40 text-left truncate text-[#0D9488] font-semibold"
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
                className="p-2 rounded-lg bg-slate-50 hover:bg-[#0D9488]/10 border border-slate-200 hover:border-[#0D9488]/40 text-left truncate text-[#0D9488] font-semibold"
              >
                ➔ Transfer trf_001_chi_ny
              </button>
            </div>
          </div>
        </div>

        {/* Resolved Details View / Invalid QR Diagnostic Display */}
        <div className="lg:col-span-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#17324D] flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#0D9488]" />
              Authoritative Inventory Context
            </h3>
            {resolvedResult && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#0D9488]/10 text-[#0D9488] border border-[#0D9488]/20">
                VERIFIED MATCH ({resolvedResult.resolved_type?.toUpperCase()})
              </span>
            )}
            {resolutionError && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-50 text-rose-600 border border-rose-200">
                RESOLUTION FAILED
              </span>
            )}
          </div>

          {/* Diagnostic Error State for Invalid / Unrecognized QR */}
          {resolutionError && !resolvedResult && (
            <div className="p-5 rounded-2xl border-2 border-rose-200 bg-rose-50/50 space-y-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-rose-100 text-rose-600 shrink-0">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-rose-800">
                    Unrecognized or Invalid QR Identifier
                  </h4>
                  <div className="text-xs text-rose-700 mt-1">
                    {resolutionError.message}
                  </div>
                  <div className="mt-2 p-2 rounded-lg bg-white border border-rose-200 font-mono text-[11px] text-[#17324D] break-all">
                    <span className="font-bold text-slate-500">Payload: </span>{resolutionError.code}
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-slate-600 space-y-1 pl-1">
                <div className="font-bold text-[#17324D]">Diagnostic Troubleshooting:</div>
                <div>• Verify whether this item belongs to your current organization tenant.</div>
                <div>• Ensure the barcode format conforms to GS1-128, EAN-13, or StockPilot URI protocols.</div>
                <div>• If this is a newly received pharma product, you can register it into the catalog immediately.</div>
              </div>

              <div className="flex items-center gap-2 pt-1 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    setNewProductForm(prev => ({
                      ...prev,
                      sku: resolutionError.code.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20).toUpperCase() || 'NEW-SKU-01',
                      name: `New Scanned Item (${resolutionError.code.slice(0, 12)})`
                    }));
                    setRegisterModalOpen(true);
                  }}
                  className="px-3 py-2 rounded-xl bg-[#0D9488] hover:bg-[#0D9488]/90 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm"
                >
                  <PackagePlus className="w-3.5 h-3.5" />
                  Register Product with this Code
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setScanMode('manual');
                    setResolutionError(null);
                  }}
                  className="px-3 py-2 rounded-xl bg-white border border-slate-300 text-[#17324D] font-bold text-xs hover:bg-slate-50"
                >
                  Manual SKU Search
                </button>
              </div>
            </div>
          )}

          {/* Idle Placeholder */}
          {!resolvedResult && !resolutionError && (
            <div className="p-12 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl space-y-2">
              <QrCode className="w-8 h-8 mx-auto text-slate-300" />
              <div>Point camera at a pharmaceutical barcode or click a demo payload above to inspect records and trigger floor ledger operations.</div>
            </div>
          )}

          {/* Validated Product / Batch / Transfer View */}
          {resolvedResult && (
            <div className="space-y-4 text-xs">
              {/* Product Header Card with Integrated QR Code */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-[#0D9488] text-sm">
                      {resolvedResult.sku || resolvedResult.product?.sku || 'SKU'}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase bg-[#17324D] text-white">
                      {resolvedResult.handling || resolvedResult.product?.handling || 'STANDARD'}
                    </span>
                    {resolvedResult.batch_number && (
                      <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-[#0D9488]/15 text-[#0D9488] border border-[#0D9488]/30">
                        BATCH #{resolvedResult.batch_number}
                      </span>
                    )}
                  </div>
                  <h4 className="text-base font-bold text-[#17324D] mt-1">
                    {resolvedResult.product_name || resolvedResult.product?.name || 'Item'}
                  </h4>
                  <div className="text-[11px] text-slate-500">
                    {resolvedResult.storage_bin && `Storage Bin: ${resolvedResult.storage_bin} • `}
                    {resolvedResult.expiry_date && `Expiry: ${resolvedResult.expiry_date} • `}
                    Category: {resolvedResult.category || resolvedResult.product?.category || 'Biologics'}
                  </div>
                  <div className="text-[11px] font-mono text-slate-600">
                    Warehouse: {resolvedResult.warehouse_id || actionWarehouseId} • Cost: ${resolvedResult.unit_cost ?? 20} / {resolvedResult.unit || 'unit'}
                  </div>
                </div>

                {/* Right side: Stock and QR Thumbnail with Download */}
                <div className="flex items-center gap-3 shrink-0 self-start sm:self-auto">
                  <div className="text-right">
                    <div className="text-[10px] text-slate-400 uppercase font-bold">Available Stock</div>
                    <div className="text-2xl font-black text-[#0D9488] font-mono-num">
                      {resolvedResult.total_available ?? resolvedResult.current_stock ?? 0}
                    </div>
                    <div className="text-[10px] text-slate-500">{resolvedResult.unit || 'units'} on hand</div>
                  </div>

                  <div className="p-1.5 bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col items-center">
                    <QRCodeSVG
                      id="active-resolved-qr"
                      value={resolvedResult.product?.qr_code_payload || queryPayload}
                      size={56}
                      level="M"
                    />
                    <button
                      type="button"
                      onClick={() => downloadQrCode('active-resolved-qr', `QR_${resolvedResult.sku || 'ITEM'}`)}
                      className="text-[9px] font-bold text-[#0D9488] hover:underline mt-1 flex items-center gap-0.5"
                      title="Download PNG"
                    >
                      <Download className="w-2.5 h-2.5" /> PNG
                    </button>
                  </div>
                </div>
              </div>

              {/* 5 Real-Time Operations Buttons (Receive, Dispatch, Adjust, Count, Damage) */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setActionType('RECEIVE');
                    setActionModalOpen(true);
                  }}
                  className="py-2.5 px-2 rounded-xl bg-[#0D9488] hover:bg-[#0D9488]/90 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                >
                  <ArrowDownLeft className="w-3.5 h-3.5" />
                  Receive
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActionType('DISPATCH');
                    setActionModalOpen(true);
                  }}
                  className="py-2.5 px-2 rounded-xl bg-[#17324D] hover:bg-[#17324D]/90 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                >
                  <ArrowUpRight className="w-3.5 h-3.5 text-[#0D9488]" />
                  Dispatch
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActionType('ADJUST');
                    setActionQty(resolvedResult.total_available ?? resolvedResult.current_stock ?? 50);
                    setActionReason('Physical inventory audit adjustment');
                    setActionModalOpen(true);
                  }}
                  className="py-2.5 px-2 rounded-xl bg-[#0D9488]/15 hover:bg-[#0D9488]/25 border border-[#0D9488]/40 text-[#0D9488] font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  Adjust Stock
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActionType('CYCLE_COUNT');
                    setActionQty(resolvedResult.total_available ?? resolvedResult.current_stock ?? 50);
                    setActionModalOpen(true);
                  }}
                  className="py-2.5 px-2 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-[#17324D] font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <ClipboardCheck className="w-3.5 h-3.5" />
                  Cycle Count
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActionType('DAMAGE');
                    setActionQty(1);
                    setActionReason('Inspection breakage report');
                    setActionModalOpen(true);
                  }}
                  className="py-2.5 px-2 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Damage
                </button>
              </div>

              {/* Active Batches Breakdown */}
              {resolvedResult.active_batches && resolvedResult.active_batches.length > 0 && (
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-[#17324D] mb-2 flex items-center justify-between">
                    <span>Active Batches in Network ({resolvedResult.active_batches.length})</span>
                    <span className="text-[10px] text-slate-500 font-normal">FEFO Auto-Sorted</span>
                  </div>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {resolvedResult.active_batches.map((b: any) => (
                      <div
                        key={b.id}
                        className="p-3 rounded-xl border border-slate-200 bg-white flex items-center justify-between hover:border-[#0D9488]/40 transition-colors"
                      >
                        <div>
                          <span className="font-mono font-bold text-[#0D9488]">{b.batch_number}</span>
                          <span className="text-slate-500 ml-2">({b.supplier_reference || 'Standard Lot'})</span>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            Bin: {b.storage_bin} • Expiry: {b.expiry_date}
                          </div>
                        </div>
                        <div className="text-right font-mono-num flex items-center gap-2">
                          <div>
                            <span className="font-bold text-[#17324D]">{b.quantity} units</span>
                            <div className="text-[10px] text-[#0D9488] font-bold">ACTIVE</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setActionBatchId(b.id);
                              setActionWarehouseId(b.warehouse_id);
                              setActionType('ADJUST');
                              setActionQty(b.quantity);
                              setActionModalOpen(true);
                            }}
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-[#0D9488]/15 text-[#0D9488]"
                            title="Adjust this batch"
                          >
                            <SlidersHorizontal className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Transfer Details Card if Resolved Type is Transfer */}
              {resolvedResult.resolved_type === 'transfer' && resolvedResult.transfer && (
                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-[#17324D]">Transfer Cargo Manifest:</span>
                    <span className="font-mono text-[#0D9488] font-bold uppercase">{resolvedResult.status}</span>
                  </div>
                  <div className="text-[11px] text-slate-600">
                    From: {resolvedResult.source_warehouse?.name || 'Origin'} ➔ To: {resolvedResult.target_warehouse?.name || 'Destination'}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Cargo: {resolvedResult.items?.map((i: any) => `${i.product_name} (${i.quantity} units)`).join(', ')}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Movement Audit Log for Floor Actions */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4 no-print">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-[#0D9488]" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#17324D]">
              Authoritative Floor Movement Audit Trail (Ledger Synced)
            </h3>
          </div>
          <button
            onClick={loadData}
            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-[#17324D] transition-colors"
            title="Refresh Ledger"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
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
            <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
              {recentMovements.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-500 font-sans">
                    No recent inventory movements recorded.
                  </td>
                </tr>
              ) : (
                recentMovements.slice(0, 6).map((m: any) => (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 text-[#0D9488] font-bold truncate max-w-[120px]">{m.id}</td>
                    <td className="py-2.5 px-3 uppercase font-bold text-[#17324D]">{m.movement_type}</td>
                    <td className="py-2.5 px-3 text-slate-800">{m.product_sku || m.product_name}</td>
                    <td className="py-2.5 px-3 text-slate-600">{m.source_name} ➔ {m.destination_name}</td>
                    <td className={`py-2.5 px-3 font-bold ${m.quantity_changed > 0 ? 'text-[#0D9488]' : 'text-rose-600'}`}>
                      {m.quantity_changed > 0 ? `+${m.quantity_changed}` : m.quantity_changed} {m.unit}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">{m.actor_name || 'Operator'}</td>
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

      {/* Batch & Product QR Generator Panel (Print & Download Ready) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4 no-print">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#17324D]">
              Printable Pallet & Batch QR Label Generator
            </h3>
            <p className="text-[11px] text-slate-500">
              Generates high-contrast printable thermal pallet labels with encoded GS1 / StockPilot batch and product identifiers.
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
            <button
              onClick={() => setLabelGeneratorTab('batches')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                labelGeneratorTab === 'batches'
                  ? 'bg-white text-[#17324D] shadow-sm'
                  : 'text-slate-500 hover:text-[#17324D]'
              }`}
            >
              Batch Pallet Labels ({batches.length})
            </button>
            <button
              onClick={() => setLabelGeneratorTab('products')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                labelGeneratorTab === 'products'
                  ? 'bg-white text-[#17324D] shadow-sm'
                  : 'text-slate-500 hover:text-[#17324D]'
              }`}
            >
              Product Catalog Codes ({products.length})
            </button>
          </div>
        </div>

        {/* Tab 1: Batch Pallet Labels */}
        {labelGeneratorTab === 'batches' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {batches.map((b) => {
              const svgId = `batch-qr-${b.id}`;
              const qrValue = `STOCKPILOT://BATCH/${b.batch_number}/WH/${b.warehouse_id}`;
              return (
                <div
                  key={b.id}
                  className="printable-label p-5 rounded-2xl border-2 border-slate-800 bg-white text-slate-950 flex flex-col justify-between shadow-md"
                >
                  <div>
                    <div className="flex justify-between items-start border-b-2 border-slate-950 pb-2 mb-3">
                      <div>
                        <span className="text-[10px] font-black uppercase tracking-wider text-[#0D9488]">STOCKPILOT AI</span>
                        <h4 className="text-sm font-black tracking-tight">{b.product_name}</h4>
                      </div>
                      <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 bg-[#17324D] text-white rounded">
                        {b.storage_bin}
                      </span>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="p-2 border border-slate-300 rounded-xl bg-white shadow-xs shrink-0">
                        <QRCodeSVG
                          id={svgId}
                          value={qrValue}
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
                    <span>Pallet Tag • <span className="font-mono font-bold text-[#0D9488]">FEFO MONITORED</span></span>
                    
                    <div className="flex items-center gap-1.5 no-print">
                      <button
                        type="button"
                        onClick={() => downloadQrCode(svgId, `Pallet_${b.batch_number}`)}
                        className="px-2 py-1 rounded bg-slate-100 hover:bg-[#0D9488]/15 text-[#0D9488] font-bold text-[10px] flex items-center gap-1"
                        title="Download PNG QR Label"
                      >
                        <Download className="w-3 h-3" /> PNG
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setQueryPayload(qrValue);
                          playScanBeep();
                          handleResolveCode(qrValue);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="px-2 py-1 rounded bg-[#17324D] text-white font-bold text-[10px] flex items-center gap-1"
                        title="Scan this batch into inspector"
                      >
                        <QrCode className="w-3 h-3" /> Scan
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Tab 2: Product Catalog Labels */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {products.map((p) => {
              const svgId = `prod-qr-${p.id}`;
              const qrValue = p.qr_code_payload || `STOCKPILOT://SKU/${p.sku}/ORG/${p.org_id}`;
              return (
                <div
                  key={p.id}
                  className="printable-label p-5 rounded-2xl border-2 border-slate-800 bg-white text-slate-950 flex flex-col justify-between shadow-md"
                >
                  <div>
                    <div className="flex justify-between items-start border-b-2 border-slate-950 pb-2 mb-3">
                      <div>
                        <span className="text-[10px] font-black uppercase tracking-wider text-[#0D9488]">STOCKPILOT AI</span>
                        <h4 className="text-sm font-black tracking-tight">{p.name}</h4>
                      </div>
                      <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 bg-[#17324D] text-white rounded uppercase">
                        {p.handling}
                      </span>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="p-2 border border-slate-300 rounded-xl bg-white shadow-xs shrink-0">
                        <QRCodeSVG
                          id={svgId}
                          value={qrValue}
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
                    <span>Catalog Label • <span className="font-mono text-[#0D9488] font-bold">VALIDATED SKU</span></span>
                    
                    <div className="flex items-center gap-1.5 no-print">
                      <button
                        type="button"
                        onClick={() => downloadQrCode(svgId, `Product_${p.sku}`)}
                        className="px-2 py-1 rounded bg-slate-100 hover:bg-[#0D9488]/15 text-[#0D9488] font-bold text-[10px] flex items-center gap-1"
                        title="Download PNG QR Label"
                      >
                        <Download className="w-3 h-3" /> PNG
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setQueryPayload(qrValue);
                          playScanBeep();
                          handleResolveCode(qrValue);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="px-2 py-1 rounded bg-[#17324D] text-white font-bold text-[10px] flex items-center gap-1"
                        title="Scan this product into inspector"
                      >
                        <QrCode className="w-3 h-3" /> Scan
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floor Action Execution Modal (Receive, Dispatch, Adjust, Cycle Count, Damage) */}
      {actionModalOpen && resolvedResult && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 no-print">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2 text-[#17324D]">
                <ClipboardCheck className="w-4 h-4 text-[#0D9488]" />
                Commit Floor Action: {actionType}
              </h3>
              <button
                type="button"
                onClick={() => setActionModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
              <div className="font-bold text-[#17324D] text-sm">
                {resolvedResult.product_name || resolvedResult.product?.name} ({resolvedResult.sku || resolvedResult.product?.sku})
              </div>
              <div className="text-[11px] text-slate-500 font-mono">
                Facility: {actionWarehouseId} • Current Available: {resolvedResult.total_available ?? resolvedResult.current_stock ?? 0} {resolvedResult.unit || 'units'}
              </div>
            </div>

            <div className="space-y-3 pt-2 text-xs">
              <div>
                <label className="block text-[#17324D] font-bold mb-1">
                  {actionType === 'CYCLE_COUNT' ? 'Counted Physical Stock' : actionType === 'ADJUST' ? 'New Target Stock Quantity' : 'Quantity Units'}
                </label>
                <input
                  type="number"
                  min="0"
                  value={actionQty}
                  onChange={(e) => setActionQty(parseInt(e.target.value) || 0)}
                  className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[#17324D] font-mono focus:outline-none focus:border-[#0D9488]"
                />
              </div>

              {actionType === 'DISPATCH' && (
                <div>
                  <label className="block text-[#17324D] font-bold mb-1">Destination Facility</label>
                  <select
                    value={actionDestination}
                    onChange={(e) => setActionDestination(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[#17324D] focus:outline-none focus:border-[#0D9488]"
                  >
                    <option value="dest_boston_01">Boston General Hospital (Level 1 Trauma)</option>
                    <option value="dest_metro_icu_02">Metropolitan Clinic ICU</option>
                    <option value="dest_mayo_pharma_03">Mayo Regional Dispensary</option>
                  </select>
                </div>
              )}

              {actionType === 'RECEIVE' && (
                <div>
                  <label className="block text-[#17324D] font-bold mb-1">Storage Bay / Bin</label>
                  <input
                    type="text"
                    value={actionBin}
                    onChange={(e) => setActionBin(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[#17324D] font-mono focus:outline-none focus:border-[#0D9488]"
                  />
                </div>
              )}

              <div>
                <label className="block text-[#17324D] font-bold mb-1">Reason / Operator Notes</label>
                <input
                  type="text"
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  placeholder="e.g. Scanned pallet receipt at loading dock 4"
                  className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[#17324D] focus:outline-none focus:border-[#0D9488]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setActionModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteOperation}
                disabled={submittingAction || (actionType !== 'ADJUST' && actionQty <= 0)}
                className="px-5 py-2 rounded-xl bg-[#0D9488] hover:bg-[#0D9488]/90 text-white text-xs font-bold shadow-md flex items-center gap-1.5 disabled:opacity-50"
              >
                {submittingAction ? 'Committing Transaction...' : `Confirm ${actionType}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Product Registration Modal */}
      {registerModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto no-print">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 space-y-4 shadow-2xl my-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2 text-[#17324D]">
                  <PackagePlus className="w-4 h-4 text-[#0D9488]" />
                  Register New Product & Generate QR Code
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Provisions product into organization registry with auto-generated barcode and QR identifier.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRegisterModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRegisterProduct} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#17324D] font-bold mb-1">Product SKU *</label>
                  <input
                    type="text"
                    required
                    value={newProductForm.sku}
                    onChange={(e) => setNewProductForm({ ...newProductForm, sku: e.target.value.toUpperCase() })}
                    placeholder="e.g. PRD-INSULIN-01"
                    className="w-full p-2 rounded-xl bg-slate-50 border border-slate-200 font-mono text-[#17324D] uppercase focus:outline-none focus:border-[#0D9488]"
                  />
                </div>
                <div>
                  <label className="block text-[#17324D] font-bold mb-1">Product Name *</label>
                  <input
                    type="text"
                    required
                    value={newProductForm.name}
                    onChange={(e) => setNewProductForm({ ...newProductForm, name: e.target.value })}
                    placeholder="e.g. Recombinant Human Insulin 100IU"
                    className="w-full p-2 rounded-xl bg-slate-50 border border-slate-200 text-[#17324D] focus:outline-none focus:border-[#0D9488]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#17324D] font-bold mb-1">Category</label>
                  <select
                    value={newProductForm.category}
                    onChange={(e) => setNewProductForm({ ...newProductForm, category: e.target.value })}
                    className="w-full p-2 rounded-xl bg-slate-50 border border-slate-200 text-[#17324D] focus:outline-none focus:border-[#0D9488]"
                  >
                    <option value="Biologics">Biologics / Vaccines</option>
                    <option value="Antibiotics">Antibiotics</option>
                    <option value="Cardiovascular">Cardiovascular</option>
                    <option value="Critical Care">Critical Care / ICU</option>
                    <option value="Medical Supplies">Medical Supplies</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[#17324D] font-bold mb-1">Handling Protocol</label>
                  <select
                    value={newProductForm.handling}
                    onChange={(e) => setNewProductForm({ ...newProductForm, handling: e.target.value as any })}
                    className="w-full p-2 rounded-xl bg-slate-50 border border-slate-200 text-[#17324D] focus:outline-none focus:border-[#0D9488]"
                  >
                    <option value="cold_chain">Cold Chain (2°C - 8°C)</option>
                    <option value="deep_freeze">Deep Freeze (-20°C)</option>
                    <option value="ambient">Ambient (15°C - 25°C)</option>
                    <option value="hazardous">Hazardous / Bio-Hazard</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[#17324D] font-bold mb-1">Unit Cost ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newProductForm.unit_cost}
                    onChange={(e) => setNewProductForm({ ...newProductForm, unit_cost: parseFloat(e.target.value) || 0 })}
                    className="w-full p-2 rounded-xl bg-slate-50 border border-slate-200 font-mono text-[#17324D] focus:outline-none focus:border-[#0D9488]"
                  />
                </div>
                <div>
                  <label className="block text-[#17324D] font-bold mb-1">Selling Price ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newProductForm.selling_price}
                    onChange={(e) => setNewProductForm({ ...newProductForm, selling_price: parseFloat(e.target.value) || 0 })}
                    className="w-full p-2 rounded-xl bg-slate-50 border border-slate-200 font-mono text-[#17324D] focus:outline-none focus:border-[#0D9488]"
                  />
                </div>
                <div>
                  <label className="block text-[#17324D] font-bold mb-1">Shelf Life (Days)</label>
                  <input
                    type="number"
                    min="1"
                    value={newProductForm.shelf_life_days}
                    onChange={(e) => setNewProductForm({ ...newProductForm, shelf_life_days: parseInt(e.target.value) || 365 })}
                    className="w-full p-2 rounded-xl bg-slate-50 border border-slate-200 font-mono text-[#17324D] focus:outline-none focus:border-[#0D9488]"
                  />
                </div>
              </div>

              {/* Initial Inventory Provisioning */}
              <div className="p-3 rounded-xl bg-[#0D9488]/10 border border-[#0D9488]/30 space-y-2 mt-2">
                <div className="text-[11px] font-bold text-[#17324D] flex items-center gap-1.5">
                  <Boxes className="w-3.5 h-3.5 text-[#0D9488]" />
                  Initial Inventory & Pallet Provisioning (Optional)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] text-slate-600 font-bold mb-0.5">Warehouse</label>
                    <select
                      value={newProductForm.initial_warehouse_id}
                      onChange={(e) => setNewProductForm({ ...newProductForm, initial_warehouse_id: e.target.value })}
                      className="w-full p-1.5 text-xs rounded-lg bg-white border border-slate-200 text-[#17324D]"
                    >
                      {warehouses.map(w => (
                        <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-600 font-bold mb-0.5">Initial Quantity</label>
                    <input
                      type="number"
                      min="0"
                      value={newProductForm.initial_quantity}
                      onChange={(e) => setNewProductForm({ ...newProductForm, initial_quantity: parseInt(e.target.value) || 0 })}
                      className="w-full p-1.5 text-xs rounded-lg bg-white border border-slate-200 font-mono text-[#17324D]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-600 font-bold mb-0.5">Initial Bin</label>
                    <input
                      type="text"
                      value={newProductForm.initial_bin}
                      onChange={(e) => setNewProductForm({ ...newProductForm, initial_bin: e.target.value })}
                      className="w-full p-1.5 text-xs rounded-lg bg-white border border-slate-200 font-mono text-[#17324D]"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setRegisterModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={registerSubmitting}
                  className="px-5 py-2 rounded-xl bg-[#0D9488] hover:bg-[#0D9488]/90 text-white font-bold text-xs shadow-md flex items-center gap-1.5 disabled:opacity-50"
                >
                  <PackagePlus className="w-4 h-4" />
                  {registerSubmitting ? 'Registering...' : 'Register & Generate QR'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default QRScannerPage;
