import React from 'react';

interface TactileButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
}

/**
 * Enterprise button component adhering strictly to the 3-color palette:
 * - Pure White: #FFFFFF
 * - Deep Navy: #17324D
 * - Teal: #0D9488
 */
export const TactileButton: React.FC<TactileButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  className = '',
  disabled,
  ...props
}) => {
  const sizeClasses = {
    sm: 'px-2.5 py-1 text-xs gap-1.5',
    md: 'px-3.5 py-1.5 text-xs font-semibold gap-2',
    lg: 'px-4 py-2 text-sm font-semibold gap-2.5',
  };

  const variantClasses = {
    // Primary: Teal background with crisp white typography
    primary:
      'bg-[#0D9488] text-white font-semibold hover:bg-[#0B7C72] active:bg-[#09665E] border border-[#0D9488] shadow-xs',
    // Secondary: Deep Navy background with crisp white typography
    secondary:
      'bg-[#17324D] text-white font-semibold hover:bg-[#12273C] active:bg-[#0E1F30] border border-[#17324D] shadow-xs',
    // Outline: Pure white background with deep navy typography and subtle navy border
    outline:
      'bg-white text-[#17324D] hover:bg-[#17324D]/5 active:bg-[#17324D]/10 border border-[#17324D]/25 shadow-xs font-semibold',
    // Ghost: Transparent background with deep navy typography
    ghost:
      'bg-transparent text-[#17324D] hover:bg-[#17324D]/5 active:bg-[#17324D]/10 border border-transparent font-semibold',
  };

  return (
    <button
      className={`inline-flex items-center justify-center rounded-lg transition-all duration-150 select-none active:translate-y-[1px] disabled:opacity-40 disabled:pointer-events-none disabled:transform-none cursor-pointer ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
      disabled={disabled}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </button>
  );
};
