import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useAppStore } from '../store/useAppStore';
import { 
  MessageSquare, 
  Send, 
  CheckCheck, 
  Bot, 
  User, 
  ShieldCheck, 
  Info, 
  Sparkles,
  Terminal,
  Code2
} from 'lucide-react';

interface ChatMessage {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  time: string;
  actionTaken?: string | null;
}

export const WhatsAppPage: React.FC = () => {
  const { addToast } = useAppStore();
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'msg_0',
      sender: 'bot',
      text: "🤖 *STOCKPILOT AI Mobile Assistant*\nAuthenticated as: *Elena Rostova* (SUPPLY_CHAIN_MANAGER)\n\nAvailable Commands:\n• *STATUS* - Network inventory & warehouse health\n• *STOCK <SKU>* - Check stock levels (e.g. `STOCK PRD-VAX-01`)\n• *ALERTS* - Active IoT cold-chain alerts\n• *TRANSFERS* - Pending inter-warehouse transfers\n• *APPROVE <TRF_ID>* - Approve transfer (Managers only)\n• *HUMAN* - Escalate to Operations Desk",
      time: '10:00 AM'
    }
  ]);
  const [loading, setLoading] = useState(false);
  const [webhookLogs, setWebhookLogs] = useState<any[]>([]);

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    try {
      const logs = await api.whatsapp.getLogs();
      setWebhookLogs(logs);
    } catch (err: any) {
      console.error(err);
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
        actionTaken: res.action_taken
      };
      setMessages(prev => [...prev, botMsg]);
      loadLogs();
    } catch (err: any) {
      addToast({ type: 'error', title: 'WhatsApp Simulator error', message: err.message });
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
            <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">
              Meta WhatsApp Business Cloud API
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-bold">
              Webhook Verified • HMAC-SHA256
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight mt-1">
            WhatsApp Mobile Assistant & Webhook Simulator
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Deterministic command engine for on-the-go stock queries, cold-chain anomaly alerts, and secure transfer approvals with sender phone number RBAC authorization.
          </p>
        </div>
      </div>

      {/* Main Split: WhatsApp Chat Simulator & Webhook Event Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* WhatsApp Mobile Chat Interface */}
        <div className="lg:col-span-5 rounded-3xl border border-slate-200 dark:border-slate-800 bg-[#0b141a] overflow-hidden shadow-2xl flex flex-col h-[600px]">
          {/* Chat Header */}
          <div className="bg-[#1f2c34] p-3.5 flex items-center justify-between border-b border-[#2a3942] text-white">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center font-bold text-sm shadow">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <div className="font-bold text-xs flex items-center gap-1.5">
                  <span>StockPilot AI Bot</span>
                  <CheckCheck className="w-3.5 h-3.5 text-sky-400" />
                </div>
                <div className="text-[10px] text-emerald-400">Official Business Account • Online</div>
              </div>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#111b21] text-slate-400">
              SIMULATOR
            </span>
          </div>

          {/* Chat Messages Body */}
          <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px]">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs shadow-md whitespace-pre-line leading-relaxed ${
                    m.sender === 'user'
                      ? 'bg-[#005c4b] text-[#e9edef] rounded-tr-none'
                      : 'bg-[#202c33] text-[#d1d7db] rounded-tl-none border border-[#2a3942]'
                  }`}
                >
                  {m.text}
                  <div className="text-[9px] text-right mt-1 text-slate-400 font-mono flex items-center justify-end gap-1">
                    <span>{m.time}</span>
                    {m.sender === 'user' && <CheckCheck className="w-3 h-3 text-sky-400" />}
                  </div>
                </div>

                {m.actionTaken && (
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 mt-1">
                    ✓ ACTION EXECUTED: {m.actionTaken}
                  </span>
                )}
              </div>
            ))}
            {loading && (
              <div className="text-left">
                <div className="inline-block bg-[#202c33] text-slate-400 px-3 py-1.5 rounded-xl text-xs animate-pulse">
                  StockPilot is typing...
                </div>
              </div>
            )}
          </div>

          {/* Quick Command Suggestions */}
          <div className="p-2 bg-[#1f2c34] border-t border-[#2a3942] flex gap-1.5 overflow-x-auto text-[11px]">
            <button
              onClick={() => handleSendMessage('STATUS')}
              className="px-2.5 py-1 rounded-full bg-[#111b21] hover:bg-emerald-950 text-emerald-300 font-medium whitespace-nowrap"
            >
              📊 STATUS
            </button>
            <button
              onClick={() => handleSendMessage('STOCK PRD-VAX-01')}
              className="px-2.5 py-1 rounded-full bg-[#111b21] hover:bg-emerald-950 text-emerald-300 font-medium whitespace-nowrap"
            >
              💉 STOCK VACCINE
            </button>
            <button
              onClick={() => handleSendMessage('ALERTS')}
              className="px-2.5 py-1 rounded-full bg-[#111b21] hover:bg-emerald-950 text-emerald-300 font-medium whitespace-nowrap"
            >
              🚨 ALERTS
            </button>
            <button
              onClick={() => handleSendMessage('TRANSFERS')}
              className="px-2.5 py-1 rounded-full bg-[#111b21] hover:bg-emerald-950 text-emerald-300 font-medium whitespace-nowrap"
            >
              📋 TRANSFERS
            </button>
            <button
              onClick={() => handleSendMessage('APPROVE trf_001_chi_ny')}
              className="px-2.5 py-1 rounded-full bg-[#111b21] hover:bg-emerald-950 text-emerald-300 font-medium whitespace-nowrap"
            >
              ✅ APPROVE TRF
            </button>
          </div>

          {/* Message Input Box */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="p-3 bg-[#202c33] flex items-center gap-2"
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Type WhatsApp command (e.g. STATUS, STOCK)..."
              className="flex-1 px-4 py-2.5 rounded-xl bg-[#2a3942] border-none text-[#d1d7db] text-xs focus:outline-none placeholder-slate-400"
            />
            <button
              type="submit"
              disabled={!inputText.trim() || loading}
              className="p-2.5 rounded-xl bg-[#00a884] hover:bg-[#02906f] text-slate-950 font-bold transition-colors disabled:opacity-40"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>

        {/* Webhook Configuration & Audit Event Logs */}
        <div className="lg:col-span-7 space-y-6">
          {/* Cloud API Connection Blueprint */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-5 shadow-sm space-y-3">
            <div className="flex items-center gap-2">
              <Code2 className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">
                Official Meta Cloud API Webhook Endpoints
              </h3>
            </div>

            <div className="space-y-2 text-xs font-mono">
              <div className="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex justify-between items-center">
                <div>
                  <span className="text-[10px] text-slate-400 font-sans block">Callback URL:</span>
                  <span className="text-emerald-400 font-bold">http://&lt;domain&gt;:8000/api/v1/whatsapp/webhook</span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400">POST + GET</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <span className="text-[10px] text-slate-400 font-sans block">Verify Token:</span>
                  <span className="text-slate-300">stockpilot_triwiz_verify_2026</span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <span className="text-[10px] text-slate-400 font-sans block">HMAC Signature Header:</span>
                  <span className="text-slate-300">X-Hub-Signature-256</span>
                </div>
              </div>
            </div>
          </div>

          {/* Webhook Activity Logs */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-sky-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">
                  Incoming Message & Action Audit Ledger ({webhookLogs.length})
                </h3>
              </div>
              <button
                onClick={loadLogs}
                className="text-xs text-sky-400 hover:underline font-semibold"
              >
                Refresh Logs
              </button>
            </div>

            <div className="overflow-x-auto max-h-[280px]">
              <table className="w-full text-left text-xs table-dense">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 text-[11px]">
                    <th>From Number</th>
                    <th>Inbound Text</th>
                    <th>Executed Action</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono-num">
                  {webhookLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="font-mono text-sky-400">{log.from_number}</td>
                      <td className="font-bold text-slate-800 dark:text-slate-200 font-sans max-w-xs truncate">
                        {log.incoming_text}
                      </td>
                      <td>
                        {log.action_taken ? (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-sans">
                            {log.action_taken}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-500 font-sans">Query Response</span>
                        )}
                      </td>
                      <td className="text-slate-500 text-[11px] font-mono">{log.timestamp.substring(11, 19)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
