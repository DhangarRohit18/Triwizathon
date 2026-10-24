import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useAppStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border shadow-lg backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-2 ${
            t.type === 'success'
              ? 'bg-[#17324D] border-[#0D9488] text-white ring-1 ring-[#0D9488]/40'
              : t.type === 'error'
              ? 'bg-[#17324D] border-white/30 text-white'
              : t.type === 'warning'
              ? 'bg-[#17324D] border-[#0D9488]/50 text-white'
              : 'bg-[#17324D] border-white/20 text-white'
          }`}
        >
          <div className="shrink-0 mt-0.5">
            {t.type === 'success' && <CheckCircle2 className="w-4 h-4 text-[#0D9488]" />}
            {t.type === 'error' && <AlertCircle className="w-4 h-4 text-white" />}
            {t.type === 'warning' && <AlertTriangle className="w-4 h-4 text-[#0D9488]" />}
            {t.type === 'info' && <Info className="w-4 h-4 text-[#0D9488]" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#0D9488]">
                [{t.type}]
              </span>
              <h4 className="text-xs font-semibold leading-tight text-white">{t.title}</h4>
            </div>
            {t.message && <p className="text-xs mt-1 text-white/80 leading-normal">{t.message}</p>}
          </div>
          <button
            onClick={() => removeToast(t.id)}
            className="shrink-0 p-1 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
