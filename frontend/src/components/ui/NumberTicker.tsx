import React, { useEffect, useRef, useState } from 'react';

interface NumberTickerProps {
  value: number;
  direction?: 'up' | 'down';
  className?: string;
  delay?: number;
  decimalPlaces?: number;
}

/**
 * NumberTicker component inspired by Magic UI.
 * Smoothly interpolates numerical values for dashboard metrics.
 */
export const NumberTicker: React.FC<NumberTickerProps> = ({
  value,
  direction = 'up',
  className = '',
  delay = 0,
  decimalPlaces = 0,
}) => {
  const [displayValue, setDisplayValue] = useState(direction === 'down' ? value : 0);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    let animationFrameId: number;
    const duration = 1200; // ms

    const animate = (timestamp: number) => {
      if (!startTimeRef.current) startTimeRef.current = timestamp;
      const progress = Math.min((timestamp - startTimeRef.current) / duration, 1);
      
      // Smooth ease-out cubic
      const ease = 1 - Math.pow(1 - progress, 3);
      
      const current = direction === 'down'
        ? value + (1 - ease) * (value * 0.2)
        : ease * value;

      setDisplayValue(current);

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(animate);
      }
    };

    const timer = setTimeout(() => {
      animationFrameId = requestAnimationFrame(animate);
    }, delay * 1000);

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(animationFrameId);
    };
  }, [value, direction, delay]);

  return (
    <span className={`inline-block tabular-nums font-mono-num ${className}`}>
      {displayValue.toLocaleString(undefined, {
        minimumFractionDigits: decimalPlaces,
        maximumFractionDigits: decimalPlaces,
      })}
    </span>
  );
};
