import type { CashTransaction, ReviewDecision, ReviewHistoryPoint, ReviewQueue, ReviewQueueItem, TransactionReview } from '../../../../shared/types.ts';
import { addDays, daysBetween, isoDate, parseIsoDate } from '../../../lib/dates.ts';
import { badRequest, notFound } from '../../../lib/errors.ts';
import type { Ledger } from './ledger.ts';
import { CATEGORY_NAME } from './profiles.ts';

/** Only charges this recent are assessed; older history just feeds baselines. */
const REVIEW_WINDOW_DAYS = 90;
/** How many prior charges make up a vendor baseline. */
const BASELINE_SIZE = 8;
const MIN_SAMPLE = 3;
const DUPLICATE_WINDOW_DAYS = 3;
/** Spend that varies by nature (trips, supplies) is not a "bill" and is never flagged for size. */
const VARIABLE_CATEGORIES = new Set(['travel', 'other_expenses']);

const round2 = (n: number) => Math.round(n * 100) / 100;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
}

function isActivity(t: CashTransaction): boolean {
  return t.direction === 'OUTFLOW' && (t.status === 'POSTED' || t.status === 'PENDING');
}

/** A vendor can send more than one kind of bill (e.g. monthly sales tax and quarterly estimates), so baselines are per vendor and category. */
function baselineKey(t: CashTransaction): string {
  return `${t.merchant}|${t.categoryId}`;
}

/**
 * Compares each recent vendor charge with what that vendor usually bills. The
 * tolerance comes from the vendor's own variability (a robust standard
 * deviation from the median), with a floor so steady bills like rent are held
 * to a tight band and noisy ones like ads are not flagged for normal swings.
 * Decisions already made by the team are never overwritten.
 */
export function assessReviews(ledger: Ledger, now: Date = new Date()): void {
  const today = parseIsoDate(ledger.today);
  const windowStart = isoDate(addDays(today, -REVIEW_WINDOW_DAYS));
  const byMerchant = new Map<string, CashTransaction[]>();
  for (const t of ledger.transactions) {
    if (!isActivity(t) || VARIABLE_CATEGORIES.has(t.categoryId)) continue;
    const list = byMerchant.get(baselineKey(t)) ?? [];
    list.push(t);
    byMerchant.set(baselineKey(t), list);
  }

  for (const list of byMerchant.values()) {
    list.sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1));
    for (let i = 0; i < list.length; i++) {
      const t = list[i] as CashTransaction;
      if (t.date < windowStart) continue;
      if (t.review && t.review.status !== 'open') continue;
      const prior = list.slice(0, i).filter((p) => p.review?.status !== 'disputed' && !(p.review?.status === 'open' && p.review.reason === 'possible_duplicate'));
      const flaggedAt = t.review?.flaggedAt ?? now.toISOString();

      const duplicate = prior.find(
        (p) => daysBetween(parseIsoDate(p.date), parseIsoDate(t.date)) <= DUPLICATE_WINDOW_DAYS && Math.abs(p.amount - t.amount) <= Math.max(1, t.amount * 0.01),
      );
      if (duplicate) {
        t.review = {
          status: 'open',
          reason: 'possible_duplicate',
          expected: duplicate.amount,
          typicalLow: duplicate.amount,
          typicalHigh: duplicate.amount,
          deviation: 0,
          deviationPct: 0,
          sampleSize: prior.length,
          duplicateOf: duplicate.id,
          flaggedAt,
          resolvedAt: null,
          note: null,
        };
        continue;
      }

      const sample = prior.slice(-BASELINE_SIZE).map((p) => p.amount);
      if (sample.length < MIN_SAMPLE) {
        t.review = null;
        continue;
      }
      const expected = median(sample);
      const sigma = 1.4826 * median(sample.map((a) => Math.abs(a - expected)));
      const tolerance = Math.max(3 * sigma, 0.2 * expected, 50);
      const deviation = t.amount - expected;
      if (Math.abs(deviation) > tolerance && Math.abs(deviation) >= 100) {
        t.review = {
          status: 'open',
          reason: deviation > 0 ? 'above_typical' : 'below_typical',
          expected: round2(expected),
          typicalLow: round2(Math.max(0, expected - tolerance)),
          typicalHigh: round2(expected + tolerance),
          deviation: round2(deviation),
          deviationPct: round2((deviation / expected) * 100),
          sampleSize: sample.length,
          duplicateOf: null,
          flaggedAt,
          resolvedAt: null,
          note: null,
        };
      } else {
        t.review = null;
      }
    }
  }
}

export function decideReview(ledger: Ledger, id: string, decision: ReviewDecision, note: string | null, now: Date = new Date()): CashTransaction {
  const txn = ledger.transactions.find((t) => t.id === id);
  if (!txn) throw notFound('No such transaction.');
  if (!txn.review) throw badRequest('This transaction is not flagged for review.');
  const review: TransactionReview = { ...txn.review };
  if (decision === 'reopen') {
    review.status = 'open';
    review.resolvedAt = null;
  } else {
    review.status = decision === 'approve' ? 'approved' : 'disputed';
    review.resolvedAt = now.toISOString();
  }
  review.note = note?.trim() ? note.trim() : review.note;
  txn.review = review;
  // A decision changes the vendor's baseline for later charges.
  assessReviews(ledger, now);
  return txn;
}

export function reviewQueue(ledger: Ledger, txns: CashTransaction[]): ReviewQueue {
  const accountName = new Map(ledger.accounts.map((a) => [a.id, a.name]));
  const flagged = txns.filter((t) => t.review !== null);
  const open = flagged.filter((t) => t.review?.status === 'open').sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const items: ReviewQueueItem[] = open.map((t) => {
    const history: ReviewHistoryPoint[] = ledger.transactions
      .filter((p) => baselineKey(p) === baselineKey(t) && isActivity(p) && (p.date < t.date || (p.date === t.date && p.id < t.id)) && p.review?.status !== 'disputed')
      .slice(-BASELINE_SIZE)
      .map((p) => ({ id: p.id, date: p.date, amount: p.amount }));
    return { transaction: t, accountName: accountName.get(t.accountId) ?? t.accountId, categoryName: CATEGORY_NAME[t.categoryId] ?? t.categoryId, history };
  });
  return {
    open: open.length,
    approved: flagged.filter((t) => t.review?.status === 'approved').length,
    disputed: flagged.filter((t) => t.review?.status === 'disputed').length,
    items,
  };
}
