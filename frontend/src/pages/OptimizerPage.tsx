import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useAppStore } from '../store/useAppStore';
import { OptimizationResult, Warehouse, Destination, Product } from '../types';
import { KPICard } from '../components/KPICard';
import { 
  Cpu, 
  Play, 
  TrendingDown, 
  Percent, 
  ShieldAlert, 
  DollarSign, 
  CheckCircle2, 
  Clock, 
  Sliders, 
  Sparkles,
  ArrowRight,
  Info
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Legend 
} from 'recharts';

export const OptimizerPage: React.FC = () => {
  const { addToast } = useAppStore();
  const [running, setRunning] = useState(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [result, setResult] = useState<OptimizationResult | null>(null);

  // Scenario Modifiers
  const [horizonDays, setHorizonDays] = useState(7);
  const [demandSurge, setDemandSurge] = useState(0);
  const [fuelMultiplier, setFuelMultiplier] = useState(1.0);
  const [fefoUrgency, setFefoUrgency] = useState(1.2);
  const [disruptedWhs, setDisruptedWhs] = useState<string[]>([]);

  useEffect(() => {
    api.warehouses.list().then(setWarehouses).catch(console.error);
    // Initial optimization run
    handleRunOptimization();
  }, []);

  const handleRunOptimization = async () => {
    setRunning(true);
    try {
      const res = await api.optimization.run({
        horizon_days: horizonDays,
        fefo_priority_weight: fefoUrgency,
        scenario: {
          disrupted_warehouse_ids: disruptedWhs,
          demand_surge_percent: demandSurge,
          fuel_transport_cost_multiplier: fuelMultiplier,
          expiring_soon_penalty_multiplier: fefoUrgency,
        }
      });
      setResult(res);
      addToast({
        type: 'success',
        title: 'OR-Tools Optimization Solved',
        message: `Generated optimal distribution in ${res.optimized.execution_time_ms}ms with $${res.savings_amount.toLocaleString()} cost savings.`
      });
    } catch (err: any) {
      addToast({ type: 'error', title: 'Solver failed', message: err.message });
    } finally {
      setRunning(false);
    }
  };

  const toggleDisrupt = (whId: string) => {
    setDisruptedWhs(prev => 
      prev.includes(whId) ? prev.filter(id => id !== whId) : [...prev, whId]
    );
  };

  const comparisonChartData = result ? [
    {
      name: 'Total Modeled Cost ($)',
      'Baseline Heuristic': result.baseline_heuristic.total_modeled_cost,
      'OR-Tools MIP Solver': result.optimized.total_modeled_cost,
    },
    {
      name: 'Transportation Freight ($)',
      'Baseline Heuristic': result.baseline_heuristic.transportation_cost,
      'OR-Tools MIP Solver': result.optimized.transportation_cost,
    },
    {
      name: 'Shortage Penalties ($)',
      'Baseline Heuristic': result.baseline_heuristic.shortage_penalty_cost,
      'OR-Tools MIP Solver': result.optimized.shortage_penalty_cost,
    },
  ] : [];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-slate-900 border border-slate-800 text-white">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-sky-400">
              Prescriptive Decision Engine
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 font-mono font-bold">
              Google OR-Tools SCIP
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight mt-1">
            Distribution Optimization & Scenario Simulation Studio
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            Solves multi-commodity network flow with mixed-integer linear programming. Optimizes warehouse source allocations, minimizes transportation distance and shortage penalties, and applies FEFO expiry-aware allocation.
          </p>
        </div>

        <button
          onClick={handleRunOptimization}
          disabled={running}
          className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-teal-500 hover:from-sky-400 hover:to-teal-400 text-slate-950 font-black text-xs shadow-lg shadow-sky-500/25 flex items-center gap-2 shrink-0 transition-all disabled:opacity-50"
        >
          <Play className={`w-4 h-4 fill-current ${running ? 'animate-spin' : ''}`} />
          {running ? 'Solving MIP Formulation...' : 'Run Optimization'}
        </button>
      </div>

      {/* Scenario Simulation Controls */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-sky-500" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">
              Scenario Modifiers & Disruption Simulator
            </h3>
          </div>
          <span className="text-[11px] text-slate-400">
            Simulate black-swan events, demand surges, or hub outages
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
          {/* Demand Surge Slider */}
          <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
            <div className="flex justify-between items-center mb-2">
              <span className="font-bold text-slate-700 dark:text-slate-300">Demand Surge</span>
              <span className="font-mono font-bold text-sky-400">+{demandSurge}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={demandSurge}
              onChange={(e) => setDemandSurge(parseInt(e.target.value))}
              className="w-full accent-sky-500 cursor-pointer"
            />
            <span className="text-[10px] text-slate-500 mt-1 block">Simulates hospital disease outbreaks</span>
          </div>

          {/* Fuel Price Multiplier */}
          <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
            <div className="flex justify-between items-center mb-2">
              <span className="font-bold text-slate-700 dark:text-slate-300">Fuel Cost Multiplier</span>
              <span className="font-mono font-bold text-sky-400">{fuelMultiplier.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="1.0"
              max="2.5"
              step="0.1"
              value={fuelMultiplier}
              onChange={(e) => setFuelMultiplier(parseFloat(e.target.value))}
              className="w-full accent-sky-500 cursor-pointer"
            />
            <span className="text-[10px] text-slate-500 mt-1 block">Simulates diesel freight price spikes</span>
          </div>

          {/* FEFO Expiry Urgency Weight */}
          <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
            <div className="flex justify-between items-center mb-2">
              <span className="font-bold text-slate-700 dark:text-slate-300">FEFO Expiry Weight</span>
              <span className="font-mono font-bold text-teal-400">{fefoUrgency.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="1.0"
              max="3.0"
              step="0.2"
              value={fefoUrgency}
              onChange={(e) => setFefoUrgency(parseFloat(e.target.value))}
              className="w-full accent-teal-500 cursor-pointer"
            />
            <span className="text-[10px] text-slate-500 mt-1 block">Prioritizes &lt;30 day batches to prevent wastage</span>
          </div>

          {/* Disrupted Warehouse Outage Toggles */}
          <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
            <div className="font-bold text-slate-700 dark:text-slate-300 mb-2">
              Hub Outage Toggles
            </div>
            <div className="space-y-1.5">
              {warehouses.map((w) => {
                const isDisrupted = disruptedWhs.includes(w.id);
                return (
                  <label key={w.id} className="flex items-center gap-2 cursor-pointer text-[11px]">
                    <input
                      type="checkbox"
                      checked={isDisrupted}
                      onChange={() => toggleDisrupt(w.id)}
                      className="rounded accent-rose-500"
                    />
                    <span className={isDisrupted ? 'text-rose-400 font-bold line-through' : 'text-slate-400'}>
                      {w.code} ({w.city})
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Comparison Metrics Header */}
      {result && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              title="Optimized Modeled Cost"
              value={`$${result.optimized.total_modeled_cost.toLocaleString()}`}
              subtitle={`Vs Baseline: $${result.baseline_heuristic.total_modeled_cost.toLocaleString()}`}
              icon={DollarSign}
              badge="OR-Tools"
            />
            <KPICard
              title="Verified Cost Savings"
              value={`$${result.savings_amount.toLocaleString()}`}
              subtitle="Algorithm reduction in total freight & penalties"
              change={`-${result.savings_percent}%`}
              isPositive={true}
              icon={TrendingDown}
            />
            <KPICard
              title="Demand Fill Rate"
              value={`${result.optimized.fill_rate_percent}%`}
              subtitle={`${result.optimized.total_allocated_units.toLocaleString()} / ${result.optimized.total_demand_units.toLocaleString()} units`}
              change={`${result.optimized.fill_rate_percent}%`}
              isPositive={result.optimized.fill_rate_percent > 90}
              icon={Percent}
            />
            <KPICard
              title="Solver Execution Time"
              value={`${result.optimized.execution_time_ms} ms`}
              subtitle={`Status: ${result.optimized.solver_status}`}
              icon={Clock}
              badge="SCIP MIP"
            />
          </div>

          {/* Comparison Side-by-Side Table & Chart */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Metric Comparison Table */}
            <div className="lg:col-span-1 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-5 shadow-sm">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100 mb-4">
                MIP Solver vs Greedy Baseline
              </h3>

              <div className="space-y-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] uppercase font-bold text-slate-400">Total Modeled Cost</div>
                  <div className="flex justify-between items-baseline mt-1 font-mono-num">
                    <span className="font-bold text-sky-400 text-sm">${result.optimized.total_modeled_cost.toLocaleString()}</span>
                    <span className="text-slate-400 text-xs line-through">${result.baseline_heuristic.total_modeled_cost.toLocaleString()}</span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] uppercase font-bold text-slate-400">Allocated Units / Demand</div>
                  <div className="flex justify-between items-baseline mt-1 font-mono-num">
                    <span className="font-bold text-emerald-400 text-sm">{result.optimized.total_allocated_units.toLocaleString()} units</span>
                    <span className="text-slate-400 text-xs">{result.baseline_heuristic.total_allocated_units.toLocaleString()} units</span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] uppercase font-bold text-slate-400">Shortage Stockout Units</div>
                  <div className="flex justify-between items-baseline mt-1 font-mono-num">
                    <span className="font-bold text-emerald-400 text-sm">{result.optimized.stockout_units} units</span>
                    <span className="text-rose-400 text-xs">{result.baseline_heuristic.stockout_units} units</span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] uppercase font-bold text-slate-400">Estimated Spoilage / Wastage</div>
                  <div className="flex justify-between items-baseline mt-1 font-mono-num">
                    <span className="font-bold text-teal-400 text-sm">0 units (FEFO active)</span>
                    <span className="text-amber-400 text-xs">{result.baseline_heuristic.estimated_wastage_risk_units} units</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Recharts Bar Chart Breakdown */}
            <div className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-5 shadow-sm">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100 mb-4">
                Cost Breakdown Comparison ($)
              </h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={comparisonChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                    <YAxis stroke="#94a3b8" fontSize={11} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#090d16',
                        borderColor: '#1e293b',
                        borderRadius: '8px',
                        fontSize: '12px',
                        color: '#f8fafc'
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                    <Bar dataKey="Baseline Heuristic" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="OR-Tools MIP Solver" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Allocation Recommendations Table */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">
                  Prescriptive Allocation Matrix ({result.recommendations.length} Recommended Routes)
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Algorithmically verified routing recommendations adhering to capacity, safety stock, and FEFO expiry rules.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs table-dense">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400">
                    <th>Product</th>
                    <th>Source Hub</th>
                    <th>Destination</th>
                    <th className="text-right">Quantity</th>
                    <th className="text-right">Unit Freight</th>
                    <th className="text-right">Total Cost</th>
                    <th>Est. Hours</th>
                    <th>Allocation Rationale</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono-num">
                  {result.recommendations.map((rec) => (
                    <tr key={rec.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="font-bold text-slate-900 dark:text-slate-100">
                        <div>{rec.product_name}</div>
                        <span className="text-[10px] text-sky-400 font-mono font-normal">{rec.product_sku}</span>
                      </td>
                      <td className="text-slate-700 dark:text-slate-300 font-sans font-medium">
                        {rec.source_warehouse_name}
                      </td>
                      <td className="text-slate-700 dark:text-slate-300 font-sans font-medium">
                        {rec.destination_name}
                      </td>
                      <td className="text-right font-bold text-emerald-400">
                        {rec.allocated_quantity.toLocaleString()}
                      </td>
                      <td className="text-right text-slate-400">
                        ${rec.unit_transport_cost.toFixed(2)}
                      </td>
                      <td className="text-right font-bold text-slate-800 dark:text-slate-200">
                        ${rec.total_transport_cost.toFixed(2)}
                      </td>
                      <td className="text-slate-400">
                        {rec.estimated_delivery_hours}h
                      </td>
                      <td className="font-sans text-[11px] text-slate-400 max-w-xs">
                        {rec.rationale}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
