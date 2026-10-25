import React, { useState, useEffect } from 'react';
import { 
  Zap, 
  Clock, 
  AlertTriangle, 
  ShieldAlert, 
  Truck, 
  ArrowRight, 
  CheckCircle2, 
  XCircle, 
  TrendingUp, 
  DollarSign, 
  FileText, 
  RefreshCw,
  Flame,
  Award,
  Sliders,
  ChevronRight,
  Info
} from 'lucide-react';
import { api } from '../services/api';

interface UrgencyClock {
  node_id: string;
  node_name: string;
  product_sku: string;
  product_name: string;
  current_stock: number;
  hourly_burn_rate: number;
  hours_to_stockout: number;
  next_delivery_eta_hours: number;
  stockout_probability: number;
  is_urgent: boolean;
  is_critical: boolean;
  is_essential: boolean;
  demand_slot: string;
  slot_share: number;
}

interface FulfillmentOption {
  option_type: string;
  name: string;
  tagline: string;
  eta_hours: number;
  extra_cost: number;
  units_delivered: number;
  units_saved: number;
  expected_lost_units: number;
  margin_saved: number;
  goodwill_saved: number;
  rescue_bonus: number;
  expected_waste_cost: number;
  net_benefit: number;
  is_feasible: boolean;
  infeasible_reason?: string;
  donor_node_id?: string;
  donor_node_name?: string;
  transit_km: number;
}

interface ExpressRecommendation {
  node_id: string;
  node_name: string;
  product_sku: string;
  product_name: string;
  clock: UrgencyClock;
  options: FulfillmentOption[];
  recommended_option_type: string;
  recommended_option: FulfillmentOption;
  rationale: string;
  is_critical_override: boolean;
  generated_at: string;
}

export const ExpressLanePage: React.FC = () => {
  const [enabled, setEnabled] = useState<boolean>(false);
  const [config, setConfig] = useState<any>(null);
  const [clocks, setClocks] = useState<UrgencyClock[]>([]);
  const [selectedSku, setSelectedSku] = useState<string>('PRD-VAX-01');
  const [selectedNodeId, setSelectedNodeId] = useState<string>('dest_boston_01');
  const [recommendation, setRecommendation] = useState<ExpressRecommendation | null>(null);
  const [simulation, setSimulation] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [evaluating, setEvaluating] = useState<boolean>(false);
  const [approving, setApproving] = useState<boolean>(false);
  const [approvalResult, setApprovalResult] = useState<any>(null);

  // Contention state
  const [contentionAlphaHours, setContentionAlphaHours] = useState<number>(0.8);
  const [contentionBetaHours, setContentionBetaHours] = useState<number>(2.5);
  const [contentionResult, setContentionResult] = useState<any>(null);

  useEffect(() => {
    loadInitialData();
  }, [selectedSku]);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const [cfg, sos, sim] = await Promise.all([
        api.express.getConfig(),
        api.express.getSosClocks(selectedSku),
        api.express.simulate(),
      ]);
      setConfig(cfg);
      setEnabled(cfg.enabled);
      setClocks(sos.clocks || []);
      setSimulation(sim);

      // Evaluate the first urgent node
      const targetNode = sos.clocks?.[0]?.node_id || 'dest_boston_01';
      setSelectedNodeId(targetNode);
      await evaluateNode(targetNode, selectedSku);
    } catch (err) {
      console.error('Failed to load Express Lane data:', err);
    } finally {
      setLoading(false);
    }
  };

  const evaluateNode = async (nodeId: string, sku: string) => {
    setEvaluating(true);
    setApprovalResult(null);
    try {
      const rec = await api.express.evaluateOptions(nodeId, sku);
      setRecommendation(rec);
      setSelectedNodeId(nodeId);
    } catch (err) {
      console.error('Failed to evaluate options:', err);
    } finally {
      setEvaluating(false);
    }
  };

  const toggleFeature = async () => {
    try {
      const nextState = !enabled;
      const res = await api.express.updateConfig({ enabled: nextState });
      setEnabled(res.enabled);
    } catch (err) {
      console.error('Failed to update config:', err);
    }
  };

  const handleApprove = async () => {
    if (!recommendation) return;
    setApproving(true);
    try {
      const best = recommendation.recommended_option;
      const res = await api.express.approve({
        node_id: recommendation.node_id,
        product_sku: recommendation.product_sku,
        quantity: best.units_delivered || 50,
        option_type: recommendation.recommended_option_type,
        donor_node_id: best.donor_node_id,
        rationale: recommendation.rationale
      });
      setApprovalResult(res);
    } catch (err) {
      console.error('Failed to approve transfer:', err);
    } finally {
      setApproving(false);
    }
  };

  const runContentionSimulation = async () => {
    try {
      const items = [
        {
          request_id: 'REQ-ALPHA',
          node_id: 'dest_alpha',
          node_name: 'Dark Store Alpha (Downtown Core)',
          product_sku: 'PRD-INS-02',
          hours_to_stockout: contentionAlphaHours,
          sku_priority_weight: 1.5,
          customer_density: 1.3
        },
        {
          request_id: 'REQ-BETA',
          node_id: 'dest_beta',
          node_name: 'Dark Store Beta (Suburban East)',
          product_sku: 'PRD-INS-02',
          hours_to_stockout: contentionBetaHours,
          sku_priority_weight: 1.5,
          customer_density: 1.0
        }
      ];
      const res = await api.express.rationContention(items);
      setContentionResult(res);
    } catch (err) {
      console.error('Contention simulation error:', err);
    }
  };

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* 1. Header Banner with Feature Flag Toggle */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="absolute -right-16 -top-16 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="p-2 bg-amber-500/20 text-amber-400 rounded-xl border border-amber-500/30 flex items-center justify-center">
                <Zap className="w-6 h-6 animate-pulse" />
              </span>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                Express Lane: Fast-Fulfillment Engine
              </h1>
              <span className={`px-2.5 py-1 text-xs font-semibold rounded-full border ${
                enabled 
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' 
                  : 'bg-slate-700/50 text-slate-400 border-slate-600'
              }`}>
                {enabled ? 'FEATURE ACTIVE' : 'FEATURE OFF (STANDBY)'}
              </span>
            </div>
            <p className="text-slate-400 text-sm max-w-2xl">
              Quick-Commerce Dark Store urgent replenishment (Blinkit / Zepto model). 
              Evaluates in-flight truck detours, peer dark store courier rebalancing, and dedicated express vans against regular delivery economics.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <button
              onClick={toggleFeature}
              className={`px-4 py-2.5 rounded-xl font-medium text-sm flex items-center gap-2 transition-all shadow-md ${
                enabled 
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700' 
                  : 'bg-amber-600 hover:bg-amber-500 text-white'
              }`}
            >
              <Sliders className="w-4 h-4" />
              {enabled ? 'Disable Express Lane' : 'Enable Express Lane'}
            </button>
            <button
              onClick={loadInitialData}
              className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-slate-300 text-sm flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>

        {/* Diurnal Demand Assumption Ribbon */}
        <div className="mt-6 pt-5 border-t border-slate-800 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {Object.entries(config?.hourly_demand_pattern || {}).map(([slot, share]: any) => (
            <div 
              key={slot}
              className={`p-3 rounded-xl border text-center transition-all ${
                slot === '16-20' 
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' 
                  : 'bg-slate-800/40 border-slate-800 text-slate-400'
              }`}
            >
              <div className="text-xs font-mono">{slot} UTC</div>
              <div className="text-base font-bold mt-0.5">{(share * 100).toFixed(0)}% Vol</div>
              <div className="text-[10px] uppercase tracking-wider mt-0.5">
                {slot === '16-20' ? '⚡ Evening Peak' : 'Standard Window'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 2. Urgent Clocks Grid across Dark Stores */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Clock className="w-5 h-5 text-amber-600" />
              Live Dark Store Urgency Clocks
            </h2>
            <p className="text-slate-500 text-sm">
              Automatically triggers when P(stockout before next scheduled delivery) &gt; 50%
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Monitor SKU:</span>
            <select
              value={selectedSku}
              onChange={(e) => setSelectedSku(e.target.value)}
              className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-800 shadow-sm focus:ring-2 focus:ring-amber-500"
            >
              <option value="PRD-VAX-01">PRD-VAX-01 (Comirnaty Vaccine - Essential)</option>
              <option value="PRD-INS-02">PRD-INS-02 (Humalog Insulin - Essential)</option>
              <option value="PRD-PPE-04">PRD-PPE-04 (Surgical Gloves - Standard)</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {clocks.map((c) => {
            const isSelected = c.node_id === selectedNodeId;
            return (
              <div
                key={c.node_id}
                onClick={() => evaluateNode(c.node_id, selectedSku)}
                className={`p-5 rounded-xl border transition-all cursor-pointer relative overflow-hidden ${
                  isSelected 
                    ? 'ring-2 ring-amber-500 border-amber-500 bg-amber-50/20 shadow-md' 
                    : 'bg-white border-slate-200 hover:border-slate-300 shadow-sm'
                }`}
              >
                {c.is_critical && (
                  <div className="absolute top-0 right-0 bg-rose-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-bl-lg">
                    CRITICAL &lt; 1H
                  </div>
                )}

                <div className="text-xs font-semibold text-slate-400 mb-1">{c.node_id}</div>
                <h3 className="font-bold text-slate-900 text-sm mb-3 line-clamp-1">{c.node_name}</h3>

                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-xs text-slate-500">Hours to Stockout</span>
                  <span className={`text-xl font-mono font-bold ${
                    c.hours_to_stockout < 2 ? 'text-rose-600' : c.hours_to_stockout < 5 ? 'text-amber-600' : 'text-emerald-600'
                  }`}>
                    {c.hours_to_stockout.toFixed(1)}h
                  </span>
                </div>

                <div className="w-full bg-slate-100 rounded-full h-2 mb-3 overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all duration-500 ${
                      c.stockout_probability > 0.7 ? 'bg-rose-500' : c.stockout_probability > 0.4 ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min(100, c.stockout_probability * 100)}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
                  <span>Stock: <b>{c.current_stock.toFixed(0)} units</b></span>
                  <span>P(Stockout): <b>{(c.stockout_probability * 100).toFixed(0)}%</b></span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Four Fast-Fulfillment Options Side-by-Side Comparison */}
      {recommendation && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <Flame className="w-5 h-5 text-amber-600" />
                4-Option Fast Fulfillment Matrix: {recommendation.node_name}
              </h2>
              <p className="text-slate-500 text-sm">
                Evaluates transport premium against preserved gross margin and customer goodwill.
              </p>
            </div>

            {recommendation.is_critical_override && (
              <span className="px-3 py-1 bg-rose-100 text-rose-800 border border-rose-300 rounded-full text-xs font-bold flex items-center gap-1.5 self-start sm:self-auto">
                <ShieldAlert className="w-4 h-4 text-rose-600" />
                CRITICAL OVERRIDE: Essential Medical SKU Protected
              </span>
            )}
          </div>

          {/* Winner Recommendation Banner */}
          <div className={`p-5 rounded-2xl border flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm ${
            recommendation.recommended_option_type === 'WAIT'
              ? 'bg-slate-50 border-slate-300'
              : 'bg-gradient-to-r from-amber-500/10 via-emerald-500/10 to-transparent border-amber-500/30'
          }`}>
            <div className="flex items-start gap-3.5">
              <span className={`p-2.5 rounded-xl flex items-center justify-center shrink-0 ${
                recommendation.recommended_option_type === 'WAIT'
                  ? 'bg-slate-200 text-slate-700'
                  : 'bg-emerald-600 text-white'
              }`}>
                {recommendation.recommended_option_type === 'WAIT' ? (
                  <Clock className="w-6 h-6" />
                ) : (
                  <CheckCircle2 className="w-6 h-6" />
                )}
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Autonomous Decision Engine:</span>
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                    {recommendation.recommended_option.name}
                  </span>
                </div>
                <p className="text-sm text-slate-700 mt-1 font-medium leading-relaxed">
                  {recommendation.rationale}
                </p>
              </div>
            </div>

            {recommendation.recommended_option_type !== 'WAIT' && (
              <div className="flex items-center gap-3 shrink-0 self-end md:self-auto">
                <button
                  onClick={handleApprove}
                  disabled={approving || Boolean(approvalResult)}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl shadow-md transition-all flex items-center gap-2"
                >
                  {approving ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  {approvalResult ? 'Transfer Approved ✓' : 'One-Click Approve & Dispatch'}
                </button>
              </div>
            )}
          </div>

          {approvalResult && (
            <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-900 text-sm flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <b>Ledger Transfer Created:</b> #{approvalResult.transfer_number} via {approvalResult.dispatch_method}. 
                State set to APPROVED in global ledger with full audit rationale recorded.
              </div>
            </div>
          )}

          {/* 4 Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {recommendation.options.map((opt) => {
              const isWinner = opt.option_type === recommendation.recommended_option_type;
              return (
                <div
                  key={opt.option_type}
                  className={`p-5 rounded-2xl border flex flex-col justify-between transition-all ${
                    isWinner 
                      ? 'bg-white border-emerald-500 ring-2 ring-emerald-500/20 shadow-md' 
                      : 'bg-white border-slate-200'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-mono font-bold text-slate-400">
                        {opt.option_type}
                      </span>
                      {isWinner && (
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-full">
                          RECOMMENDED
                        </span>
                      )}
                    </div>

                    <h3 className="font-bold text-slate-900 text-base mb-1">{opt.name}</h3>
                    <p className="text-slate-500 text-xs mb-4 min-h-[32px]">{opt.tagline}</p>

                    <div className="space-y-2 pt-3 border-t border-slate-100 text-xs">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Transit ETA:</span>
                        <span className="font-bold text-slate-900">{opt.eta_hours.toFixed(1)} hours</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Extra Surcharge:</span>
                        <span className="font-bold text-slate-900">${opt.extra_cost.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Units Saved:</span>
                        <span className="font-bold text-slate-900">{opt.units_saved.toFixed(0)} units</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Margin Preserved:</span>
                        <span className="font-bold text-emerald-600">+${opt.margin_saved.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Goodwill Value:</span>
                        <span className="font-bold text-emerald-600">+${opt.goodwill_saved.toFixed(2)}</span>
                      </div>
                      {opt.rescue_bonus > 0 && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">FEFO Waste Rescue:</span>
                          <span className="font-bold text-amber-600">+${opt.rescue_bonus.toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-5 pt-3 border-t border-slate-100">
                    <div className="flex items-baseline justify-between mb-2">
                      <span className="text-xs font-semibold text-slate-600">Net Benefit:</span>
                      <span className={`text-base font-mono font-bold ${
                        opt.net_benefit > 0 ? 'text-emerald-600' : 'text-slate-500'
                      }`}>
                        {opt.net_benefit > 0 ? `+$${opt.net_benefit.toFixed(2)}` : `$${opt.net_benefit.toFixed(2)}`}
                      </span>
                    </div>

                    {!opt.is_feasible ? (
                      <div className="text-[11px] text-rose-600 bg-rose-50 p-2 rounded-lg font-medium leading-tight">
                        {opt.infeasible_reason}
                      </div>
                    ) : (
                      <div className="text-[11px] text-emerald-700 bg-emerald-50 p-2 rounded-lg font-medium">
                        Feasible &amp; Verified ({opt.transit_km.toFixed(0)} km corridor)
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. Contention Resolution Studio */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Award className="w-5 h-5 text-indigo-600" />
              Contention Rationing Studio
            </h2>
            <p className="text-slate-500 text-sm">
              Priority Score = (1 / hours_to_stockout) &times; SKU Priority Weight &times; Customer Density
            </p>
          </div>
          <button
            onClick={runContentionSimulation}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 shadow-sm self-start sm:self-auto"
          >
            <Sliders className="w-4 h-4" />
            Simulate Contention
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
            <div className="flex justify-between items-center">
              <span className="font-bold text-sm text-slate-900">Dark Store Alpha (Downtown Core)</span>
              <span className="text-xs font-mono px-2 py-0.5 bg-slate-200 text-slate-700 rounded font-semibold">
                Density: 1.3 &bull; Weight: 1.5
              </span>
            </div>
            <div>
              <div className="flex justify-between text-xs text-slate-600 mb-1">
                <span>Stockout Clock: <b>{contentionAlphaHours.toFixed(1)} hours</b></span>
              </div>
              <input 
                type="range"
                min="0.2"
                max="6.0"
                step="0.1"
                value={contentionAlphaHours}
                onChange={(e) => setContentionAlphaHours(parseFloat(e.target.value))}
                className="w-full accent-indigo-600"
              />
            </div>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
            <div className="flex justify-between items-center">
              <span className="font-bold text-sm text-slate-900">Dark Store Beta (Suburban East)</span>
              <span className="text-xs font-mono px-2 py-0.5 bg-slate-200 text-slate-700 rounded font-semibold">
                Density: 1.0 &bull; Weight: 1.5
              </span>
            </div>
            <div>
              <div className="flex justify-between text-xs text-slate-600 mb-1">
                <span>Stockout Clock: <b>{contentionBetaHours.toFixed(1)} hours</b></span>
              </div>
              <input 
                type="range"
                min="0.2"
                max="6.0"
                step="0.1"
                value={contentionBetaHours}
                onChange={(e) => setContentionBetaHours(parseFloat(e.target.value))}
                className="w-full accent-indigo-600"
              />
            </div>
          </div>
        </div>

        {contentionResult && (
          <div className="space-y-3 pt-4 border-t border-slate-100">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Rationing Allocation Result:</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {contentionResult.items.map((item: any, idx: number) => (
                <div 
                  key={item.request_id}
                  className={`p-4 rounded-xl border flex items-start gap-3 ${
                    idx === 0 
                      ? 'bg-emerald-50/50 border-emerald-300' 
                      : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                    idx === 0 ? 'bg-emerald-600 text-white' : 'bg-slate-300 text-slate-700'
                  }`}>
                    {idx + 1}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-900">{item.node_name}</span>
                      <span className="text-xs font-mono px-2 py-0.5 bg-white border rounded font-bold text-indigo-700">
                        Score: {item.priority_score.toFixed(1)}
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-emerald-800 mt-1">
                      Awarded: {item.allocated_option}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">{item.notes}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 5. 30-Day Comparative Simulation Report */}
      {simulation && (
        <div className="bg-slate-900 text-white border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-1">
                Historical Impact Assessment
              </div>
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
                What would have happened over the last 30 days if Express Lane had been active?
              </h2>
            </div>

            <div className="px-3.5 py-1.5 bg-amber-500/20 border border-amber-500/30 rounded-xl text-amber-300 text-xs font-bold">
              ROI Multiple: {simulation.roi_multiple}x Return
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 bg-slate-800/60 border border-slate-800 rounded-xl">
              <div className="text-xs text-slate-400">Stockouts Avoided</div>
              <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">
                {simulation.total_stockouts_avoided_units.toFixed(0)} units
              </div>
            </div>
            <div className="p-4 bg-slate-800/60 border border-slate-800 rounded-xl">
              <div className="text-xs text-slate-400">Margin Preserved</div>
              <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">
                ${simulation.gross_margin_preserved.toLocaleString()}
              </div>
            </div>
            <div className="p-4 bg-slate-800/60 border border-slate-800 rounded-xl">
              <div className="text-xs text-slate-400">Extra Transport Spend</div>
              <div className="text-2xl font-bold font-mono text-amber-400 mt-1">
                ${simulation.total_extra_spend.toLocaleString()}
              </div>
            </div>
            <div className="p-4 bg-slate-800/60 border border-slate-800 rounded-xl">
              <div className="text-xs text-slate-400">Net Profit Impact</div>
              <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">
                +${simulation.net_profit_impact.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Scenarios Table */}
          <div className="space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Evaluated Benchmark Scenarios (A, B, C):
            </div>
            <div className="space-y-3">
              {simulation.scenarios?.map((scen: any) => (
                <div key={scen.scenario_id} className="p-4 bg-slate-800/40 border border-slate-800 rounded-xl space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <span className="font-bold text-sm text-white">{scen.name}</span>
                    <span className="px-2.5 py-0.5 bg-slate-700 text-slate-200 text-xs font-mono rounded font-semibold self-start sm:self-auto">
                      Decision: {scen.recommended_decision}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">{scen.description}</p>
                  <p className="text-xs text-emerald-400/90 font-medium">{scen.audit_notes}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
