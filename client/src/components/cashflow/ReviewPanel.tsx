import { ArrowRight, Check, X } from 'lucide-react';
import { useState } from 'react';
import type { CashTransaction, ReviewDecision, ReviewQueue, ReviewQueueItem } from '../../../../shared/types.ts';
import { cn } from '../../lib/cn.ts';
import { money, shortDate } from '../../lib/format.ts';
import { Badge } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';
import { EmptyState, Panel } from './Panel.tsx';

const SHOW = 5;

interface Props {
  queue: ReviewQueue;
  onDecide: (txn: CashTransaction, decision: ReviewDecision) => Promise<void>;
  onOpen: (txn: CashTransaction) => void;
}

/** Vendor charges that differ from what that vendor usually bills, with the history that makes the call obvious. */
export function ReviewPanel({ queue, onDecide, onOpen }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const shown = queue.items.slice(0, SHOW);
  const rest = queue.open - shown.length;

  const decide = async (txn: CashTransaction, decision: ReviewDecision) => {
    setBusy(`${txn.id}:${decision}`);
    try {
      await onDecide(txn, decision);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel
      id="review"
      title="Bills to review"
      subtitle="Charges that differ from what the vendor usually bills you"
      aside={queue.open > 0 ? <Badge tone="warning">{queue.open} open</Badge> : <Badge tone="success">All clear</Badge>}
      bodyClassName="pt-3"
      footer={
        <p className="text-xs text-ink-muted">
          {queue.approved + queue.disputed > 0
            ? `${queue.approved} confirmed and ${queue.disputed} disputed in the last 90 days. Confirmed bills become the new baseline; disputed ones are left out of it.`
            : 'Every vendor charge is compared with that vendor’s recent bills. Decisions here update the baseline for next time.'}
        </p>
      }
    >
      {shown.length === 0 ? (
        <EmptyState>No unusual bills right now. New charges are checked as they post.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {shown.map((item) => (
            <ReviewRow key={item.transaction.id} item={item} busy={busy} onDecide={decide} onOpen={onOpen} />
          ))}
        </ul>
      )}
      {rest > 0 && (
        <p className="mt-3 text-xs text-ink-muted">
          {rest} more flagged. Open the transaction list to see them all.
        </p>
      )}
    </Panel>
  );
}

function ReviewRow({ item, busy, onDecide, onOpen }: { item: ReviewQueueItem; busy: string | null; onDecide: (txn: CashTransaction, d: ReviewDecision) => Promise<void>; onOpen: (txn: CashTransaction) => void }) {
  const txn = item.transaction;
  const review = txn.review;
  if (!review) return null;
  const duplicate = review.reason === 'possible_duplicate';
  const matched = duplicate ? item.history.find((h) => h.id === review.duplicateOf) : undefined;
  return (
    <li className="rounded-xl p-3.5 ring-1 ring-line">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
            {txn.merchant}
            {duplicate ? (
              <Badge tone="danger">Possible duplicate</Badge>
            ) : (
              <Badge tone="warning">
                {review.deviation > 0 ? '+' : '−'}
                {Math.abs(Math.round(review.deviationPct))}% {review.deviation > 0 ? 'above' : 'below'} usual
              </Badge>
            )}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {txn.description} · {shortDate(txn.date)} · {item.accountName}
            {txn.status === 'PENDING' ? ' · pending' : ''}
          </p>
        </div>
        <div className="text-right">
          <p className="tabular text-base font-bold text-ink">{money(txn.amount, { cents: true })}</p>
          <p className="tabular text-xs text-ink-muted">{duplicate ? `matches ${matched ? shortDate(matched.date) : 'an earlier charge'}` : `usually ${money(review.expected)}`}</p>
        </div>
      </div>

      <HistoryStrip item={item} />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => void onDecide(txn, 'approve')} loading={busy === `${txn.id}:approve`} disabled={busy !== null && busy !== `${txn.id}:approve`} icon={<Check className="size-4" aria-hidden="true" />}>
          Looks right
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void onDecide(txn, 'dispute')} loading={busy === `${txn.id}:dispute`} disabled={busy !== null && busy !== `${txn.id}:dispute`} icon={<X className="size-4" aria-hidden="true" />}>
          Dispute
        </Button>
        <button type="button" onClick={() => onOpen(txn)} className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline">
          Details <ArrowRight className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

/** The vendor's recent bills as small bars, the flagged one last, with the usual amount as a rule. */
function HistoryStrip({ item }: { item: ReviewQueueItem }) {
  const txn = item.transaction;
  const review = txn.review;
  if (!review) return null;
  const bars = [...item.history.map((h) => ({ id: h.id, date: h.date, amount: h.amount, current: false })), { id: txn.id, date: txn.date, amount: txn.amount, current: true }];
  const max = Math.max(1, ...bars.map((b) => b.amount), review.expected);
  const expectedPct = (review.expected / max) * 100;
  return (
    <div className="mt-3">
      <div className="relative h-11" role="img" aria-label={`Last ${item.history.length} bills from ${txn.merchant} compared with this one`}>
        <div className="absolute inset-0 flex items-end gap-1">
          {bars.map((b) => (
            <span
              key={b.id}
              title={`${shortDate(b.date)} · ${money(b.amount, { cents: true })}`}
              className={cn('block min-w-2 flex-1 rounded-t-[3px] transition-[height]', b.current ? (review.reason === 'possible_duplicate' ? 'bg-danger-500' : 'bg-warning-500') : 'bg-line-strong')}
              style={{ height: `${Math.max(4, (b.amount / max) * 100)}%` }}
            />
          ))}
        </div>
        <span className="pointer-events-none absolute right-0 left-0 border-t border-dashed border-ink/40" style={{ bottom: `${expectedPct}%` }} aria-hidden="true" />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-ink-muted">
        <span>
          {item.history.length > 0 ? `Last ${item.history.length} bill${item.history.length === 1 ? '' : 's'}` : 'No prior bills'}
        </span>
        <span>
          Usual {money(review.expected)}
          {!review.duplicateOf && review.typicalLow !== review.typicalHigh ? ` · normal range ${money(review.typicalLow)}–${money(review.typicalHigh)}` : ''}
        </span>
      </div>
    </div>
  );
}
