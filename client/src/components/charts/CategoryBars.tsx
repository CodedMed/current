import type { CategorySpend } from '../../../../shared/types.ts';
import { cn } from '../../lib/cn.ts';
import { money, pct } from '../../lib/format.ts';

/** Horizontal single-hue bars: magnitude only, so one color for every row. */
export function CategoryBars({ categories }: { categories: CategorySpend[] }) {
  const max = Math.max(1, ...categories.map((c) => c.amount));
  return (
    <ul className="space-y-3" aria-label="Spending by category">
      {categories.map((c) => (
        <li key={c.category} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
          <span className="truncate text-sm font-medium text-ink">{c.category}</span>
          <span className="flex items-center gap-2 text-sm">
            <span className="tabular font-semibold text-ink">{money(c.amount)}</span>
            <span
              className={cn(
                'tabular w-14 text-right text-xs',
                c.change === null ? 'text-ink-muted' : c.change > 0 ? 'text-danger-600' : c.change < 0 ? 'text-positive-700' : 'text-ink-muted',
              )}
              title="Change versus the prior 30 days"
            >
              {pct(c.change)}
            </span>
          </span>
          <span className="col-span-2 h-2 overflow-hidden rounded-full bg-brand-50" aria-hidden="true">
            <span className="block h-full rounded-full bg-[var(--color-series-1)] transition-[width] duration-700" style={{ width: `${(c.amount / max) * 100}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}
