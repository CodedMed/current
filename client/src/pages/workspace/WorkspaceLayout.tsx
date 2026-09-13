import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useNavigate, useOutletContext } from 'react-router';
import type {
  CashTransaction,
  CashflowDashboard,
  CashflowFilters,
  ForecastHorizon,
  ForecastScenario,
  PublicUser,
  ReviewDecision,
} from '../../../../shared/types.ts';
import { AddTransactionDialog } from '../../components/cashflow/AddTransactionDialog.tsx';
import { TopBar } from '../../components/cashflow/TopBar.tsx';
import { TransactionDrawer } from '../../components/cashflow/TransactionDrawer.tsx';
import { Alert } from '../../components/ui/Alert.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { ApiError, api } from '../../lib/api.ts';
import { cn } from '../../lib/cn.ts';
import { useSession } from '../../lib/session.tsx';

/** How often accounts re-sync on their own, and how stale a backgrounded tab may get. */
const SYNC_INTERVAL_MS = 5 * 60_000;

/**
 * Everything the six workspace pages share: one dashboard request, one set of filters, one
 * transaction drawer. Each page renders a part of the same payload, so switching between them
 * costs nothing and the header keeps its state.
 */
export interface WorkspaceContext {
  data: CashflowDashboard;
  user: PublicUser | null;
  companyId: string;
  accountIds: string[] | null;
  setAccountIds: (ids: string[] | null) => void;
  horizon: ForecastHorizon;
  setHorizon: (horizon: ForecastHorizon) => void;
  scenario: ForecastScenario;
  setScenario: (scenario: ForecastScenario) => void;
  showForecast: boolean;
  setShowForecast: (show: boolean) => void;
  /** Bumps when the ledger changes, so panels that own their data re-fetch. */
  version: number;
  refreshing: boolean;
  openTransaction: (txn: CashTransaction) => void;
  decide: (txn: CashTransaction, decision: ReviewDecision) => Promise<void>;
  notify: (message: string) => void;
  changed: () => void;
}

export function useWorkspace(): WorkspaceContext {
  return useOutletContext<WorkspaceContext>();
}

export default function WorkspaceLayout() {
  const { session, signOut } = useSession();
  const navigate = useNavigate();
  const user = session?.user ?? null;

  const [companyId, setCompanyId] = useState('');
  const [accountIds, setAccountIds] = useState<string[] | null>(null);
  const [period, setPeriod] = useState('last30');
  const [horizon, setHorizon] = useState<ForecastHorizon>(90);
  const [scenario, setScenario] = useState<ForecastScenario>('expected');
  const [showForecast, setShowForecast] = useState(true);

  const [data, setData] = useState<CashflowDashboard | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  /** Guards against an interval firing on top of a sync that is still running. */
  const syncingRef = useRef(false);
  const lastSyncAt = useRef(0);
  /** From the sync itself, so the header stays current without redrawing the whole page. */
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [drawerTxn, setDrawerTxn] = useState<CashTransaction | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const filters = useMemo<CashflowFilters>(
    () => ({ companyId, accountIds, period, horizon, scenario }),
    [companyId, accountIds, period, horizon, scenario],
  );

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

  // The company list comes from the API: with Nessie it is the user's provisioned workspace.
  useEffect(() => {
    let cancelled = false;
    api.cashflow
      .companies()
      .then((r) => {
        if (!cancelled) setCompanyId((current) => current || r.companies[0]?.id || '');
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err : new ApiError(0, 'unknown', 'Could not load your companies.'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!filters.companyId) return;
    void load(filters);
  }, [filters, load, version]);

  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3800);
    return () => window.clearTimeout(t);
  }, [toast]);

  /**
   * Syncing is automatic, so it stays quiet: a background sync that changed nothing must not
   * redraw the page under someone who is reading it, and a failure waits for the next attempt.
   */
  const sync = useCallback(
    async (reason: 'auto' | 'manual') => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      setSyncing(true);
      try {
        const result = await api.cashflow.sync(companyId);
        lastSyncAt.current = Date.now();
        setSyncedAt(result.syncedAt);
        if (result.postedCount > 0) {
          setToast(`${result.postedCount} pending item${result.postedCount === 1 ? '' : 's'} posted.`);
        }
        if (result.postedCount > 0 || reason === 'manual') setVersion((v) => v + 1);
      } catch (err) {
        if (reason === 'manual') setToast(err instanceof ApiError ? err.message : 'Sync failed. Try again.');
      } finally {
        syncingRef.current = false;
        setSyncing(false);
      }
    },
    [companyId],
  );

  // Accounts sync on their own: once the company is known, every few minutes after that, and
  // whenever the tab comes back to the front after being away long enough to be stale.
  useEffect(() => {
    if (!companyId) return;
    void sync('auto');
    const timer = setInterval(() => void sync('auto'), SYNC_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastSyncAt.current > SYNC_INTERVAL_MS) void sync('auto');
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [companyId, sync]);

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

  const decide = useCallback(
    async (txn: CashTransaction, decision: ReviewDecision) => {
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
    },
    [companyId],
  );

  const onCompanyChange = (id: string) => {
    setCompanyId(id);
    setAccountIds(null);
    setDrawerTxn(null);
    setAddOpen(false);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/', { replace: true });
  };

  const context: WorkspaceContext | null = data
    ? {
        data,
        user,
        companyId,
        accountIds,
        setAccountIds,
        horizon,
        setHorizon,
        scenario,
        setScenario,
        showForecast,
        setShowForecast,
        version,
        refreshing,
        openTransaction: setDrawerTxn,
        decide,
        notify: setToast,
        changed: () => setVersion((v) => v + 1),
      }
    : null;

  return (
    <div className="min-h-dvh bg-surface">
      <TopBar
        user={user}
        companies={data?.companies ?? [{ id: companyId, name: 'Loading…', legalName: '' }]}
        companyId={companyId}
        dataSource={data?.dataSource ?? null}
        accounts={data?.accounts ?? []}
        accountIds={accountIds}
        periods={data?.periods ?? []}
        period={period}
        lastSyncedAt={syncedAt ?? data?.lastSyncedAt ?? null}
        syncing={syncing}
        loading={!data}
        onCompanyChange={onCompanyChange}
        onAccountsChange={setAccountIds}
        onPeriodChange={setPeriod}
        onAddTransaction={() => setAddOpen(true)}
        onSignOut={() => void handleSignOut()}
      />

      <main className="mx-auto max-w-[1400px] px-5 pt-6 pb-24 sm:px-8 sm:pt-8">
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

        {!data && !error && <WorkspaceSkeleton />}

        {context && (
          <div className={cn('transition-opacity duration-300', refreshing && 'opacity-60')} aria-busy={refreshing || undefined}>
            {error && (
              <Alert tone="warning" className="mb-5" title="Showing the last successful load">
                {error.message}
              </Alert>
            )}
            <Outlet context={context} />
            <p className="mt-8 text-center text-xs text-ink-muted">
              {context.data.dataSource.label} from the current.surf cash-flow API · generated{' '}
              {new Date(context.data.generatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </p>
          </div>
        )}
      </main>

      <TransactionDrawer
        txn={drawerTxn}
        companyId={companyId}
        accounts={data?.accounts ?? []}
        categories={data?.categories ?? []}
        onClose={() => setDrawerTxn(null)}
        onSaved={onSaved}
        onDecide={decide}
      />
      <AddTransactionDialog
        open={addOpen}
        companyId={companyId}
        accounts={data?.accounts ?? []}
        categories={data?.categories ?? []}
        today={data?.today ?? new Date().toISOString().slice(0, 10)}
        onClose={() => setAddOpen(false)}
        onAdded={onAdded}
      />

      {toast && (
        <div role="status" className="animate-fade-up fixed bottom-5 left-1/2 z-[60] max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-full bg-navy-900 px-4 py-2 text-sm font-medium text-white shadow-float">
          {toast}
        </div>
      )}
    </div>
  );
}

function WorkspaceSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard">
      <div className="skeleton mb-2 h-8 w-64" />
      <div className="skeleton mb-5 h-4 w-96 max-w-full" />
      <div className="skeleton h-36" />
      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <div className="skeleton h-[440px] xl:col-span-2" />
        <div className="skeleton h-[440px]" />
      </div>
    </div>
  );
}
