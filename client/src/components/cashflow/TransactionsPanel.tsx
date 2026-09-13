import { ArrowRight, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { CashAccount, CashCategory, CashTransaction } from '../../../../shared/types.ts';
import { ApiError, api } from '../../lib/api.ts';
import { cn } from '../../lib/cn.ts';
import { money, paymentMethodLabel, shortDate } from '../../lib/format.ts';
import { Badge } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';
import { Spinner } from '../ui/Spinner.tsx';
import { EmptyState, Panel } from './Panel.tsx';

const PAGE = 25;

interface Props {
  companyId: string;
  accountIds: string[] | null;
  recent: CashTransaction[];
  accounts: CashAccount[];
  categories: CashCategory[];
  /** Bumps whenever data changes so an expanded list refetches. */
  version: number;
  onOpen: (txn: CashTransaction) => void;
}

export function TransactionsPanel({ companyId, accountIds, recent, accounts, categories, version, onOpen }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<CashTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const accountName = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);
  const categoryName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  const fetchPage = useCallback(
    async (offset: number, q: string, replace: boolean) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setLoading(true);
      setError(null);
      try {
        const page = await api.cashflow.transactions({ companyId, accountIds, limit: PAGE, offset, query: q || undefined, scope: 'activity' }, controller.signal);
        setItems((prev) => (replace ? page.items : [...prev, ...page.items]));
        setTotal(page.total);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof ApiError ? err.message : 'Could not load transactions.');
      } finally {
        if (abort.current === controller) setLoading(false);
      }
    },
    [companyId, accountIds],
  );

  // Refetch the expanded list when filters, search, or underlying data change.
  useEffect(() => {
    if (!expanded) return;
    const t = window.setTimeout(() => void fetchPage(0, query, true), query ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [expanded, query, version, fetchPage]);

  useEffect(() => () => abort.current?.abort(), []);

  const rows = expanded ? items : recent;
  const subtitle = expanded ? (total > 0 ? `${total.toLocaleString('en-US')} transactions${query ? ' match' : ''}` : 'Search across all accounts') : 'Latest activity across the selected accounts';

  return (
    <Panel
      title={expanded ? 'Transactions' : 'Recent transactions'}
      subtitle={subtitle}
      aside={
        expanded ? (
          <label className="relative block">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search merchant or category"
              aria-label="Search transactions"
              className="h-9 w-56 rounded-lg bg-surface pr-3 pl-8 text-sm text-ink ring-1 ring-inset ring-transparent placeholder:text-ink-muted focus:bg-panel focus:ring-brand-500 focus:outline-hidden"
            />
          </label>
        ) : undefined
      }
      bodyClassName="px-0 pt-2 pb-2 sm:px-0 sm:pb-2"
      footer={
        expanded ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-ink-muted">
              Showing {items.length} of {total}
            </span>
            <div className="flex items-center gap-2">
              {items.length < total && (
                <Button size="sm" variant="secondary" onClick={() => void fetchPage(items.length, query, false)} loading={loading}>
                  Show more
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setExpanded(false);
                  setQuery('');
                }}
              >
                Show recent only
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => setExpanded(true)} iconRight={<ArrowRight className="size-4" aria-hidden="true" />}>
              View all
            </Button>
          </div>
        )
      }
    >
      {error && <p className="mx-5 mb-2 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 sm:mx-6">{error}</p>}
      {rows.length === 0 && !loading ? (
        <div className="px-5 sm:px-6">
          <EmptyState>{expanded && query ? `No transactions match “${query}”.` : 'No transactions yet for the selected accounts.'}</EmptyState>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] table-fixed text-sm">
            <colgroup>
              <col className="w-[112px]" />
              <col />
              <col className="w-[128px]" />
              <col className="hidden w-[172px] xl:table-column" />
              <col className="hidden w-[104px] 2xl:table-column" />
              <col className="w-[128px]" />
            </colgroup>
            <thead className="text-left text-xs font-semibold text-ink-secondary">
              <tr>
                <th scope="col" className="py-2 pr-3 pl-5 sm:pl-6">Date</th>
                <th scope="col" className="py-2 pr-3">Merchant</th>
                <th scope="col" className="py-2 pr-3">Category</th>
                <th scope="col" className="hidden py-2 pr-3 xl:table-cell">Account</th>
                <th scope="col" className="hidden py-2 pr-3 2xl:table-cell">Method</th>
                <th scope="col" className="py-2 pr-5 text-right sm:pr-6">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <Row key={t.id} txn={t} account={accountName.get(t.accountId) ?? t.accountId} category={categoryName.get(t.categoryId) ?? t.categoryId} onOpen={() => onOpen(t)} />
              ))}
            </tbody>
          </table>
          {loading && (
            <div className="flex items-center justify-center gap-2 py-3 text-xs text-ink-muted" role="status">
              <Spinner className="size-4" /> Loading…
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function Row({ txn, account, category, onOpen }: { txn: CashTransaction; account: string; category: string; onOpen: () => void }) {
  const inflow = txn.direction === 'INFLOW';
  const onKeyDown = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen();
    }
  };
  return (
    <tr
      tabIndex={0}
      role="button"
      aria-label={`${txn.merchant}, ${inflow ? 'received' : 'paid'} ${money(txn.amount, { cents: true })} on ${shortDate(txn.date)}. Open details.`}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      className="cursor-pointer border-t border-line transition-colors hover:bg-surface focus:bg-surface focus:outline-hidden"
    >
      <td className="py-2.5 pr-3 pl-5 align-top whitespace-nowrap sm:pl-6">
        <span className="tabular block text-ink-secondary">{shortDate(txn.date)}</span>
        {txn.status === 'PENDING' && (
          <Badge tone="warning" className="mt-1">
            Pending
          </Badge>
        )}
        {txn.status === 'SCHEDULED' && (
          <Badge tone="brand" className="mt-1">
            Scheduled
          </Badge>
        )}
        {txn.review?.status === 'open' && (
          <Badge tone="warning" className="mt-1" title="This charge looks unusual for the vendor">
            Review
          </Badge>
        )}
      </td>
      <td className="py-2.5 pr-3">
        <span className="block truncate font-medium text-ink">{txn.merchant}</span>
        <span className="block truncate text-xs text-ink-muted">{txn.description}</span>
      </td>
      <td className="truncate py-2.5 pr-3 text-ink-secondary">{category}</td>
      <td className="hidden truncate py-2.5 pr-3 text-ink-secondary xl:table-cell">{account}</td>
      <td className="hidden truncate py-2.5 pr-3 text-ink-secondary 2xl:table-cell">{paymentMethodLabel(txn.paymentMethod)}</td>
      <td className={cn('tabular py-2.5 pr-5 text-right font-semibold whitespace-nowrap sm:pr-6', inflow ? 'text-positive-700' : 'text-ink')}>
        {inflow ? '+' : '−'}
        {money(txn.amount, { cents: true })}
      </td>
    </tr>
  );
}
