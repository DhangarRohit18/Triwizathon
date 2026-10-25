import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../services/api';
import { useAppStore } from '../store/useAppStore';
import { 
  MessageSquare, 
  Send, 
  CheckCheck, 
  ShieldCheck, 
  Sparkles,
  QrCode,
  Smartphone,
  Phone,
  Radio,
  RefreshCw,
  Zap,
  Globe2,
  Terminal,
  Languages,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';

interface ChatMessage {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  time: string;
  language?: string;
  actionTaken?: string | null;
}

export const WhatsAppPage: React.FC = () => {
  const { addToast } = useAppStore();
  const [activeTab, setActiveTab] = useState<'bridge' | 'meta_cloud'>('bridge');

  // Bridge state
  const [bridgeStatus, setBridgeStatus] = useState<any>(null);
  const [loadingBridge, setLoadingBridge] = useState(false);
  const [pairingPhone, setPairingPhone] = useState('+91 99758 19201');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);

  // Chat simulator state
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'msg_0',
      sender: 'bot',
      text: "🤖 *STOCKPILOT AI Mobile Assistant*\nAuthenticated as: *Elena Rostova* (SUPPLY_CHAIN_MANAGER)\nConnected via: *WhatsApp Linked Device Bridge (Baileys)*\n\nLanguage support: *English*, *हिंदी*, *मराठी*, *Hinglish*, *Minglish*.\n\nAvailable Commands:\n• *STATUS* - Network inventory & warehouse health\n• *STOCK <SKU>* - Check stock levels (e.g. `STOCK PRD-VAX-01`)\n• *ALERTS* - Active IoT cold-chain alerts\n• *TRANSFERS* - Pending inter-warehouse transfers\n• *APPROVE <TRF_ID>* - Approve transfer (Managers only)\n• *HUMAN* - Escalate to Operations Desk",
      time: '10:00 AM',
      language: 'English'
    }
  ]);
  const [loading, setLoading] = useState(false);
  const [webhookLogs, setWebhookLogs] = useState<any[]>([]);

  const loadLogs = async () => {
    try {
      const logs = await api.whatsapp.getLogs();
      setWebhookLogs(logs);
    } catch (err: any) {
      console.error(err);
    }
  };

  const loadBridgeStatus = async () => {
    setLoadingBridge(true);
    try {
      const status = await api.whatsapp.getBridgeStatus();
      setBridgeStatus(status);
      if (status.pairingCode) {
        setPairingCode(status.pairingCode);
      }
    } catch (err: any) {
      console.warn("Could not fetch bridge status:", err);
    } finally {
      setLoadingBridge(false);
    }
  };

  useEffect(() => {
    loadLogs();
    loadBridgeStatus();
    const interval = setInterval(loadBridgeStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  const handlePairPhone = async () => {
    if (!pairingPhone.trim()) return;
    setPairingLoading(true);
    try {
      const res = await api.whatsapp.pairBridge(pairingPhone.trim());
      setPairingCode(res.pairing_code);
      addToast({
        type: 'success',
        title: 'Pairing Code Generated',
        message: `Code: ${res.pairing_code}. Enter in WhatsApp > Linked Devices > Link with phone number.`
      });
      loadBridgeStatus();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Pairing Request Failed', message: err.message });
    } finally {
      setPairingLoading(false);
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const text = textToSend || inputText;
    if (!text.trim()) return;

    const userMsg: ChatMessage = {
      id: `usr_${Date.now()}`,
      sender: 'user',
      text: text.trim(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setLoading(true);

    try {
      const res = await api.whatsapp.simulateChat(text.trim());
      const botMsg: ChatMessage = {
        id: `bot_${Date.now()}`,
        sender: 'bot',
        text: res.reply_text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        language: res.language || 'English',
        actionTaken: res.action_taken
      };
      setMessages(prev => [...prev, botMsg]);
      loadLogs();
    } catch (err: any) {
      addToast({ type: 'error', title: 'WhatsApp query error', message: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-slate-900 border border-slate-800 text-white">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-[#0D9488]">
              Autonomous WhatsApp Business Bridge
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-[#0D9488]/20 text-[#0D9488] font-mono font-bold flex items-center gap-1">
              <Zap className="w-3 h-3 text-[#0D9488]" /> Linked Device QR & Meta Cloud API
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight mt-1">
            WhatsApp Bot, Linked Device Bridge & Multilingual NLP
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Connect any Indian or international WhatsApp mobile SIM via Linked Device QR (Baileys) or Meta Cloud API. Ingests English, Hindi, and Marathi supply inquiries with authoritative stock and transfer dispatches.
          </p>
        </div>

        {/* Tab Controls */}
        <div className="flex items-center gap-1 p-1 bg-slate-800 rounded-xl border border-slate-700 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('bridge')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${
              activeTab === 'bridge'
                ? 'bg-[#0D9488] text-slate-950 font-black shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" /> Linked Device Bridge
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('meta_cloud')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${
              activeTab === 'meta_cloud'
                ? 'bg-[#0D9488] text-slate-950 font-black shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" /> Meta Cloud Webhook
          </button>
        </div>
      </div>

      {activeTab === 'bridge' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left Column: Live WhatsApp QR & Pairing Code */}
          <div className="lg:col-span-5 space-y-5">
            {/* Connection Status Card */}
            <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Radio className="w-4 h-4 text-[#0D9488]" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">
                    Linked Device Status
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={loadBridgeStatus}
                  disabled={loadingBridge}
                  className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-200"
                  title="Refresh Bridge Status"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingBridge ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {/* Status Pill */}
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full ${
                    bridgeStatus?.status === 'CONNECTED' 
                      ? 'bg-[#0D9488] shadow-md shadow-sm' 
                      : bridgeStatus?.qrString
                      ? 'bg-amber-400 animate-pulse'
                      : 'bg-slate-500'
                  }`} />
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-white">
                      {bridgeStatus?.status === 'CONNECTED' 
                        ? 'ONLINE & LINKED' 
                        : bridgeStatus?.qrString 
                        ? 'QR CODE READY' 
                        : bridgeStatus?.pairingCode 
                        ? 'PAIRING CODE READY'
                        : 'STANDBY / OFFLINE'}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono">
                      {bridgeStatus?.phone 
                        ? `+${bridgeStatus.phone} (${bridgeStatus.name || 'StockPilot Bot'})` 
                        : bridgeStatus?.qrString 
                        ? 'Live QR session ready to scan'
                        : 'Linked Device bridge is in standby mode'}
                    </div>
                  </div>
                </div>

                <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-[#0D9488]/10 text-[#0D9488] border border-[#0D9488]/20">
                  BAILEYS v2.3
                </span>
              </div>

              {/* Live QR Code Box / Active / Standby */}
              {bridgeStatus?.status === 'CONNECTED' ? (
                <div className="flex flex-col items-center justify-center p-6 border border-emerald-500/20 rounded-2xl bg-emerald-500/5 text-center space-y-3">
                  <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                    <CheckCircle2 className="w-7 h-7" />
                  </div>
                  <div className="text-sm font-black text-emerald-400 uppercase tracking-wider">
                    WhatsApp Session Active
                  </div>
                  <p className="text-[11px] text-slate-400 max-w-xs font-mono">
                    Connected phone: +{bridgeStatus.phone}
                  </p>
                </div>
              ) : bridgeStatus?.qrString ? (
                <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-white text-center space-y-3">
                  <div className="p-3 bg-white rounded-xl shadow-md border border-slate-200">
                    <QRCodeSVG
                      value={bridgeStatus.qrString}
                      size={180}
                      level="M"
                    />
                  </div>
                  <div className="text-xs font-black text-slate-900 uppercase tracking-wider">
                    Scan with WhatsApp on your Phone
                  </div>
                  <p className="text-[11px] text-slate-500 max-w-xs">
                    Go to WhatsApp ➔ Settings / Menu (⋮) ➔ <strong>Linked Devices</strong> ➔ <strong>Link a Device</strong>.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50 dark:bg-slate-950/40 text-center space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-slate-400">
                    <QrCode className="w-6 h-6" />
                  </div>
                  <div className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    Bridge in Standby Mode
                  </div>
                  <p className="text-[11px] text-slate-500 max-w-xs">
                    Start the WhatsApp Web Linked Device bridge worker or request a pairing code below to link a device:
                  </p>
                  <code className="text-[10px] bg-slate-900 text-teal-400 px-2.5 py-1 rounded font-mono border border-slate-800">
                    node scripts/whatsapp-web-bridge.js
                  </code>
                </div>
              )}

              {/* Phone Pairing Code Option */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2.5">
                <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-[#0D9488]" />
                  Link with Phone Number Instead (Pairing Code)
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={pairingPhone}
                    onChange={(e) => setPairingPhone(e.target.value)}
                    placeholder="+91 99758 19201"
                    className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 font-mono text-slate-900 dark:text-white focus:outline-none focus:border-[#0D9488]"
                  />
                  <button
                    type="button"
                    onClick={handlePairPhone}
                    disabled={pairingLoading}
                    className="px-3 py-1.5 rounded-lg bg-[#0D9488]/100 hover:bg-[#0D9488] text-white font-bold text-xs shadow-sm disabled:opacity-50"
                  >
                    {pairingLoading ? '...' : 'Get Code'}
                  </button>
                </div>

                {pairingCode && (
                  <div className="p-2.5 rounded-lg bg-[#0D9488]/10 border border-[#0D9488]/30 text-center">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">8-Digit Pairing Code:</span>
                    <span className="text-base font-black font-mono tracking-widest text-[#0D9488]">
                      {pairingCode}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Live WhatsApp Conversation & NLP Engine */}
          <div className="lg:col-span-7 space-y-5">
            {/* Chat Viewport */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 shadow-sm flex flex-col h-[580px]">
              {/* Chat Topbar */}
              <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950/60 rounded-t-2xl">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-[#0D9488] flex items-center justify-center text-slate-950 font-black shadow-md">
                    SP
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      StockPilot Logistics Desk
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#0D9488]" />
                    </h3>
                    <div className="text-[10px] text-[#0D9488] flex items-center gap-1 font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#0D9488] animate-pulse" />
                      Multi-Lingual Autonomous Bot Online
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono">
                  <Languages className="w-3 h-3 text-[#0D9488]" /> EN • HI • MR
                </div>
              </div>

              {/* Messages Body */}
              <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-[#e5ddd5]/30 dark:bg-[#080d17]/50 industrial-grid">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[85%] sm:max-w-[75%] p-3 rounded-2xl text-xs shadow-sm ${
                        m.sender === 'user'
                          ? 'bg-[#0D9488] text-white rounded-tr-none'
                          : 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-tl-none border border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      <div className="whitespace-pre-wrap leading-relaxed">{m.text}</div>
                      <div className="flex items-center justify-end gap-1.5 mt-1 text-[9px] opacity-70">
                        {m.language && (
                          <span className="px-1 rounded bg-slate-900/30 text-white font-mono font-bold">
                            {m.language}
                          </span>
                        )}
                        <span>{m.time}</span>
                        {m.sender === 'user' && <CheckCheck className="w-3 h-3 text-[#0D9488]" />}
                      </div>
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex items-center gap-2 text-xs text-slate-400 italic">
                    <span className="w-2 h-2 rounded-full bg-[#0D9488] animate-bounce" />
                    StockPilot NLP Engine is formulating response...
                  </div>
                )}
              </div>

              {/* Quick Multi-Lingual Prompt Pills */}
              <div className="p-2.5 bg-slate-50 dark:bg-slate-950/80 border-t border-slate-200 dark:border-slate-800 flex items-center gap-1.5 overflow-x-auto text-[11px] font-medium text-slate-600 dark:text-slate-400">
                <span className="text-[10px] uppercase font-bold text-slate-400 shrink-0">Try Asking:</span>
                <button
                  type="button"
                  onClick={() => handleSendMessage('Vaccine ka stock kitna hai?')}
                  className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:border-[#0D9488] text-[#0D9488] shrink-0 truncate font-mono text-[10px]"
                >
                  🇮🇳 "Vaccine ka stock kitna hai?"
                </button>
                <button
                  type="button"
                  onClick={() => handleSendMessage('Chicago hub cold room status kay ahe?')}
                  className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:border-[#0D9488] text-[#0D9488] shrink-0 truncate font-mono text-[10px]"
                >
                  🚩 "Chicago hub cold room status kay ahe?"
                </button>
                <button
                  type="button"
                  onClick={() => handleSendMessage('ALERTS')}
                  className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:border-[#0D9488] text-[#17324D] shrink-0 truncate font-mono text-[10px]"
                >
                  ⚡ "ALERTS"
                </button>
                <button
                  type="button"
                  onClick={() => handleSendMessage('APPROVE TRF-ORD-JFK-101')}
                  className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:border-[#0D9488] text-[#17324D] shrink-0 truncate font-mono text-[10px]"
                >
                  ✓ "APPROVE TRF-ORD-JFK-101"
                </button>
              </div>

              {/* Chat Input Bar */}
              <div className="p-3 bg-white dark:bg-slate-900 rounded-b-2xl border-t border-slate-200 dark:border-slate-800 flex items-center gap-2">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder="Type WhatsApp message in English, Hindi, or Marathi..."
                  className="flex-1 px-4 py-2 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:border-[#0D9488]"
                />
                <button
                  type="button"
                  onClick={() => handleSendMessage()}
                  disabled={loading || !inputText.trim()}
                  className="p-2 rounded-xl bg-[#0D9488] hover:bg-[#0D9488] text-white disabled:opacity-50 transition-colors shadow-md"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Meta Cloud API Webhook Logs & Verification */
        <div className="space-y-6">
          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">
                  Meta WhatsApp Cloud API Handshake Credentials
                </h3>
                <p className="text-[11px] text-slate-500">
                  Official Graph API webhook verification parameters and delivery audit receipts.
                </p>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-[#0D9488]/10 text-[#0D9488] border border-[#0D9488]/20">
                ACTIVE
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Webhook URL:</span>
                <span className="text-[#0D9488] font-bold break-all">https://api.stockpilot.ai/api/v1/whatsapp/webhook</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Verify Token:</span>
                <span className="text-[#0D9488] font-bold">stockpilot_wh_verify_secret_2026</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Signature Validation:</span>
                <span className="text-[#17324D] font-bold">HMAC-SHA256 (X-Hub-Signature)</span>
              </div>
            </div>
          </div>

          {/* Webhook Delivery Logs Table */}
          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">
                Notification & Webhook Transaction Ledger ({webhookLogs.length})
              </h3>
              <button
                type="button"
                onClick={loadLogs}
                className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-200"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-[10px] uppercase font-bold text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3">Correlation ID</th>
                    <th className="py-2.5 px-3">Phone Number</th>
                    <th className="py-2.5 px-3">Language</th>
                    <th className="py-2.5 px-3">Incoming Text</th>
                    <th className="py-2.5 px-3">Outgoing Response</th>
                    <th className="py-2.5 px-3">Delivery Status</th>
                    <th className="py-2.5 px-3">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono text-[11px]">
                  {webhookLogs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-slate-500 font-sans">
                        No WhatsApp logs recorded yet.
                      </td>
                    </tr>
                  ) : (
                    webhookLogs.slice(0, 10).map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className="py-2.5 px-3 text-[#0D9488] truncate max-w-[110px]">{log.id}</td>
                        <td className="py-2.5 px-3 text-slate-300">{log.from_number}</td>
                        <td className="py-2.5 px-3">
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-bold">
                            {log.language || 'English'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-200 truncate max-w-[150px]">{log.incoming_text}</td>
                        <td className="py-2.5 px-3 text-slate-400 truncate max-w-[200px]">{log.outgoing_reply}</td>
                        <td className="py-2.5 px-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            log.delivery_status === 'sent' || log.delivery_status === 'SIMULATED_LOCAL'
                              ? 'bg-[#0D9488]/10 text-[#0D9488]'
                              : 'bg-[#17324D]/10 text-[#17324D]'
                          }`}>
                            {log.delivery_status || 'DELIVERED'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 text-[10px]">
                          {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : 'Recent'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WhatsAppPage;
