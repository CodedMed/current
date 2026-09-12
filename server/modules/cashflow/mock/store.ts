import type {
  CashTransaction,
  CashflowCompany,
  CashflowDashboard,
  CashflowFilters,
  LoanOffer,
  LoanOffersResponse,
  NewTransactionInput,
  ReviewDecision,
  SyncResponse,
  TransactionListResponse,
  UpdateTransactionInput,
} from '../../../../shared/types.ts';
import { isoDate, startOfToday } from '../../../lib/dates.ts';
import { badRequest, notFound } from '../../../lib/errors.ts';
import { buildDashboard } from './analytics.ts';
import { generateLedger, type Ledger } from './ledger.ts';
import { applyForLoan, buildLoanOffers, toggleSavedOffer } from './lending.ts';
import { CATEGORY_NAME, PROFILES, findProfile } from './profiles.ts';
import { assessReviews, decideReview } from './review.ts';

export interface ListOptions {
  accountIds: string[] | null;
  limit: number;
  offset: number;
  query: string | null;
  scope: 'activity' | 'scheduled' | 'all';
}

/**
 * In-memory home for the mock ledgers. Each signed-in user gets their own copy
 * per company, so edits made while exploring never leak between sessions.
 * Ledgers are regenerated when the calendar day changes.
 */
export class MockCashflowStore {
  readonly #ledgers = new Map<string, Ledger>();

  companies(): CashflowCompany[] {
    return PROFILES.map((p) => ({ id: p.id, name: p.name, legalName: p.legalName }));
  }

  ledger(userId: string, companyId: string): Ledger {
    const profile = findProfile(companyId);
    if (!profile) throw notFound('No such company.');
    const key = `${userId}:${companyId}`;
    const today = isoDate(startOfToday());
    let ledger = this.#ledgers.get(key);
    if (!ledger || ledger.today !== today) {
      ledger = generateLedger(profile, { today: startOfToday(), now: new Date() });
      this.#ledgers.set(key, ledger);
    }
    return ledger;
  }

  dashboard(userId: string, filters: CashflowFilters): CashflowDashboard {
    return buildDashboard(this.ledger(userId, filters.companyId), filters, this.companies());
  }

  listTransactions(userId: string, companyId: string, options: ListOptions): TransactionListResponse {
    const ledger = this.ledger(userId, companyId);
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

  getTransaction(userId: string, companyId: string, id: string): CashTransaction {
    const t = this.ledger(userId, companyId).transactions.find((x) => x.id === id);
    if (!t) throw notFound('No such transaction.');
    return t;
  }

  addTransaction(userId: string, companyId: string, input: NewTransactionInput): CashTransaction {
    const ledger = this.ledger(userId, companyId);
    const account = ledger.accounts.find((a) => a.id === input.accountId);
    if (!account) throw badRequest('Choose one of the connected accounts.');
    if (!ledger.categories.some((c) => c.id === input.categoryId)) throw badRequest('Choose a listed category.');
    const isFuture = input.date > ledger.today;
    if (input.status === 'POSTED' && isFuture) throw badRequest('A posted transaction cannot be dated in the future. Save it as scheduled instead.');
    if (input.status === 'SCHEDULED' && !isFuture) throw badRequest('A scheduled transaction needs a future date.');

    const id = `txn_${companyId}_m${String(ledger.nextId).padStart(4, '0')}`;
    ledger.nextId += 1;
    const amount = Math.round(input.amount * 100) / 100;
    const txn: CashTransaction = {
      id,
      accountId: input.accountId,
      date: input.date,
      postedDate: input.status === 'POSTED' ? input.date : null,
      amount,
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
    if (txn.status === 'POSTED') {
      const sign = txn.direction === 'INFLOW' ? 1 : -1;
      account.bookBalance = Math.round((account.bookBalance + sign * amount) * 100) / 100;
      account.availableBalance = Math.round((account.availableBalance + sign * amount) * 100) / 100;
    }
    const index = ledger.transactions.findIndex((t) => t.date > txn.date);
    if (index === -1) ledger.transactions.push(txn);
    else ledger.transactions.splice(index, 0, txn);
    assessReviews(ledger);
    return txn;
  }

  updateTransaction(userId: string, companyId: string, id: string, patch: UpdateTransactionInput): CashTransaction {
    const ledger = this.ledger(userId, companyId);
    const txn = ledger.transactions.find((t) => t.id === id);
    if (!txn) throw notFound('No such transaction.');
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

  decideReview(userId: string, companyId: string, id: string, decision: ReviewDecision, note: string | null): CashTransaction {
    return decideReview(this.ledger(userId, companyId), id, decision, note);
  }

  loanOffers(userId: string, companyId: string): LoanOffersResponse {
    return buildLoanOffers(this.ledger(userId, companyId));
  }

  applyForLoan(userId: string, companyId: string, offerId: string, amount: number): LoanOffer {
    return applyForLoan(this.ledger(userId, companyId), offerId, amount);
  }

  toggleSavedOffer(userId: string, companyId: string, offerId: string): LoanOffer {
    return toggleSavedOffer(this.ledger(userId, companyId), offerId);
  }

  /** Marks connected accounts as freshly synced and posts pending items that have settled. */
  sync(userId: string, companyId: string): SyncResponse {
    const ledger = this.ledger(userId, companyId);
    const now = new Date();
    const syncedAt = now.toISOString();
    let postedCount = 0;
    for (const t of ledger.transactions) {
      if (t.status !== 'PENDING' || t.date >= ledger.today) continue;
      const account = ledger.accounts.find((a) => a.id === t.accountId);
      if (!account || account.connectionStatus === 'RECONNECT_REQUIRED') continue;
      t.status = 'POSTED';
      t.postedDate = ledger.today;
      if (t.direction === 'OUTFLOW') account.bookBalance = Math.round((account.bookBalance - t.amount) * 100) / 100;
      else {
        account.bookBalance = Math.round((account.bookBalance + t.amount) * 100) / 100;
        account.availableBalance = Math.round((account.availableBalance + t.amount) * 100) / 100;
      }
      postedCount += 1;
    }
    for (const account of ledger.accounts) {
      if (account.connectionStatus === 'RECONNECT_REQUIRED') continue;
      account.connectionStatus = 'CONNECTED';
      account.lastSyncedAt = syncedAt;
    }
    if (postedCount > 0) assessReviews(ledger, now);
    return { syncedAt, accounts: ledger.accounts, postedCount };
  }
}
