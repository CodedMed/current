import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';
import { pct } from '../../lib/format.ts';

interface StatTileProps {
  label: string;
  value: string;
  delta?: { value: number | null; goodWhenUp: boolean; versus: string };
  hint?: string;
  hero?: boolean;
  icon?: ReactNode;
  className?: string;
}

export function StatTile({ label, value, delta, hint, hero = false, icon, className }: StatTileProps) {
  const d = delta?.value ?? null;
  const direction = d === null ? 'flat' : d > 0.05 ? 'up' : d < -0.05 ? 'down' : 'flat';
  const good = delta ? (direction === 'up' ? delta.goodWhenUp : direction === 'down' ? !delta.goodWhenUp : null) : null;
  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus;
  return (
    <div className={cn('rounded-2xl p-5 shadow-card ring-1', hero ? 'bg-navy-900 text-white ring-navy-900' : 'bg-panel ring-ink/5', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className={cn('text-sm font-medium', hero ? 'text-white/70' : 'text-ink-secondary')}>{label}</p>
        {icon && <span className={cn('grid size-8 place-items-center rounded-lg', hero ? 'bg-white/10 text-white' : 'bg-surface text-ink-secondary')}>{icon}</span>}
      </div>
      <p className={cn('mt-2 font-bold tracking-tight', hero ? 'text-[40px] leading-none sm:text-[44px]' : 'text-[28px] leading-none')}>{value}</p>
      {delta && (
        <p className={cn('mt-3 flex items-center gap-1.5 text-xs font-medium', hero ? 'text-white/70' : 'text-ink-muted')}>
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold',
              good === null ? (hero ? 'bg-white/10 text-white' : 'bg-surface text-ink-secondary') : good ? 'bg-positive-50 text-positive-700' : 'bg-danger-50 text-danger-700',
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {pct(d, 1)}
          </span>
          {delta.versus}
        </p>
      )}
      {hint && <p className={cn('mt-2 text-xs', hero ? 'text-white/60' : 'text-ink-muted')}>{hint}</p>}
    </div>
  );
}
