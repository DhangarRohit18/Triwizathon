import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useAppStore } from '../store/useAppStore';
import { Product } from '../types';
import { KPICard } from '../components/KPICard';
import { 
  TrendingUp, 
  BarChart2, 
  Target, 
  Clock, 
  Layers, 
  Info,
  Calendar
} from 'lucide-react';
import { 
  ComposedChart, 
  Line, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Legend 
} from 'recharts';

export const ForecastingPage: React.FC = () => {
  const { addToast } = useAppStore();
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>('prd_vax_01');
  const [horizonDays, setHorizonDays] = useState(14);
  const [loading, setLoading] = useState(false);
  const [forecastResult, setForecastResult] = useState<any>(null);

  useEffect(() => {
    api.products.list().then((prods) => {
      setProducts(prods);
      if (prods.length > 0) {
        setSelectedProductId(prods[0].id);
      }
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (selectedProductId) {
      loadForecast();
    }
  }, [selectedProductId, horizonDays]);

  const loadForecast = async () => {
    setLoading(true);
    try {
      const res = await api.forecast.getProductForecast(selectedProductId, horizonDays);
      setForecastResult(res);
    } catch (err: any) {
      addToast({ type: 'error', title: 'Forecast error', message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const chartData = forecastResult?.timeline?.map((pt: any) => ({
    date: pt.date.substring(5), // MM-DD
    'Historical Actual': pt.historical_actual,
    '7-Day Moving Avg': pt.baseline_ma,
    'ML Ridge Forecast': pt.ml_forecast,
    'Confidence Range': pt.upper_bound && pt.lower_bound ? [pt.lower_bound, pt.upper_bound] : null,
  })) || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-slate-900 border border-slate-800 text-white">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-teal-400">
              Predictive Analytics Engine
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-teal-500/20 text-teal-300 font-mono font-bold">
              Ridge ML + Holdout Validation
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight mt-1">
            Demand Forecasting & Confidence Intervals
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Ingests daily hospital and clinic consumption histories, compares 7-day moving averages with Ridge regression, and calculates statistical confidence intervals with holdout evaluation metrics.
          </p>
        </div>

        {/* Product & Horizon Selector Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs">
            <Layers className="w-4 h-4 text-slate-400" />
            <select
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              className="bg-transparent border-none text-white focus:outline-none font-medium cursor-pointer"
            >
              {products.map((p) => (
                <option key={p.id} value={p.id} className="bg-slate-900 text-white">
                  {p.name} ({p.sku})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs">
            <Calendar className="w-4 h-4 text-slate-400" />
            <select
              value={horizonDays}
              onChange={(e) => setHorizonDays(parseInt(e.target.value))}
              className="bg-transparent border-none text-white focus:outline-none font-medium cursor-pointer"
            >
              <option value={7} className="bg-slate-900 text-white">7-Day Horizon</option>
              <option value={14} className="bg-slate-900 text-white">14-Day Horizon</option>
              <option value={30} className="bg-slate-900 text-white">30-Day Horizon</option>
            </select>
          </div>
        </div>
      </div>

      {/* Model Performance & Holdout Validation KPI Cards */}
      {forecastResult && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            title="Mean Absolute Error (MAE)"
            value={`${forecastResult.evaluation.mae} units`}
            subtitle="Calculated on 14-day holdout validation set"
            icon={Target}
            badge="Holdout Metric"
          />
          <KPICard
            title="Root Mean Sq Error (RMSE)"
            value={`${forecastResult.evaluation.rmse} units`}
            subtitle="Standard error of regression model"
            icon={BarChart2}
          />
          <KPICard
            title="Coefficient of Det. (R²)"
            value={forecastResult.evaluation.r2_score.toFixed(3)}
            subtitle="Explained demand variance on holdout"
            change={forecastResult.evaluation.r2_score > 0.8 ? "High Fit" : "Moderate"}
            isPositive={forecastResult.evaluation.r2_score > 0.75}
            icon={TrendingUp}
          />
          <KPICard
            title="Forecast Horizon"
            value={`${forecastResult.evaluation.horizon_days} Days`}
            subtitle="95% confidence bounds (±1.96σ)"
            icon={Clock}
          />
        </div>
      )}

      {/* Main Forecast Visualizer Chart */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">
              Demand Timeline: Historical Actuals vs Projected ML Forecast
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Left region displays actual consumed hospital units; right region projects ML predictions with statistical uncertainty bounds.
            </p>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-[#17324D]/60 font-mono">
            <span className="w-2.5 h-2.5 rounded-full bg-[#17324D]" /> Actual
            <span className="w-2.5 h-2.5 rounded-full bg-[#0D9488] ml-2" /> ML Forecast
            <span className="w-2.5 h-2.5 rounded-full border border-[#17324D] ml-2" /> Moving Avg
          </div>
        </div>

        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#17324D" opacity={0.1} />
              <XAxis dataKey="date" stroke="#17324D" fontSize={10} opacity={0.6} />
              <YAxis stroke="#17324D" fontSize={10} opacity={0.6} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#FFFFFF',
                  borderColor: 'rgba(23, 50, 77, 0.15)',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#17324D',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
              {/* Actuals Line (Navy) */}
              <Line
                type="monotone"
                dataKey="Historical Actual"
                stroke="#17324D"
                strokeWidth={2.5}
                dot={{ r: 3, fill: '#17324D' }}
              />
              {/* Moving Average Line (Navy Dashed) */}
              <Line
                type="monotone"
                dataKey="7-Day Moving Avg"
                stroke="#17324D"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                opacity={0.6}
                dot={false}
              />
              {/* ML Regression Forecast Line (Teal) */}
              <Line
                type="monotone"
                dataKey="ML Ridge Forecast"
                stroke="#0D9488"
                strokeWidth={2.5}
                dot={{ r: 3, fill: '#0D9488' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="flex items-center gap-2 p-3 rounded-xl bg-white border border-[#17324D]/15 text-xs text-[#17324D]/70">
          <Info className="w-4 h-4 text-[#0D9488] shrink-0" />
          <span>
            <strong>Data Disclosure:</strong> Historical series comprises 90 daily observations calibrated for pharmaceutical seasonalities. Evaluation metrics are strictly measured on an unseen 14-day holdout validation split.
          </span>
        </div>
      </div>
    </div>
  );
};
