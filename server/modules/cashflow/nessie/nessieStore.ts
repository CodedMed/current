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
  TransactionReview,
  UpdateTransactionInput,
} from '../../../../shared/types.ts';
import { isoDate, startOfToday } from '../../../lib/dates.ts';
import { forbidden, notFound } from '../../../lib/errors.ts';
import type { UserRepository } from '../../../store/userStore.ts';
import { fetchSnapshot } from '../../nessie/snapshot.ts';
import type { NessieApi } from '../../nessie/types.ts';
import { buildDashboard } from '../mock/analytics.ts';
import type { Ledger } from '../mock/ledger.ts';
import {
  buildManualTransaction,
  findLedgerTransaction,
  insertLedgerTransaction,
  listLedgerTransactions,
  patchLedgerTransaction,
  validateNewTransaction,
  type ListOptions,
} from '../mock/ledgerOps.ts';
import { applyForLoan, buildLoanOffers, toggleSavedOffer } from '../mock/lending.ts';
import { decideReview } from '../mock/review.ts';
import type { CashflowStore } from '../store.ts';
import { ledgerFromSnapshot } from './nessieLedger.ts';

/** How long a ledger read from Nessie is reused before it is fetched again. */
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  ledger: Ledger;
  fetchedAt: number;
}

/**
 * Cash-flow store backed by the Nessie banking API. Each user's workspace is
 * one company. Reads come from Nessie; manual entries are written through to
 * Nessie; edits Nessie cannot hold (categories, notes, review decisions,
 * financing state) live in memory and are re-applied after every fetch.
 */
export class NessieCashflowStore implements CashflowStore {
  readonly source = 'nessie' as const;
  readonly #api: NessieApi;
  readonly #users: UserRepository;
  readonly #cache = new Map<string, CacheEntry>();
  readonly #edits = new Map<string, Map<string, UpdateTransactionInput>>();
  readonly #reviews = new Map<string, Map<string, TransactionReview>>();

  constructor(api: NessieApi, users: UserRepository) {
    this.#api = api;
    this.#users = users;
  }

  async companies(userId: string): Promise<CashflowCompany[]> {
    const user = await this.#users.get(userId);
    const workspace = user?.workspace;
    if (!user || !workspace) return [];
    return [{ id: workspace.nessieCustomerId, name: workspace.businessName, legalName: workspace.businessName }];
  }

  async dashboard(userId: string, filters: CashflowFilters): Promise<CashflowDashboard> {
    const ledger = await this.#ledger(userId, filters.companyId);
    const dashboard = buildDashboard(ledger, filters, await this.companies(userId));
    return {
      ...dashboard,
      dataSource: {
        provider: 'nessie',
        mode: this.#api.mode,
        label: this.#api.mode === 'live' ? 'Live Nessie data' : 'Nessie sandbox data',
      },
    };
  }

  async listTransactions(userId: string, companyId: string, options: ListOptions): Promise<TransactionListResponse> {
    return listLedgerTransactions(await this.#ledger(userId, companyId), options);
  }

  async getTransaction(userId: string, companyId: string, id: string): Promise<CashTransaction> {
    return findLedgerTransaction(await this.#ledger(userId, companyId), id);
  }

  /** Writes the entry to Nessie first, then mirrors it into the cached ledger. */
  async addTransaction(userId: string, companyId: string, input: NewTransactionInput): Promise<CashTransaction> {
    const ledger = await this.#ledger(userId, companyId);
    const account = validateNewTransaction(ledger, input);
    const description = `${input.description?.trim() || (input.direction === 'INFLOW' ? 'Manual deposit' : 'Manual payment')} · ${input.merchant.trim()}`;
    let id: string;
    if (input.direction === 'INFLOW') {
      const created = await this.#api.createDeposit(account.id, {
        medium: 'balance',
        transaction_date: input.date,
        status: input.status === 'POSTED' ? 'completed' : 'pending',
        amount: input.amount,
        description,
      });
      id = created._id;
    } else if (input.status === 'POSTED') {
      const created = await this.#api.createWithdrawal(account.id, {
        medium: 'balance',
        transaction_date: input.date,
        status: 'completed',
        amount: input.amount,
        description,
      });
      id = created._id;
    } else {
      const created = await this.#api.createBill(account.id, {
        status: 'pending',
        payee: input.merchant.trim(),
        nickname: input.description?.trim() || 'Manual payment',
        payment_date: input.date,
        recurring_date: Number(input.date.slice(8, 10)),
        payment_amount: input.amount,
      });
      id = created._id;
    }
    // Nessie keeps the money movement; the category and wording live here.
    this.#editsFor(userId).set(id, { categoryId: input.categoryId, merchant: input.merchant.trim(), description: input.description?.trim() || undefined });
    const txn = buildManualTransaction(id, input);
    insertLedgerTransaction(ledger, account, txn);
    return txn;
  }

  async updateTransaction(userId: string, companyId: string, id: string, patch: UpdateTransactionInput): Promise<CashTransaction> {
    const ledger = await this.#ledger(userId, companyId);
    const txn = patchLedgerTransaction(ledger, id, patch);
    const edits = this.#editsFor(userId);
    edits.set(id, { ...edits.get(id), ...patch });
    return txn;
  }

  async decideReview(userId: string, companyId: string, id: string, decision: ReviewDecision, note: string | null): Promise<CashTransaction> {
    const ledger = await this.#ledger(userId, companyId);
    const txn = decideReview(ledger, id, decision, note);
    if (txn.review) this.#reviewsFor(userId).set(id, { ...txn.review });
    return txn;
  }

  async loanOffers(userId: string, companyId: string): Promise<LoanOffersResponse> {
    return buildLoanOffers(await this.#ledger(userId, companyId));
  }

  async applyForLoan(userId: string, companyId: string, offerId: string, amount: number): Promise<LoanOffer> {
    return applyForLoan(await this.#ledger(userId, companyId), offerId, amount);
  }

  async toggleSavedOffer(userId: string, companyId: string, offerId: string): Promise<LoanOffer> {
    return toggleSavedOffer(await this.#ledger(userId, companyId), offerId);
  }

  /** Re-reads the workspace from Nessie and reports how many new posted entries arrived. */
  async sync(userId: string, companyId: string): Promise<SyncResponse> {
    const before = await this.#ledger(userId, companyId);
    const known = new Set(before.transactions.filter((t) => t.status === 'POSTED').map((t) => t.id));
    const after = await this.#ledger(userId, companyId, true);
    const postedCount = after.transactions.filter((t) => t.status === 'POSTED' && !known.has(t.id)).length;
    return { syncedAt: after.generatedAt, accounts: after.accounts, postedCount };
  }

  async #ledger(userId: string, companyId: string, refresh = false): Promise<Ledger> {
    const user = await this.#users.get(userId);
    const workspace = user?.workspace;
    if (!user || !workspace) throw forbidden('Set up your workspace before opening the dashboard.');
    if (companyId !== workspace.nessieCustomerId) throw notFound('No such company.');

    const today = isoDate(startOfToday());
    const cached = this.#cache.get(userId);
    if (!refresh && cached && cached.ledger.today === today && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.ledger;

    const snapshot = await fetchSnapshot(this.#api, workspace);
    const ledger = ledgerFromSnapshot({
      snapshot,
      workspace,
      user,
      today: startOfToday(),
      now: new Date(),
      overlays: { edits: this.#edits.get(userId), reviews: this.#reviews.get(userId), financing: cached?.ledger.financing },
    });
    this.#cache.set(userId, { ledger, fetchedAt: Date.now() });
    return ledger;
  }

  #editsFor(userId: string): Map<string, UpdateTransactionInput> {
    let map = this.#edits.get(userId);
    if (!map) {
      map = new Map();
      this.#edits.set(userId, map);
    }
    return map;
  }

  #reviewsFor(userId: string): Map<string, TransactionReview> {
    let map = this.#reviews.get(userId);
    if (!map) {
      map = new Map();
      this.#reviews.set(userId, map);
    }
    return map;
  }
}
