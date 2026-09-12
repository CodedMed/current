import type { UpcomingCash, UpcomingItem } from '../../../../shared/types.ts';
import { cn } from '../../lib/cn.ts';
import { mediumDate, money, shortDate, signedMoney } from '../../lib/format.ts';
import { EmptyState, Panel } from './Panel.tsx';

const SHOW = 6;

export function UpcomingPanel({ upcoming }: { upcoming: UpcomingCash }) {
  const net = upcoming.netImpact;
  return (
    <Panel
      title="Upcoming cash"
      subtitle={`Scheduled through ${mediumDate(upcoming.windowEnd)}`}
      bodyClassName="pt-3"
      footer={
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-ink">Upcoming net impact</span>
          <span className="flex items-baseline gap-2">
            <span className="text-xs text-ink-muted">next {upcoming.windowDays} days</span>
            <span className={cn('tabular text-lg font-bold', net > 0 ? 'text-positive-700' : net < 0 ? 'text-danger-700' : 'text-ink')}>{signedMoney(net)}</span>
          </span>
        </div>
      }
    >
      <div className="grid gap-6 md:grid-cols-2">
        <Column title="Inflows" items={upcoming.inflows} count={upcoming.inflowCount} total={upcoming.expectedIn} direction="INFLOW" windowDays={upcoming.windowDays} />
        <Column title="Outflows" items={upcoming.outflows} count={upcoming.outflowCount} total={upcoming.expectedOut} direction="OUTFLOW" windowDays={upcoming.windowDays} />
      </div>
    </Panel>
  );
}

function Column({ title, items, count, total, direction, windowDays }: { title: string; items: UpcomingItem[]; count: number; total: number; direction: 'INFLOW' | 'OUTFLOW'; windowDays: number }) {
  const shown = items.slice(0, SHOW);
  const rest = count - shown.length;
  const inflow = direction === 'INFLOW';
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 border-b border-line pb-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="text-right">
          <span className={cn('tabular block text-sm font-bold', inflow ? 'text-positive-700' : 'text-ink')}>{inflow ? '+' : '−'}{money(total)}</span>
          <span className="block text-[11px] text-ink-muted">
            {count} expected · {windowDays} days
          </span>
        </p>
      </div>
      {shown.length === 0 ? (
        <div className="pt-3">
          <EmptyState>Nothing scheduled.</EmptyState>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((item) => (
            <li key={item.id} className="flex items-center gap-3 py-2.5">
              <span className="tabular w-12 shrink-0 text-xs font-medium text-ink-muted">{shortDate(item.date)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{item.merchant}</span>
                <span className="block truncate text-xs text-ink-muted">
                  {item.description}
                  {item.confidence < 0.7 ? ' · likely' : ''}
                </span>
              </span>
              <span className={cn('tabular shrink-0 text-sm font-semibold', inflow ? 'text-positive-700' : 'text-ink')}>
                {inflow ? '+' : '−'}
                {money(item.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {rest > 0 && (
        <p className="pt-2 text-xs text-ink-muted">
          {rest} more in the next {windowDays} days
        </p>
      )}
    </div>
  );
}
