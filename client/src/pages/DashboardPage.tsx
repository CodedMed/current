import { LogOut, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { DashboardResponse } from '../../../shared/types.ts';
import { BalanceChart } from '../components/charts/BalanceChart.tsx';
import { ChartCard, LegendSwatch } from '../components/charts/ChartCard.tsx';
import { FlowColumns } from '../components/charts/FlowColumns.tsx';
import {
  AccountsModule,
  BillsModule,
  CashManagementModule,
  CategoriesModule,
  ReceivablesModule,
  ReportModule,
  TransactionsModule,
  VendorsModule,
  WorkflowsModule,
} from '../components/dashboard/Modules.tsx';
import { StatTile } from '../components/dashboard/StatTile.tsx';
import { Alert } from '../components/ui/Alert.tsx';
import { Badge, ModeBadge } from '../components/ui/Badge.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Logo } from '../components/ui/Logo.tsx';
import { ApiError, api } from '../lib/api.ts';
import { cn } from '../lib/cn.ts';
import { initials, money, signedMoney } from '../lib/format.ts';
import { useSession } from '../lib/session.tsx';

type Range = 30 | 60 | 90;
const RANGES: Range[] = [30, 60, 90];

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function DashboardPage() {
  const { session, signOut } = useSession();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<Range>(90);
  const user = session?.user;

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    setError(null);
    try {
      setData(await api.dashboard(refresh));
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'unknown', 'Could not load your dashboard.'));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const history = useMemo(() => data?.history.slice(-range) ?? [], [data, range]);
  const weeks = useMemo(() => data?.weeklyFlows.slice(-Math.ceil(range / 7)) ?? [], [data, range]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/', { replace: true });
  };

  return (
    <div className="min-h-dvh bg-surface">
      <header className="sticky top-0 z-20 border-b border-line bg-panel/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3 sm:px-8">
          <div className="flex min-w-0 items-center gap-4">
            <Logo />
            {data && (
              <span className="hidden min-w-0 items-center gap-2 border-l border-line pl-4 sm:flex">
                <span className="truncate text-sm font-semibold text-ink">{data.business.name}</span>
                <Badge tone="neutral">{data.business.businessTypeLabel}</Badge>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {data && (
              <span className="hidden sm:inline-flex">
                <ModeBadge mode={data.dataSource.mode} service="Nessie" />
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={() => void load(true)} loading={refreshing} icon={<RefreshCw className="size-4" aria-hidden="true" />} aria-label="Refresh data">
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            {user && (
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="inline-flex h-9 items-center gap-2 rounded-lg pr-2.5 pl-1 text-sm font-medium text-ink-secondary transition-colors hover:bg-ink/5 hover:text-ink"
                title="Sign out"
              >
                {user.picture ? (
                  <img src={user.picture} alt="" className="size-7 rounded-full" referrerPolicy="no-referrer" />
                ) : (
                  <span className="grid size-7 place-items-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-800">{initials(user.name)}</span>
                )}
                <LogOut className="size-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        {error && !data && (
          <Alert
            tone="danger"
            title="We couldn't load your dashboard"
            action={
              <Button size="sm" onClick={() => void load()} icon={<RefreshCw className="size-4" aria-hidden="true" />}>
                Try again
              </Button>
            }
          >
            {error.message}
          </Alert>
        )}

        {!data && !error && <DashboardSkeleton />}

        {data && (
          <div className={cn('animate-fade-up transition-opacity duration-300', refreshing && 'opacity-60')} aria-busy={refreshing || undefined}>
            {error && (
              <Alert tone="warning" className="mb-6" title="Showing the last successful load">
                {error.message}
              </Alert>
            )}

            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-[28px]">
                  {greeting()}, {user?.givenName ?? 'there'}
                </h1>
                <p className="mt-1 text-sm text-ink-secondary">
                  Here is where <span className="font-semibold text-ink">{data.business.name}</span> stands as of {new Date(data.generatedAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.
                </p>
              </div>
              <div className="inline-flex rounded-lg bg-panel p-0.5 shadow-ring" role="group" aria-label="Date range">
                {RANGES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={range === r}
                    onClick={() => setRange(r)}
                    className={cn('h-8 rounded-md px-3 text-xs font-semibold transition-colors', range === r ? 'bg-navy-900 text-white' : 'text-ink-secondary hover:text-ink')}
                  >
                    {r} days
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile
                hero
                label="Cash on hand"
                value={money(data.summary.cashOnHand)}
                hint={`Across ${data.accounts.filter((a) => a.type !== 'Credit Card').length} deposit accounts`}
                className="sm:col-span-2 xl:col-span-1"
              />
              <StatTile label="Money in · 30 days" value={money(data.summary.inflow30d)} delta={{ value: data.summary.inflowChange, goodWhenUp: true, versus: 'vs prior 30 days' }} />
              <StatTile label="Money out · 30 days" value={money(data.summary.outflow30d)} delta={{ value: data.summary.outflowChange, goodWhenUp: false, versus: 'vs prior 30 days' }} />
              <StatTile
                label="Net cash flow · 30 days"
                value={signedMoney(data.summary.net30d)}
                hint={
                  data.summary.runwayMonths !== null
                    ? `About ${data.summary.runwayMonths.toFixed(1)} months of runway at this pace`
                    : `${money(data.summary.billsDue14d)} in bills due within 14 days`
                }
              />
            </div>

            <div className="mt-6 grid gap-4 xl:grid-cols-5">
              <ChartCard
                className="xl:col-span-3"
                title="Cash position"
                subtitle={data.forecast ? `Last ${range} days with a 30-day projection` : `Last ${range} days`}
                legend={
                  data.forecast ? (
                    <span className="hidden items-center gap-3 sm:flex">
                      <LegendSwatch color="#2a78d6" label="Balance" shape="line" />
                      <LegendSwatch color="#2a78d6" label="Projected" shape="dashed" />
                    </span>
                  ) : undefined
                }
                table={{
                  columns: ['Date', 'Balance', 'Inflow', 'Outflow'],
                  rows: [
                    ...history.map((p) => [p.date, money(p.balance), money(p.inflow), money(p.outflow)]),
                    ...(data.forecast ?? []).map((p) => [`${p.date} (projected)`, money(p.projected), '', '']),
                  ],
                }}
              >
                <BalanceChart history={history} forecast={data.forecast} />
              </ChartCard>

              <ChartCard
                className="xl:col-span-2"
                title="Weekly money in vs out"
                subtitle={`Last ${weeks.length} weeks`}
                legend={
                  <span className="flex items-center gap-3">
                    <LegendSwatch color="#2a78d6" label="In" />
                    <LegendSwatch color="#eb6834" label="Out" />
                  </span>
                }
                table={{
                  columns: ['Week of', 'Inflow', 'Outflow', 'Net'],
                  rows: weeks.map((w) => [w.weekStart, money(w.inflow), money(w.outflow), signedMoney(w.inflow - w.outflow)]),
                }}
              >
                <FlowColumns weeks={weeks} />
              </ChartCard>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-flow-dense lg:grid-cols-2">
              {data.receivables && <ReceivablesModule items={data.receivables} open={data.summary.openReceivables} overdue={data.summary.overdueReceivables} />}
              {data.bills && <BillsModule bills={data.bills} due14d={data.summary.billsDue14d} />}
              {data.cashManagement && <CashManagementModule cash={data.cashManagement} />}
              {data.categories && <CategoriesModule categories={data.categories} />}
              {data.report && <ReportModule report={data.report} />}
              {data.vendors && <VendorsModule vendors={data.vendors} />}
              {data.workflows && <WorkflowsModule workflows={data.workflows} />}
              <AccountsModule accounts={data.accounts} />
              <TransactionsModule transactions={data.recentTransactions} />
            </div>

            <p className="mt-8 text-center text-xs text-ink-muted">
              Data from the Nessie banking API ({data.dataSource.mode === 'live' ? 'live sandbox environment' : 'local fixture'}) · customer {data.dataSource.customerId.slice(-8)} ·
              generated {new Date(data.generatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard">
      <div className="skeleton mb-2 h-8 w-64" />
      <div className="skeleton mb-6 h-4 w-80" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton h-32" />
        ))}
      </div>
      <div className="mt-6 grid gap-4 xl:grid-cols-5">
        <div className="skeleton h-80 xl:col-span-3" />
        <div className="skeleton h-80 xl:col-span-2" />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton h-64" />
        ))}
      </div>
    </div>
  );
}
