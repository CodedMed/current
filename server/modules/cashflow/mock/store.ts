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
import { notFound } from '../../../lib/errors.ts';
import type { CashflowStore } from '../store.ts';
import { buildDashboard } from './analytics.ts';
import { generateLedger, type Ledger } from './ledger.ts';
import {
  buildManualTransaction,
  findLedgerTransaction,
  insertLedgerTransaction,
  listLedgerTransactions,
  patchLedgerTransaction,
  validateNewTransaction,
  type ListOptions,
} from './ledgerOps.ts';
import { applyForLoan, buildLoanOffers, toggleSavedOffer } from './lending.ts';
import { PROFILES, findProfile } from './profiles.ts';
import { assessReviews, decideReview } from './review.ts';

export type { ListOptions } from './ledgerOps.ts';

/**
 * In-memory home for the mock ledgers. Each signed-in user gets their own copy
 * per company, so edits made while exploring never leak between sessions.
 * Ledgers are regenerated when the calendar day changes.
 */
export class MockCashflowStore implements CashflowStore {
  readonly source = 'mock' as const;
  readonly #ledgers = new Map<string, Ledger>();

  companies(_userId?: string): CashflowCompany[] {
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
    return listLedgerTransactions(this.ledger(userId, companyId), options);
  }

  getTransaction(userId: string, companyId: string, id: string): CashTransaction {
    return findLedgerTransaction(this.ledger(userId, companyId), id);
  }

  addTransaction(userId: string, companyId: string, input: NewTransactionInput): CashTransaction {
    const ledger = this.ledger(userId, companyId);
    const account = validateNewTransaction(ledger, input);
    const id = `txn_${companyId}_m${String(ledger.nextId).padStart(4, '0')}`;
    ledger.nextId += 1;
    const txn = buildManualTransaction(id, input);
    insertLedgerTransaction(ledger, account, txn);
    return txn;
  }

  updateTransaction(userId: string, companyId: string, id: string, patch: UpdateTransactionInput): CashTransaction {
    return patchLedgerTransaction(this.ledger(userId, companyId), id, patch);
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
