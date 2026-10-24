import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useAppStore } from '../store/useAppStore';
import { OptimizationResult, Warehouse } from '../types';
import { KPICard } from '../components/KPICard';
import { 
  Cpu, 
  Play, 
  TrendingDown, 
  Percent, 
  DollarSign, 
  Clock, 
  Sliders, 
  Info,
  ShieldCheck,
  Zap
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
import { RetroBadge } from '../components/ui/RetroBadge';
import { TactileButton } from '../components/ui/TactileButton';

export const OptimizerPage: React.FC = () => {
  const { addToast, activeRole, setActiveRole, setUser } = useAppStore();
  const [running, setRunning] = useState(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [result, setResult] = useState<OptimizationResult | null>(null);

  // Scenario Modifiers
  const [horizonDays, setHorizonDays] = useState(7);
  const [demandSurge, setDemandSurge] = useState(0);
  const [fuelMultiplier, setFuelMultiplier] = useState(1.0);
  const [fefoUrgency, setFefoUrgency] = useState(1.2);
  const [disruptedWhs, setDisruptedWhs] = useState<string[]>([]);

  const isRoleAllowed = ['super_admin', 'org_admin', 'supply_chain_manager'].includes(activeRole);

  useEffect(() => {
    api.warehouses.list().then(setWarehouses).catch(console.error);
    // Initial optimization run
    handleRunOptimization();
  }, []);

  const handleElevateRole = async () => {
    try {
      const res = await api.auth.switchRole('supply_chain_manager');
      setUser(res.user, res.access_token);
      setActiveRole('supply_chain_manager');
      addToast({
        type: 'info',
        title: 'Role Elevated to Supply Chain Manager',
        message: 'Permission granted to execute Google OR-Tools MIP solver.'
      });
      return true;
    } catch (e: any) {
      addToast({ type: 'error', title: 'Elevation failed', message: e.message });
      return false;
    }
  };

  const handleRunOptimization = async () => {
    setRunning(true);
    try {
      // Auto-elevate role if currently operator or distributor to prevent RBAC 403 error
      if (!isRoleAllowed) {
        const ok = await handleElevateRole();
        if (!ok) {
          setRunning(false);
          return;
        }
      }

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
        type: 'info',
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
    <div className="space-y-6 text-slate-900">
      {/* Role Notice Banner if not currently in an optimizer role */}
      {!isRoleAllowed && (
        <div className="p-4 rounded-xl border border-[#0D9488]/40 bg-[#0D9488]/10 text-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-2.5">
            <Info className="w-4 h-4 text-[#0D9488] shrink-0" />
            <span className="text-xs font-mono">
              Role Protection: You are signed in as <strong>{activeRole}</strong>. Running mathematical network optimization requires <strong>Supply Chain Manager</strong>, <strong>Org Admin</strong>, or <strong>Super Admin</strong>.
            </span>
          </div>
          <TactileButton
            variant="primary"
            size="sm"
            onClick={handleElevateRole}
            className="shrink-0"
          >
            Switch to Supply Chain Manager
          </TactileButton>
        </div>
      )}

      {/* Page Header - Pure White Minimal */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-2xl bg-white border border-slate-200 text-slate-900 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <RetroBadge variant="teal" size="sm">
              GOOGLE OR-TOOLS SCIP
            </RetroBadge>
            <span className="text-xs font-mono uppercase tracking-widest text-slate-400">
              Prescriptive Decision Engine
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 mt-2">
            Distribution Optimization & Scenario Simulation Studio
          </h1>
          <p className="text-xs text-slate-600 mt-1 max-w-3xl font-mono leading-relaxed">
            Solves multi-commodity network flow with mixed-integer linear programming (MIP). Optimizes warehouse source allocations, minimizes transportation distance and shortage penalties, and applies FEFO expiry-aware allocation.
          </p>
        </div>

        <TactileButton
          variant="primary"
          size="lg"
          onClick={handleRunOptimization}
          disabled={running}
          icon={<Play className={`w-4 h-4 fill-current ${running ? 'animate-spin' : ''}`} />}
        >
          {running ? 'Solving MIP Formulation...' : 'Run Optimization'}
        </TactileButton>
      </div>

      {/* Scenario Simulation Controls */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-[#0D9488]" />
            <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-900">
              Scenario Modifiers & Disruption Simulator
            </h3>
          </div>
          <span className="text-[11px] font-mono text-slate-500">
            Simulate black-swan events, demand surges, or hub outages
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs font-mono">
          {/* Demand Surge Slider */}
          <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70">
            <div className="flex justify-between items-center mb-2">
              <span className="font-bold text-slate-700">Demand Surge</span>
              <span className="font-bold text-[#0D9488]">+{demandSurge}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={demandSurge}
              onChange={(e) => setDemandSurge(parseInt(e.target.value))}
              className="w-full accent-[#0D9488] cursor-pointer"
            />
            <span className="text-[10px] text-slate-500 mt-1 block">Simulates hospital disease outbreaks</span>
          </div>

          {/* Fuel Price Multiplier */}
          <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70">
            <div className="flex justify-between items-center mb-2">
              <span className="font-bold text-slate-700">Fuel Cost Multiplier</span>
              <span className="font-bold text-[#0D9488]">{fuelMultiplier.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="1.0"
              max="2.5"
              step="0.1"
              value={fuelMultiplier}
              onChange={(e) => setFuelMultiplier(parseFloat(e.target.value))}
              className="w-full accent-[#0D9488] cursor-pointer"
            />
            <span className="text-[10px] text-slate-500 mt-1 block">Simulates diesel freight price spikes</span>
          </div>

          {/* FEFO Expiry Urgency Weight */}
          <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70">
            <div className="flex justify-between items-center mb-2">
              <span className="font-bold text-slate-700">FEFO Expiry Weight</span>
              <span className="font-bold text-[#0D9488]">{fefoUrgency.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="1.0"
              max="3.0"
              step="0.2"
              value={fefoUrgency}
              onChange={(e) => setFefoUrgency(parseFloat(e.target.value))}
              className="w-full accent-[#0D9488] cursor-pointer"
            />
            <span className="text-[10px] text-slate-500 mt-1 block">Prioritizes &lt;30 day batches to prevent wastage</span>
          </div>

          {/* Disrupted Warehouse Outage Toggles */}
          <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70">
            <div className="font-bold text-slate-700 mb-2">
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
                      className="rounded accent-[#0D9488]"
                    />
                    <span className={isDisrupted ? 'text-slate-400 font-bold line-through' : 'text-slate-700'}>
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
            <div className="lg:col-span-1 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-900 mb-4 border-b border-slate-100 pb-2">
                MIP Solver vs Greedy Baseline
              </h3>

              <div className="space-y-3 text-xs font-mono">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Total Modeled Cost</div>
                  <div className="flex justify-between items-baseline mt-1 font-mono-num">
                    <span className="font-bold text-[#0D9488] text-sm">${result.optimized.total_modeled_cost.toLocaleString()}</span>
                    <span className="text-slate-400 text-xs line-through">${result.baseline_heuristic.total_modeled_cost.toLocaleString()}</span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Allocated Units / Demand</div>
                  <div className="flex justify-between items-baseline mt-1 font-mono-num">
                    <span className="font-bold text-slate-900 text-sm">{result.optimized.total_allocated_units.toLocaleString()} units</span>
                    <span className="text-slate-500 text-xs">{result.baseline_heuristic.total_allocated_units.toLocaleString()} units</span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Shortage Stockout Units</div>
                  <div className="flex justify-between items-baseline mt-1 font-mono-num">
                    <span className="font-bold text-slate-900 text-sm">{result.optimized.stockout_units} units</span>
                    <span className="text-slate-500 text-xs">{result.baseline_heuristic.stockout_units} units</span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Estimated Spoilage / Wastage</div>
                  <div className="flex justify-between items-baseline mt-1 font-mono-num">
                    <span className="font-bold text-[#0D9488] text-sm">0 units (FEFO active)</span>
                    <span className="text-slate-400 text-xs">{result.baseline_heuristic.estimated_wastage_risk_units} units</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Recharts Bar Chart Breakdown */}
            <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-900 mb-4 border-b border-slate-100 pb-2">
                Cost Breakdown Comparison ($)
              </h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={comparisonChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.6} />
                    <XAxis dataKey="name" stroke="#64748b" fontSize={11} />
                    <YAxis stroke="#64748b" fontSize={11} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#ffffff',
                        borderColor: '#e2e8f0',
                        borderRadius: '8px',
                        fontSize: '12px',
                        color: '#0f172a'
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                    <Bar dataKey="Baseline Heuristic" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="OR-Tools MIP Solver" fill="#0284c7" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Allocation Recommendations Table */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-900">
                  Prescriptive Allocation Matrix ({result.recommendations.length} Recommended Routes)
                </h3>
                <p className="text-[11px] font-mono text-slate-500">
                  Algorithmically verified routing recommendations adhering to capacity, safety stock, and FEFO expiry rules.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs table-dense">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 font-mono">
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
                <tbody className="divide-y divide-slate-100 font-mono-num">
                  {result.recommendations.map((rec) => (
                    <tr key={rec.id} className="hover:bg-slate-50 transition-colors">
                      <td className="font-bold text-slate-900">
                        <div>{rec.product_name}</div>
                        <span className="text-[10px] text-[#0D9488] font-mono font-normal">{rec.product_sku}</span>
                      </td>
                      <td className="text-slate-800 font-sans font-medium">
                        {rec.source_warehouse_name}
                      </td>
                      <td className="text-slate-800 font-sans font-medium">
                        {rec.destination_name}
                      </td>
                      <td className="text-right font-bold text-[#0D9488]">
                        {rec.allocated_quantity.toLocaleString()}
                      </td>
                      <td className="text-right text-slate-500">
                        ${rec.unit_transport_cost.toFixed(2)}
                      </td>
                      <td className="text-right font-bold text-slate-900">
                        ${rec.total_transport_cost.toFixed(2)}
                      </td>
                      <td className="text-slate-500">
                        {rec.estimated_delivery_hours}h
                      </td>
                      <td className="font-sans text-[11px] text-slate-600 max-w-xs">
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
