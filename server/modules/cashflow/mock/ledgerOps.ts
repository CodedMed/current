import type { CashAccount, CashTransaction, NewTransactionInput, TransactionListResponse, UpdateTransactionInput } from '../../../../shared/types.ts';
import { badRequest, notFound } from '../../../lib/errors.ts';
import type { Ledger } from './ledger.ts';
import { CATEGORY_NAME } from './profiles.ts';
import { assessReviews } from './review.ts';

/** Ledger operations shared by every cash-flow data source. */

export interface ListOptions {
  accountIds: string[] | null;
  limit: number;
  offset: number;
  query: string | null;
  scope: 'activity' | 'scheduled' | 'all';
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function listLedgerTransactions(ledger: Ledger, options: ListOptions): TransactionListResponse {
  const wanted = options.accountIds ? new Set(options.accountIds) : null;
  const q = options.query?.trim().toLowerCase() ?? '';
  const matches = ledger.transactions.filter((t) => {
    if (wanted && !wanted.has(t.accountId)) return false;
    if (options.scope === 'activity' && t.status === 'SCHEDULED') return false;
    if (options.scope === 'scheduled' && t.status !== 'SCHEDULED') return false;
    if (q && !`${t.merchant} ${t.description} ${CATEGORY_NAME[t.categoryId] ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const ordered = options.scope === 'scheduled' ? matches : [...matches].reverse();
  return { items: ordered.slice(options.offset, options.offset + options.limit), total: ordered.length };
}

export function findLedgerTransaction(ledger: Ledger, id: string): CashTransaction {
  const t = ledger.transactions.find((x) => x.id === id);
  if (!t) throw notFound('No such transaction.');
  return t;
}

/** Validates a manual entry against the ledger and returns the target account. */
export function validateNewTransaction(ledger: Ledger, input: NewTransactionInput): CashAccount {
  const account = ledger.accounts.find((a) => a.id === input.accountId);
  if (!account) throw badRequest('Choose one of the connected accounts.');
  if (!ledger.categories.some((c) => c.id === input.categoryId)) throw badRequest('Choose a listed category.');
  const isFuture = input.date > ledger.today;
  if (input.status === 'POSTED' && isFuture) throw badRequest('A posted transaction cannot be dated in the future. Save it as scheduled instead.');
  if (input.status === 'SCHEDULED' && !isFuture) throw badRequest('A scheduled transaction needs a future date.');
  return account;
}

export function buildManualTransaction(id: string, input: NewTransactionInput): CashTransaction {
  return {
    id,
    accountId: input.accountId,
    date: input.date,
    postedDate: input.status === 'POSTED' ? input.date : null,
    amount: round2(input.amount),
    direction: input.direction,
    status: input.status,
    paymentMethod: input.paymentMethod,
    merchant: input.merchant,
    description: input.description?.trim() || (input.direction === 'INFLOW' ? 'Manual deposit' : 'Manual payment'),
    categoryId: input.categoryId,
    source: 'MANUAL',
    counterpartyId: null,
    note: null,
    forecast: input.status === 'SCHEDULED' ? { confidence: 1, source: 'MANUAL' } : null,
    review: null,
  };
}

/** Inserts in date order, applies a posted amount to the account, and re-runs the review pass. */
export function insertLedgerTransaction(ledger: Ledger, account: CashAccount, txn: CashTransaction): void {
  if (txn.status === 'POSTED') {
    const sign = txn.direction === 'INFLOW' ? 1 : -1;
    account.bookBalance = round2(account.bookBalance + sign * txn.amount);
    account.availableBalance = round2(account.availableBalance + sign * txn.amount);
  }
  const index = ledger.transactions.findIndex((t) => t.date > txn.date);
  if (index === -1) ledger.transactions.push(txn);
  else ledger.transactions.splice(index, 0, txn);
  assessReviews(ledger);
}

export function patchLedgerTransaction(ledger: Ledger, id: string, patch: UpdateTransactionInput): CashTransaction {
  const txn = findLedgerTransaction(ledger, id);
  if (patch.categoryId !== undefined) {
    if (!ledger.categories.some((c) => c.id === patch.categoryId)) throw badRequest('Choose a listed category.');
    txn.categoryId = patch.categoryId;
  }
  if (patch.note !== undefined) txn.note = patch.note?.trim() ? patch.note.trim() : null;
  if (patch.description !== undefined && patch.description.trim()) txn.description = patch.description.trim();
  if (patch.merchant !== undefined && patch.merchant.trim()) {
    txn.merchant = patch.merchant.trim();
    assessReviews(ledger);
  }
  return txn;
}
