import React from 'react';

interface RetroBadgeProps {
  children: React.ReactNode;
  variant?: 'teal' | 'navy' | 'white' | 'cyan' | 'muted';
  size?: 'sm' | 'md';
  pulse?: boolean;
  className?: string;
}

/**
 * Enterprise Badge adhering strictly to the 3-color palette:
 * - Pure White: #FFFFFF
 * - Deep Navy: #17324D
 * - Teal: #0D9488
 */
export const RetroBadge: React.FC<RetroBadgeProps> = ({
  children,
  variant = 'teal',
  size = 'md',
  pulse = false,
  className = '',
}) => {
  const sizeClasses = {
    sm: 'px-1.5 py-0.5 text-[10px] tracking-wider',
    md: 'px-2.5 py-1 text-xs tracking-wide',
  };

  const isTeal = variant === 'teal' || variant === 'cyan';
  const isWhite = variant === 'white';

  const variantClasses = isTeal
    ? 'border-[#0D9488]/30 bg-[#0D9488]/8 text-[#0D9488] font-semibold'
    : isWhite
    ? 'border-[#17324D]/20 bg-white text-[#17324D] font-semibold'
    : 'border-[#17324D]/20 bg-[#17324D]/8 text-[#17324D] font-semibold';

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono uppercase rounded border ${sizeClasses[size]} ${variantClasses} ${className}`}
    >
      {pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span
            className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
              isTeal ? 'bg-[#0D9488]' : 'bg-[#17324D]'
            }`}
          />
          <span
            className={`relative inline-flex rounded-full h-1.5 w-1.5 ${
              isTeal ? 'bg-[#0D9488]' : 'bg-[#17324D]'
            }`}
          />
        </span>
      )}
      {children}
    </span>
  );
};
