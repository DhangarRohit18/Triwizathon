import React from 'react';

interface RetroGridProps {
  className?: string;
  angle?: number;
}

/**
 * RetroGrid / DotPattern component inspired by Magic UI & Retro UI.
 * Creates an ultra-clean, minimal perspective background grid using pure CSS.
 */
export const RetroGrid: React.FC<RetroGridProps> = ({ className = '', angle = 65 }) => {
  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden opacity-40 [perspective:200px] ${className}`}
    >
      <div className="absolute inset-0 [transform:rotateX(35deg)]">
        <div
          className="animate-grid [background-repeat:repeat] [background-size:50px_50px] [height:300vh] [inset:0%_0px] [margin-left:-50%] [transform-origin:100%_0_0] [width:200vw]"
          style={{
            backgroundImage: `linear-gradient(to right, rgba(2, 132, 199, 0.12) 1px, transparent 0), linear-gradient(to bottom, rgba(2, 132, 199, 0.12) 1px, transparent 0)`,
          }}
        />
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-white via-white/70 to-transparent" />
    </div>
  );
};
