import { Unplug } from 'lucide-react';
import type { CashAccount } from '../../../../shared/types.ts';
import { cn } from '../../lib/cn.ts';
import { accountTypeLabel, money, relativeTime } from '../../lib/format.ts';
import { InstitutionMark } from './InstitutionMark.tsx';
import { Panel } from './Panel.tsx';

interface AccountsPanelProps {
  accounts: CashAccount[];
  selectedIds: string[] | null;
  onSelect: (ids: string[] | null) => void;
}

export function AccountsPanel({ accounts, selectedIds, onSelect }: AccountsPanelProps) {
  const total = accounts.reduce((s, a) => s + a.bookBalance, 0);
  const selected = new Set(selectedIds ?? []);
  const filtered = selectedIds !== null && selectedIds.length > 0;
  return (
    <Panel
      title="Accounts"
      subtitle={filtered ? `Showing ${selected.size} of ${accounts.length}. Click an account to focus on it.` : 'Click an account to focus the dashboard on it.'}
      aside={
        filtered ? (
          <button type="button" onClick={() => onSelect(null)} className="text-xs font-semibold text-brand-700 hover:underline">
            Show all
          </button>
        ) : undefined
      }
      bodyClassName="pt-3"
      footer={
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold text-ink">Total across all accounts</span>
          <span className="tabular font-bold text-ink">{money(total)}</span>
        </div>
      }
    >
      <ul className="space-y-1">
        {accounts.map((a) => {
          const active = selected.has(a.id);
          const stale = a.connectionStatus === 'RECONNECT_REQUIRED';
          return (
            <li key={a.id}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onSelect(active && selected.size === 1 ? null : [a.id])}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-surface',
                  active && 'bg-brand-50/70 ring-1 ring-inset ring-brand-100 hover:bg-brand-50',
                )}
              >
                <InstitutionMark id={a.institutionId} name={a.institutionName} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink" title={`${a.name} · ${accountTypeLabel(a.type)}`}>
                    {a.name}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
                    <span className="truncate">
                      {a.institutionName}
                      {a.mask ? ` · •••• ${a.mask}` : ''}
                    </span>
                    <span aria-hidden="true">·</span>
                    {stale ? (
                      <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-danger-600">
                        <Unplug className="size-3" aria-hidden="true" />
                        Reconnect required
                      </span>
                    ) : (
                      <span className="inline-flex shrink-0 items-center gap-1">
                        <span className="size-1.5 rounded-full bg-positive-500" aria-hidden="true" />
                        Synced {relativeTime(a.lastSyncedAt)}
                      </span>
                    )}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="tabular block text-sm font-semibold text-ink">{money(a.bookBalance, { cents: true })}</span>
                  {a.availableBalance !== a.bookBalance && <span className="tabular block text-xs text-ink-muted">Available {money(a.availableBalance)}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
