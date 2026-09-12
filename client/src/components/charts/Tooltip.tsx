import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';

interface TooltipProps {
  x: number;
  y: number;
  containerWidth: number;
  children: ReactNode;
}

/** Floating readout anchored to a chart coordinate; flips left near the right edge. */
export function ChartTooltip({ x, y, containerWidth, children }: TooltipProps) {
  const flip = x > containerWidth * 0.62;
  return (
    <div
      role="status"
      className={cn(
        'pointer-events-none absolute z-10 min-w-36 rounded-lg bg-navy-900 px-3 py-2 text-xs text-white shadow-float',
        flip ? '-translate-x-[calc(100%+12px)]' : 'translate-x-3',
      )}
      style={{ left: x, top: Math.max(0, y - 8) }}
    >
      {children}
    </div>
  );
}

export function TooltipRow({ color, label, value, dashed }: { color?: string; label: string; value: string; dashed?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="inline-flex items-center gap-1.5 text-white/70">
        {color && <span className="h-0 w-3 border-t-2" style={{ borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }} aria-hidden="true" />}
        {label}
      </span>
      <span className="tabular font-semibold text-white">{value}</span>
    </div>
  );
}
