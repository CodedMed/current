import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { CashTransaction, CashflowDashboard, CashflowFilters, ForecastHorizon, ForecastScenario, ReviewDecision } from '../../../shared/types.ts';
import { AccountsPanel } from '../components/cashflow/AccountsPanel.tsx';
import { AddTransactionDialog } from '../components/cashflow/AddTransactionDialog.tsx';
import { BreakdownPanel } from '../components/cashflow/BreakdownPanel.tsx';
import { CashPositionChart } from '../components/cashflow/CashPositionChart.tsx';
import { FinancingPanel } from '../components/cashflow/FinancingPanel.tsx';
import { InsightsPanel } from '../components/cashflow/InsightsPanel.tsx';
import { KpiStrip } from '../components/cashflow/KpiStrip.tsx';
import { MonthlyFlowChart } from '../components/cashflow/MonthlyFlowChart.tsx';
import { OutlookPanel } from '../components/cashflow/OutlookPanel.tsx';
import { ReviewPanel } from '../components/cashflow/ReviewPanel.tsx';
import { SECTIONS, TopBar, type SectionId } from '../components/cashflow/TopBar.tsx';
import { TransactionDrawer } from '../components/cashflow/TransactionDrawer.tsx';
import { TransactionsPanel } from '../components/cashflow/TransactionsPanel.tsx';
import { UpcomingPanel } from '../components/cashflow/UpcomingPanel.tsx';
import { Alert } from '../components/ui/Alert.tsx';
import { Button } from '../components/ui/Button.tsx';
import { ApiError, api } from '../lib/api.ts';
import { cn } from '../lib/cn.ts';
import { useSession } from '../lib/session.tsx';

const DEFAULT_COMPANY = 'acme';

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function DashboardPage() {
  const { session, signOut } = useSession();
  const navigate = useNavigate();
  const user = session?.user ?? null;

  const [companyId, setCompanyId] = useState(DEFAULT_COMPANY);
  const [accountIds, setAccountIds] = useState<string[] | null>(null);
  const [period, setPeriod] = useState('last30');
  const [horizon, setHorizon] = useState<ForecastHorizon>(90);
  const [scenario, setScenario] = useState<ForecastScenario>('expected');
  const [showForecast, setShowForecast] = useState(true);

  const [data, setData] = useState<CashflowDashboard | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [version, setVersion] = useState(0);
  const [activeSection, setActiveSection] = useState<SectionId>('overview');
  const [drawerTxn, setDrawerTxn] = useState<CashTransaction | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  /** Until this time the scroll spy stays quiet so a tab click is not overridden mid-scroll. */
  const spyLock = useRef(0);

  const filters = useMemo<CashflowFilters>(() => ({ companyId, accountIds, period, horizon, scenario }), [companyId, accountIds, period, horizon, scenario]);

  const load = useCallback(async (f: CashflowFilters) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setRefreshing(true);
    try {
      const next = await api.cashflow.dashboard(f, controller.signal);
      if (controller.signal.aborted) return;
      setData(next);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof ApiError ? err : new ApiError(0, 'unknown', 'Could not load your dashboard.'));
    } finally {
      if (abort.current === controller) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(filters);
  }, [filters, load, version]);

  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3800);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Keep the section tabs in step with what is on screen: the section whose top
  // sits closest above the header line wins.
  const hasData = data !== null;
  useEffect(() => {
    if (!hasData) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (Date.now() < spyLock.current) return;
      let current: SectionId = 'overview';
      let best = Number.NEGATIVE_INFINITY;
      for (const s of SECTIONS) {
        const top = document.getElementById(s.id)?.getBoundingClientRect().top;
        if (top === undefined || top > 200 || top <= best) continue;
        best = top;
        current = s.id;
      }
      setActiveSection(current);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [hasData]);

  const navigateTo = (id: SectionId) => {
    spyLock.current = Date.now() + 1000;
    setActiveSection(id);
    if (id === 'overview') window.scrollTo({ top: 0, behavior: 'smooth' });
    else document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const result = await api.cashflow.sync(companyId);
      setToast(result.postedCount > 0 ? `Accounts synced. ${result.postedCount} pending item${result.postedCount === 1 ? '' : 's'} posted.` : 'Accounts synced.');
      setVersion((v) => v + 1);
    } catch (err) {
      setToast(err instanceof ApiError ? err.message : 'Sync failed. Try again.');
    } finally {
      setSyncing(false);
    }
  };

  const onAdded = (txn: CashTransaction) => {
    setAddOpen(false);
    setToast(txn.status === 'SCHEDULED' ? 'Scheduled. It now shows in upcoming cash and the forecast.' : 'Transaction added.');
    setVersion((v) => v + 1);
  };

  const onSaved = (txn: CashTransaction) => {
    setDrawerTxn(txn);
    setToast('Changes saved.');
    setVersion((v) => v + 1);
  };

  const onDecide = async (txn: CashTransaction, decision: ReviewDecision) => {
    try {
      const updated = await api.cashflow.reviews.decide(companyId, txn.id, decision);
      setDrawerTxn((prev) => (prev?.id === updated.id ? updated : prev));
      setToast(
        decision === 'approve'
          ? `${txn.merchant} bill confirmed. It now counts toward that vendor’s baseline.`
          : decision === 'dispute'
            ? `${txn.merchant} bill disputed. It will be left out of the baseline.`
            : `${txn.merchant} bill reopened for review.`,
      );
      setVersion((v) => v + 1);
    } catch (err) {
      setToast(err instanceof ApiError ? err.message : 'Could not save that decision.');
    }
  };

  const onCompanyChange = (id: string) => {
    setCompanyId(id);
    setAccountIds(null);
    setDrawerTxn(null);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/', { replace: true });
  };

  const asOf = data ? new Date(`${data.today}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '';

  return (
    <div className="min-h-dvh bg-surface">
      <TopBar
        user={user}
        companies={data?.companies ?? [{ id: companyId, name: 'Loading…', legalName: '' }]}
        companyId={companyId}
        accounts={data?.accounts ?? []}
        accountIds={accountIds}
        periods={data?.periods ?? []}
        period={period}
        lastSyncedAt={data?.lastSyncedAt ?? null}
        syncing={syncing}
        loading={!data}
        activeSection={activeSection}
        onCompanyChange={onCompanyChange}
        onAccountsChange={setAccountIds}
        onPeriodChange={setPeriod}
        onSync={() => void sync()}
        onAddTransaction={() => setAddOpen(true)}
        onNavigate={navigateTo}
        onSignOut={() => void handleSignOut()}
      />

      <main className="mx-auto max-w-[1400px] px-5 py-6 sm:px-8 sm:py-8">
        {error && !data && (
          <Alert
            tone="danger"
            title="We couldn't load your dashboard"
            action={
              <Button size="sm" onClick={() => void load(filters)} icon={<RefreshCw className="size-4" aria-hidden="true" />}>
                Try again
              </Button>
            }
          >
            {error.message}
          </Alert>
        )}

        {!data && !error && <DashboardSkeleton />}

        {data && (
          <div className={cn('transition-opacity duration-300', refreshing && 'opacity-60')} aria-busy={refreshing || undefined}>
            {error && (
              <Alert tone="warning" className="mb-5" title="Showing the last successful load">
                {error.message}
              </Alert>
            )}

            <section id="overview" className="scroll-mt-52 lg:scroll-mt-36" aria-label="Overview">
              <div className="mb-5">
                <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-[28px]">
                  {greeting()}, {user?.givenName ?? 'there'}
                </h1>
                <p className="mt-1 text-sm text-ink-secondary">
                  Here is where <span className="font-semibold text-ink">{data.company.name}</span> stands on {asOf}. Figures cover {data.period.label.toLowerCase()} across{' '}
                  {data.kpis.totalCash.accountCount === data.accounts.length ? 'all accounts' : `${data.kpis.totalCash.accountCount} of ${data.accounts.length} accounts`}.
                </p>
              </div>
              <KpiStrip kpis={data.kpis} period={data.period} />
            </section>

            <div className="mt-5 grid gap-5 xl:grid-cols-3">
              <div className="grid min-w-0 xl:col-span-2">
                <CashPositionChart
                  position={data.cashPosition}
                  showForecast={showForecast}
                  onShowForecast={setShowForecast}
                  onHorizon={setHorizon}
                  onScenario={setScenario}
                  animationKey={`${data.company.id}:${data.filters.accountIds?.join(',') ?? 'all'}`}
                />
              </div>
              <div className="grid min-w-0">
                <OutlookPanel runway={data.kpis.runway} cashPosition={data.cashPosition} today={data.today} />
              </div>
            </div>

            <div className="mt-5 grid gap-5 xl:grid-cols-5">
              <div className="grid min-w-0 xl:col-span-3">
                <MonthlyFlowChart months={data.monthlyFlows} period={data.period} cashIn={data.kpis.cashIn.value} cashOut={data.kpis.cashOut.value} />
              </div>
              <div className="grid min-w-0 xl:col-span-2">
                <BreakdownPanel breakdown={data.breakdown} periodLabel={data.period.label} />
              </div>
            </div>

            <div className="mt-5 grid gap-5 xl:grid-cols-5">
              <div className="grid min-w-0 xl:col-span-3">
                <UpcomingPanel upcoming={data.upcoming} />
              </div>
              <div className="grid min-w-0 xl:col-span-2">
                <InsightsPanel insights={data.insights} />
              </div>
            </div>

            <div className="mt-5 grid gap-5 xl:grid-cols-5">
              <div className="grid min-w-0 xl:col-span-3">
                <ReviewPanel queue={data.reviews} onDecide={onDecide} onOpen={setDrawerTxn} />
              </div>
              <div className="grid min-w-0 xl:col-span-2">
                <FinancingPanel companyId={companyId} version={version} onToast={setToast} />
              </div>
            </div>

            <div className="mt-5 grid gap-5 xl:grid-cols-5">
              <div className="grid min-w-0 xl:col-span-2">
                <AccountsPanel accounts={data.accounts} selectedIds={accountIds} onSelect={setAccountIds} />
              </div>
              <div className="grid min-w-0 xl:col-span-3">
                <TransactionsPanel
                  companyId={companyId}
                  accountIds={accountIds}
                  recent={data.recentTransactions}
                  accounts={data.accounts}
                  categories={data.categories}
                  version={version}
                  onOpen={setDrawerTxn}
                />
              </div>
            </div>

            <p className="mt-8 text-center text-xs text-ink-muted">
              {data.dataSource.label} from the Keel cash-flow API · generated {new Date(data.generatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </p>
          </div>
        )}
      </main>

      <TransactionDrawer txn={drawerTxn} companyId={companyId} accounts={data?.accounts ?? []} categories={data?.categories ?? []} onClose={() => setDrawerTxn(null)} onSaved={onSaved} onDecide={onDecide} />
      <AddTransactionDialog open={addOpen} companyId={companyId} accounts={data?.accounts ?? []} categories={data?.categories ?? []} today={data?.today ?? new Date().toISOString().slice(0, 10)} onClose={() => setAddOpen(false)} onAdded={onAdded} />

      {toast && (
        <div role="status" className="animate-fade-up fixed bottom-5 left-1/2 z-[60] max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-full bg-navy-900 px-4 py-2 text-sm font-medium text-white shadow-float">
          {toast}
        </div>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard">
      <div className="skeleton mb-2 h-8 w-64" />
      <div className="skeleton mb-5 h-4 w-96 max-w-full" />
      <div className="skeleton h-36" />
      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <div className="skeleton h-[440px] xl:col-span-2" />
        <div className="skeleton h-[440px]" />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-5">
        <div className="skeleton h-80 xl:col-span-3" />
        <div className="skeleton h-80 xl:col-span-2" />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-5">
        <div className="skeleton h-72 xl:col-span-3" />
        <div className="skeleton h-72 xl:col-span-2" />
      </div>
    </div>
  );
}
