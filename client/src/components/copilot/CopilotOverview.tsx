import { ArrowRight, RefreshCw } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { CashFlowForecast, CopilotDashboard } from '../../../../shared/copilot.ts';
import { useElementWidth } from '../../hooks/useElementWidth.ts';
import { api, ApiError } from '../../lib/api.ts';
import { cn } from '../../lib/cn.ts';
import { compactMoney, mediumDate, money, relativeTime, shortDate, titleCase } from '../../lib/format.ts';
import { Panel } from '../cashflow/Panel.tsx';
import { Segmented } from '../cashflow/Segmented.tsx';
import { Alert } from '../ui/Alert.tsx';
import { Button, buttonClasses } from '../ui/Button.tsx';

type Horizon = 30 | 60 | 90;
type Overview = { dashboard: CopilotDashboard; forecast: CashFlowForecast };

const HORIZONS: Array<{ id: Horizon; label: string }> = [
  { id: 30, label: '30 days' },
  { id: 60, label: '60 days' },
  { id: 90, label: '90 days' },
];

/** The document-aware ledger projection, separate from the bank-activity trend chart. */
export function CopilotOverview({ version = 0 }: { version?: number }) {
  const [horizon, setHorizon] = useState<Horizon>(30);
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    // Clearing the previous horizon prevents showing its totals under a new selection.
    setData(null);
    void Promise.all([api.copilot.dashboard(horizon, controller.signal), api.copilot.forecast(horizon, controller.signal)])
      .then(([dashboard, forecast]) => {
        if (!controller.signal.aborted) setData({ dashboard, forecast });
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof ApiError ? err.message : 'Could not load your cash commitments.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [horizon, version, retry]);

  const forecast = data?.forecast;
  const dashboard = data?.dashboard;
  const endBalance = forecast?.timeline.at(-1)?.projectedBalance ?? forecast?.currentCash ?? 0;

  return (
    <Panel
      id="commitments"
      title="Cash commitments"
      subtitle="Your workspace’s bank balances, recorded cash events, and uploaded invoices."
      aside={
        <Button variant="ghost" size="sm" onClick={() => setRetry((value) => value + 1)} disabled={loading} aria-label="Refresh cash commitments" icon={<RefreshCw className={cn('size-4', loading && 'animate-spin')} aria-hidden="true" />}>
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ink-muted">
            {dashboard ? `${dashboard.meta.demoMode ? 'Demo ledger' : 'Workspace ledger'} · ${dashboard.meta.lastSyncedAt ? `Bank sync ${relativeTime(dashboard.meta.lastSyncedAt)}` : 'Bank sync pending'}` : 'Upload an invoice to include its amount and due date in these commitments.'}
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <OverviewLink to="/documents">Manage invoices</OverviewLink>
            <OverviewLink to="/advisor">Ask your advisor</OverviewLink>
          </div>
        </div>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Cash commitments horizon" options={HORIZONS} value={horizon} onChange={setHorizon} />
        <p className="text-xs text-ink-muted">Includes overdue items · all workspace accounts</p>
      </div>

      {loading && (
        <div className="mt-5" role="status" aria-label="Loading cash commitments" aria-busy="true">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => <div key={index} className="skeleton h-20" />)}
          </div>
          <div className="skeleton mt-4 h-40" />
        </div>
      )}
      {error && (
        <Alert tone="warning" title="Cash commitments are unavailable" className="mt-4" action={<Button variant="secondary" size="sm" onClick={() => setRetry((value) => value + 1)}>Try again</Button>}>
          {error}
        </Alert>
      )}
      {dashboard && forecast && (
        <div className="mt-5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-5 md:grid-cols-4">
            <Metric label="Available cash" value={forecast.currentCash} />
            <Metric label={`Expected in · ${forecast.horizonDays}d`} value={forecast.expectedInflow} tone="positive" />
            <Metric label={`Expected out · ${forecast.horizonDays}d`} value={forecast.expectedOutflow} />
            <Metric label={`Cash in ${forecast.horizonDays} days`} value={endBalance} tone={endBalance < 0 ? 'danger' : undefined} />
          </dl>

          <CommitmentsChart dashboard={dashboard} forecast={forecast} />

          {forecast.firstGapDate ? (
            <Alert tone="warning" title={`First cash gap: ${mediumDate(forecast.firstGapDate.slice(0, 10))}`} className="mt-4"
              action={<Link to="/advisor" className={buttonClasses('secondary', 'sm')}>Plan next steps <ArrowRight className="size-4" aria-hidden="true" /></Link>}>
              {forecast.firstGapAmount !== null ? `${money(forecast.firstGapAmount)} short` : 'Cash is projected below zero'} when recorded payments and receipts are applied. Overdue items are included immediately.
            </Alert>
          ) : (
            <p className="mt-3 rounded-lg bg-surface px-3 py-2 text-sm text-ink-secondary">
              {forecast.currentCash < 0 ? 'Available cash is currently below zero.' : `No cash gap in the next ${forecast.horizonDays} days from recorded commitments.`}
              {' '}Upload new invoices to keep this projection current.
            </p>
          )}

          <div className="mt-5 grid gap-5 lg:grid-cols-3">
            <SummaryList title="Upcoming obligations" empty="No outstanding payments in this period." hasItems={dashboard.upcomingObligations.length > 0}>
              {dashboard.upcomingObligations.slice(0, 3).map((item) => (
                <SummaryRow key={item.cashEventId} label={item.label} amount={item.amount}
                  detail={`${shortDate(item.dueDate.slice(0, 10))} · ${item.status === 'OVERDUE' ? 'Overdue' : titleCase(item.category)}`} />
              ))}
            </SummaryList>
            <SummaryList title="Overdue receivables" empty="No overdue receivables recorded." hasItems={dashboard.overdueReceivables.length > 0}>
              {dashboard.overdueReceivables.slice(0, 3).map((item) => (
                <SummaryRow key={item.cashEventId} label={item.counterpartyLabel} amount={item.amount}
                  detail={`${item.daysOverdue} ${item.daysOverdue === 1 ? 'day' : 'days'} overdue`} />
              ))}
            </SummaryList>
            <SummaryList title="Needs attention" empty="No flagged invoices or open tasks." hasItems={dashboard.highRiskInvoices.length + dashboard.priorityTasks.length > 0}>
              {dashboard.highRiskInvoices.slice(0, 2).map((item) => (
                <li key={item.invoiceId} className="py-2.5">
                  <Link to={`/documents#invoice-${encodeURIComponent(item.invoiceId)}`} className="block rounded text-sm font-medium text-brand-700 hover:underline">{item.vendorLabel}</Link>
                  <p className="mt-0.5 text-xs text-ink-muted">{titleCase(item.severity)} risk · {item.reasons[0] ?? 'Review this invoice before paying.'}</p>
                </li>
              ))}
              {dashboard.priorityTasks.slice(0, 2).map((item) => (
                <li key={item.id} className="py-2.5">
                  <Link to="/tasks" className="block rounded text-sm font-medium text-brand-700 hover:underline">{item.title}</Link>
                  <p className="mt-0.5 text-xs text-ink-muted">{titleCase(item.priority)} priority · {titleCase(item.status)}{item.dueDate ? ` · ${shortDate(item.dueDate.slice(0, 10))}` : ''}</p>
                </li>
              ))}
              {dashboard.priorityTasks.length > 0 && <li className="pt-2"><OverviewLink to="/tasks">View all tasks</OverviewLink></li>}
            </SummaryList>
          </div>
        </div>
      )}
    </Panel>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: 'positive' | 'danger' }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-ink-secondary">{label}</dt>
      <dd className={cn('tabular mt-1 break-words text-xl font-bold tracking-tight sm:text-2xl', tone === 'positive' ? 'text-positive-700' : tone === 'danger' ? 'text-danger-700' : 'text-ink')}>{money(value)}</dd>
    </div>
  );
}

function CommitmentsChart({ dashboard, forecast }: Overview) {
  const [chartRef, width] = useElementWidth<HTMLDivElement>();
  const points = dashboard.cashFlowSeries.filter((point) => point.projectedBalance !== null);
  if (points.length === 0) return null;
  const height = 150;
  const left = 60;
  const right = width - 12;
  const top = 16;
  const bottom = height - 26;
  const balances = [forecast.currentCash, ...points.map((point) => point.projectedBalance as number)];
  const low = Math.min(...balances);
  const high = Math.max(...balances);
  const pad = Math.max((high - low) * 0.15, 100);
  const min = low - pad;
  const max = high + pad;
  const x = (index: number) => left + index / Math.max(1, points.length - 1) * (right - left);
  const y = (balance: number) => bottom - (balance - min) / (max - min) * (bottom - top);
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(point.projectedBalance as number)}`).join(' ');
  const last = points.at(-1)!;

  return (
    <figure className="mt-5">
      <div ref={chartRef} className="w-full min-w-0 overflow-hidden">
      <svg width={width} height={height} className="block" role="img" aria-label={`Recorded commitments project cash from ${money(points[0]!.projectedBalance as number)} today to ${money(last.projectedBalance as number)} by ${mediumDate(last.date)}.`}>
        {[min, (min + max) / 2, max].map((value) => (
          <g key={value}>
            <line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="var(--color-line)" />
            <text x={left - 8} y={y(value)} dy="0.35em" textAnchor="end" className="tabular fill-[var(--color-ink-muted)] text-[11px]">{compactMoney(value)}</text>
          </g>
        ))}
        {min < 0 && max > 0 && <line x1={left} x2={right} y1={y(0)} y2={y(0)} stroke="var(--color-danger-600)" strokeDasharray="4 4" />}
        <path d={path} fill="none" stroke="var(--color-series-1)" strokeWidth="2.5" strokeLinejoin="round" />
        <circle cx={right} cy={y(last.projectedBalance as number)} r="3.5" fill="var(--color-series-1)" />
        <text x={left} y={height - 6} className="fill-[var(--color-ink-muted)] text-[11px]">Today</text>
        <text x={right} y={height - 6} textAnchor="end" className="fill-[var(--color-ink-muted)] text-[11px]">{shortDate(last.date)}</text>
      </svg>
      </div>
      <figcaption className="mt-1 text-xs text-ink-muted">Projected cash after recorded commitments. Receipts are assumed to arrive when due; overdue items are applied today.</figcaption>
    </figure>
  );
}

function SummaryList({ title, empty, hasItems, children }: { title: string; empty: string; hasItems: boolean; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <h3 className="border-b border-line pb-2 text-sm font-semibold text-ink">{title}</h3>
      {hasItems ? <ul className="divide-y divide-line">{children}</ul> : <p className="py-3 text-sm text-ink-muted">{empty}</p>}
    </div>
  );
}

function SummaryRow({ label, detail, amount }: { label: string; detail: string; amount: number }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink" title={label}>{label}</p>
        <p className="mt-0.5 text-xs text-ink-muted">{detail}</p>
      </div>
      <span className="tabular shrink-0 text-sm font-semibold text-ink">{money(amount)}</span>
    </li>
  );
}

function OverviewLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className="inline-flex items-center gap-1 rounded text-sm font-semibold text-brand-700 hover:underline">{children}<ArrowRight className="size-3.5" aria-hidden="true" /></Link>;
}
