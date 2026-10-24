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
          className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-lg border shadow-xl backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-2 ${
            t.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/30 text-emerald-100'
              : t.type === 'error'
              ? 'bg-rose-950/90 border-rose-500/30 text-rose-100'
              : t.type === 'warning'
              ? 'bg-amber-950/90 border-amber-500/30 text-amber-100'
              : 'bg-slate-900/90 border-slate-700 text-slate-100'
          }`}
        >
          <div className="shrink-0 mt-0.5">
            {t.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            {t.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-400" />}
            {t.type === 'warning' && <AlertTriangle className="w-4 h-4 text-amber-400" />}
            {t.type === 'info' && <Info className="w-4 h-4 text-sky-400" />}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-xs font-semibold leading-tight">{t.title}</h4>
            {t.message && <p className="text-xs mt-1 text-slate-300 opacity-90 leading-normal">{t.message}</p>}
          </div>
          <button
            onClick={() => removeToast(t.id)}
            className="shrink-0 p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
