import { CalendarClock, CircleCheck, Flag, Info, TrendingDown, TrendingUp, Unplug, Users, type LucideIcon } from 'lucide-react';
import type { CashInsight, InsightKind, InsightTone } from '../../../../shared/types.ts';
import { cn } from '../../lib/cn.ts';
import { EmptyState, Panel } from './Panel.tsx';

const ICONS: Record<InsightKind, LucideIcon> = {
  low_balance: TrendingDown,
  spend_anomaly: TrendingUp,
  large_payment: CalendarClock,
  trend: TrendingUp,
  concentration: Users,
  connection: Unplug,
  review: Flag,
};

const TONES: Record<InsightTone, { icon: string; rule: string }> = {
  warning: { icon: 'bg-warning-50 text-warning-700', rule: 'border-warning-500' },
  positive: { icon: 'bg-positive-50 text-positive-700', rule: 'border-positive-500' },
  info: { icon: 'bg-brand-50 text-brand-700', rule: 'border-brand-400' },
  danger: { icon: 'bg-danger-50 text-danger-700', rule: 'border-danger-500' },
};

export function InsightsPanel({ insights }: { insights: CashInsight[] }) {
  const attention = insights.filter((i) => i.tone === 'warning' || i.tone === 'danger').length;
  return (
    <Panel title="Cash insights" subtitle={attention > 0 ? `${attention} item${attention === 1 ? '' : 's'} need attention` : 'Nothing urgent'} bodyClassName="pt-3">
      {insights.length === 0 ? (
        <EmptyState>Nothing needs your attention right now.</EmptyState>
      ) : (
        <ul className="space-y-2.5">
          {insights.map((insight) => {
            const Icon = insight.kind === 'trend' && insight.tone !== 'positive' ? TrendingDown : insight.tone === 'positive' && insight.kind !== 'trend' ? CircleCheck : (ICONS[insight.kind] ?? Info);
            const tone = TONES[insight.tone];
            return (
              <li key={insight.id} className={cn('flex gap-3 rounded-xl border-l-[3px] bg-surface/70 py-3 pr-3.5 pl-3', tone.rule)}>
                <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg', tone.icon)}>
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">{insight.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-ink-secondary">{insight.body}</p>
                  {insight.figures.length > 0 && (
                    <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
                      {insight.figures.map((f) => (
                        <div key={f.label}>
                          <dt className="text-[11px] text-ink-muted">{f.label}</dt>
                          <dd className={cn('tabular text-sm', f.emphasis ? 'font-bold text-ink' : 'font-medium text-ink-secondary')}>{f.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
