import React from 'react';
import { LucideIcon } from 'lucide-react';
import { SmoothCard } from './ui/SmoothCard';
import { NumberTicker } from './ui/NumberTicker';
import { RetroBadge } from './ui/RetroBadge';

interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  change?: string;
  isPositive?: boolean;
  icon: LucideIcon;
  badge?: string;
  ticker?: boolean;
}

export const KPICard: React.FC<KPICardProps> = ({
  title,
  value,
  subtitle,
  change,
  isPositive = true,
  icon: Icon,
  badge,
  ticker = true,
}) => {
  const numericVal = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.-]+/g, ''));
  const isNumeric = !isNaN(numericVal) && ticker;

  return (
    <SmoothCard className="p-4 transition-all duration-150">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-mono font-semibold uppercase tracking-wider text-[#17324D]/70">
          {title}
        </span>
        <div className="flex items-center gap-1.5">
          {badge && (
            <RetroBadge variant="teal" size="sm">
              {badge}
            </RetroBadge>
          )}
          <div className="p-2 rounded-lg bg-[#0D9488]/8 border border-[#0D9488]/20 text-[#0D9488]">
            <Icon className="w-4 h-4" />
          </div>
        </div>
      </div>

      <div className="flex items-baseline justify-between">
        <div className="text-2xl font-bold tracking-tight text-[#17324D] font-mono-num">
          {isNumeric ? (
            <NumberTicker value={numericVal} />
          ) : (
            value
          )}
        </div>
        {change && (
          <span
            className={`text-xs font-mono font-semibold px-2 py-0.5 rounded border ${
              isPositive
                ? 'text-[#0D9488] bg-[#0D9488]/8 border-[#0D9488]/25'
                : 'text-[#17324D] bg-[#17324D]/5 border-[#17324D]/20'
            }`}
          >
            {change}
          </span>
        )}
      </div>

      {subtitle && (
        <p className="mt-1.5 text-xs text-[#17324D]/60 truncate font-mono">
          {subtitle}
        </p>
      )}
    </SmoothCard>
  );
};
