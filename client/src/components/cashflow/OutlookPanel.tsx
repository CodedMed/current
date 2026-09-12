import { CircleCheck, Flame } from 'lucide-react';
import type { CashPosition, CashflowKpis } from '../../../../shared/types.ts';
import { cn } from '../../lib/cn.ts';
import { mediumDate, money, shortDate, signedMoney } from '../../lib/format.ts';

interface OutlookPanelProps {
  runway: CashflowKpis['runway'];
  cashPosition: CashPosition;
  today: string;
}

const SCENARIO_LABEL = { expected: 'Expected scenario', conservative: 'Conservative scenario', optimistic: 'Optimistic scenario' } as const;

/** Runway and the 90-day outlook share one panel: both answer "how long, and how low?" */
export function OutlookPanel({ runway, cashPosition, today }: OutlookPanelProps) {
  const { checkpoints, lowest } = cashPosition;
  const todayBalance = cashPosition.today.balance;
  const lowestDrop = todayBalance > 0 ? (lowest.projected - todayBalance) / todayBalance : 0;
  const lowTone = lowest.projected < 0 ? 'danger' : lowestDrop < -0.15 ? 'warning' : 'neutral';
  const runsOut = runway.months !== null ? new Date(new Date(`${today}T00:00:00Z`).getTime() + runway.months * 30.4 * 86_400_000).toISOString().slice(0, 10) : null;

  return (
    <section id="forecast" className="flex min-w-0 flex-col rounded-2xl bg-panel shadow-card ring-1 ring-ink/5 scroll-mt-52 lg:scroll-mt-36" aria-label="Runway and forecast">
      <div className="px-5 pt-5 sm:px-6 sm:pt-6">
        <h2 className="text-[15px] font-semibold text-ink">Cash runway</h2>
        <p className="mt-0.5 text-sm text-ink-muted">Based on the last {runway.basisMonths} full months</p>
        {runway.state === 'positive' ? (
          <div className="mt-4">
            <p className="flex items-center gap-2 text-[22px] leading-none font-bold tracking-tight text-positive-700">
              <CircleCheck className="size-5" aria-hidden="true" />
              Cash-flow positive
            </p>
            <p className="mt-3 text-sm text-ink-secondary">Average monthly surplus</p>
            <p className="tabular text-lg font-semibold text-ink">{signedMoney(runway.averageMonthlyNet)}</p>
          </div>
        ) : (
          <div className="mt-4">
            <p className="tabular flex items-baseline gap-2 text-[34px] leading-none font-bold tracking-tight text-ink">
              {runway.months?.toFixed(1)}
              <span className="text-base font-semibold text-ink-secondary">months</span>
            </p>
            <p className="mt-3 flex items-center gap-1.5 text-sm text-ink-secondary">
              <Flame className="size-4 text-danger-600" aria-hidden="true" />
              Average monthly burn
            </p>
            <p className="tabular text-lg font-semibold text-ink">{money(-runway.averageMonthlyNet)}</p>
            {runsOut && <p className="mt-1 text-xs text-ink-muted">At this pace cash lasts until about {mediumDate(runsOut)}.</p>}
          </div>
        )}
      </div>

      <div className="mx-5 my-5 border-t border-line sm:mx-6" />

      <div className="px-5 pb-5 sm:px-6 sm:pb-6">
        <h2 className="text-[15px] font-semibold text-ink">90-day forecast</h2>
        <p className="mt-0.5 text-sm text-ink-muted">{SCENARIO_LABEL[cashPosition.scenario]}</p>
        <dl className="mt-4 space-y-2.5">
          <Row label="Today" value={money(todayBalance)} />
          {checkpoints.map((c) => (
            <Row key={c.days} label={`${c.days} days`} hint={shortDate(c.date)} value={money(c.balance)} delta={c.balance - todayBalance} />
          ))}
        </dl>
        <div
          className={cn(
            'mt-5 rounded-xl p-4 ring-1 ring-inset',
            lowTone === 'danger' ? 'bg-danger-50 ring-danger-100' : lowTone === 'warning' ? 'bg-warning-50 ring-warning-100' : 'bg-surface ring-line',
          )}
        >
          <p className="text-xs font-semibold text-ink-secondary">Lowest projected cash</p>
          <p className={cn('tabular mt-1 text-[26px] leading-none font-bold tracking-tight', lowTone === 'danger' ? 'text-danger-700' : 'text-ink')}>{money(lowest.projected)}</p>
          <p className="mt-1.5 text-sm text-ink-secondary">
            {mediumDate(lowest.date)} · {signedMoney(lowest.projected - todayBalance, { compact: true })} from today
          </p>
        </div>
      </div>
    </section>
  );
}

function Row({ label, hint, value, delta }: { label: string; hint?: string; value: string; delta?: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-ink-secondary">
        {label}
        {hint && <span className="ml-1.5 text-xs text-ink-muted">{hint}</span>}
      </dt>
      <dd className="flex items-baseline gap-2">
        {delta !== undefined && (
          <span className={cn('tabular text-xs font-medium', delta > 0 ? 'text-positive-700' : delta < 0 ? 'text-danger-600' : 'text-ink-muted')}>{signedMoney(delta, { compact: true })}</span>
        )}
        <span className="tabular text-sm font-semibold text-ink">{value}</span>
      </dd>
    </div>
  );
}
