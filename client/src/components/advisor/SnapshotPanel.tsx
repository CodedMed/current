import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CopilotDashboard } from '../../../../shared/copilot.ts';
import { ApiError, api } from '../../lib/api.ts';
import { cn } from '../../lib/cn.ts';
import { mediumDate, money, signedMoney } from '../../lib/format.ts';
import type { AdvisorStrings } from '../../lib/advisor/strings.ts';
import { Badge } from '../ui/Badge.tsx';

interface SnapshotPanelProps {
  strings: AdvisorStrings;
  /** Bump to refetch (after a task is added, for example). */
  version: number;
}

/**
 * The same ledger read model the dashboard uses, shown next to the conversation so the owner can
 * see the figures every answer is grounded in. Read-only; the advisor context itself is fetched
 * server-side and never passes through the browser.
 */
export function SnapshotPanel({ strings, version }: SnapshotPanelProps) {
  const [data, setData] = useState<CopilotDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api.copilot
      .dashboard(undefined, controller.signal)
      .then((next) => {
        setData(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof ApiError ? err.message : strings.snapshotError);
      });
    return () => controller.abort();
  }, [version, attempt, strings.snapshotError]);

  return (
    <section aria-label={strings.snapshotTitle} className="rounded-2xl bg-panel p-5 shadow-card ring-1 ring-ink/5 sm:p-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">{strings.snapshotTitle}</h2>
          <p className="mt-0.5 text-sm text-ink-muted">{strings.snapshotSubtitle}</p>
        </div>
        {data?.meta.demoMode && <Badge tone="warning">Demo</Badge>}
      </header>

      {error && !data && (
        <p className="mt-4 flex items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2.5 text-sm text-ink-muted">
          <span className="truncate">{error}</span>
          <button type="button" onClick={() => setAttempt((a) => a + 1)} className="inline-flex shrink-0 items-center gap-1 font-semibold text-brand-700 hover:underline">
            <RefreshCw className="size-3.5" aria-hidden="true" />
            {strings.retry}
          </button>
        </p>
      )}

      {!data && !error && (
        <div className="mt-4 space-y-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-9" />
          ))}
        </div>
      )}

      {data && (
        <dl className="mt-4 divide-y divide-line">
          <Row label={strings.availableCash} value={money(data.totals.availableCash)} strong />
          <Row label={strings.expectedIn} value={`+${money(data.totals.expectedInflow30d)}`} tone="positive" />
          <Row label={strings.expectedOut} value={`−${money(data.totals.expectedOutflow30d)}`} />
          <Row label={strings.net30} value={signedMoney(data.totals.net30d)} tone={data.totals.net30d < 0 ? 'danger' : 'positive'} />
          <Row
            label={strings.projectedGap}
            value={data.projectedGap.present && data.projectedGap.date && data.projectedGap.amount !== null ? `−${money(data.projectedGap.amount)} · ${mediumDate(data.projectedGap.date.slice(0, 10))}` : strings.noGap}
            tone={data.projectedGap.present ? 'danger' : undefined}
          />
          <Row label={strings.overdue} value={String(data.overdueReceivables.length)} />
          <Row label={strings.openTasks} value={String(data.priorityTasks.length)} />
        </dl>
      )}
    </section>
  );
}

function Row({ label, value, strong = false, tone }: { label: string; value: string; strong?: boolean; tone?: 'positive' | 'danger' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-sm text-ink-secondary">{label}</dt>
      <dd className={cn('tabular text-right text-sm', strong ? 'text-base font-bold text-ink' : 'font-semibold text-ink', tone === 'positive' && 'text-positive-700', tone === 'danger' && 'text-danger-700')}>{value}</dd>
    </div>
  );
}
