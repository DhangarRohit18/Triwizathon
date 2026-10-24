import React from 'react';

interface SmoothCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  glow?: boolean;
  active?: boolean;
}

/**
 * Minimal Enterprise Container strictly following the 3-color palette:
 * Pure White (#FFFFFF), Deep Navy (#17324D), Teal (#0D9488).
 */
export const SmoothCard: React.FC<SmoothCardProps> = ({
  children,
  className = '',
  glow = false,
  active = false,
  ...props
}) => {
  return (
    <div
      className={`relative overflow-hidden rounded-xl border bg-white transition-all duration-150 ${
        active
          ? 'border-[#0D9488] bg-[#0D9488]/[0.02]'
          : glow
          ? 'border-[#17324D]/20 hover:border-[#0D9488]/50 shadow-xs'
          : 'border-[#17324D]/15 hover:border-[#17324D]/30'
      } ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};
