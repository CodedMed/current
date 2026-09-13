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
import { forbidden, notFound } from '../../../lib/errors.ts';
import type { UserRecord, UserRepository } from '../../../store/userStore.ts';
import { fetchSnapshot } from '../../nessie/snapshot.ts';
import type { NessieApi, NessieSnapshot } from '../../nessie/types.ts';
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
import type { OverlayRepository, WorkspaceOverlays } from './overlayStore.ts';

/** How long a ledger read from Nessie is reused before it is fetched again. */
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  ledger: Ledger;
  fetchedAt: number;
}

export interface NessieStoreHooks {
  /** Called with every fresh snapshot read from the bank, so other consumers (the ledger service) see the same data. */
  onSnapshot?: (user: UserRecord, snapshot: NessieSnapshot) => void;
  /** After a bank write, refresh downstream forecasts before the caller can ask the advisor. */
  onTransactionAdded?: (user: UserRecord) => Promise<void>;
}

/**
 * Cash-flow store backed by the Nessie banking API. Each user's workspace is
 * one company. Reads come from Nessie; manual entries are written through to
 * Nessie; edits Nessie cannot hold (categories, notes, review decisions,
 * financing state) are kept as per-user overlays in the `OverlayRepository`
 * and re-applied after every fetch.
 */
export class NessieCashflowStore implements CashflowStore {
  readonly source = 'nessie' as const;
  readonly #api: NessieApi;
  readonly #users: UserRepository;
  readonly #overlayStore: OverlayRepository;
  readonly #cache = new Map<string, CacheEntry>();
  /** Overlays loaded once per user per process; every change is written through. */
  readonly #overlays = new Map<string, WorkspaceOverlays>();
  readonly #hooks: NessieStoreHooks;

  constructor(api: NessieApi, users: UserRepository, overlays: OverlayRepository, hooks: NessieStoreHooks = {}) {
    this.#api = api;
    this.#users = users;
    this.#overlayStore = overlays;
    this.#hooks = hooks;
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
    const overlays = await this.#overlaysFor(userId);
    overlays.edits.set(id, { categoryId: input.categoryId, merchant: input.merchant.trim(), description: input.description?.trim() || undefined });
    await this.#overlayStore.save(userId, overlays);
    const txn = buildManualTransaction(id, input);
    insertLedgerTransaction(ledger, account, txn);
    const user = await this.#users.get(userId);
    if (user) await this.#hooks.onTransactionAdded?.(user);
    return txn;
  }

  async updateTransaction(userId: string, companyId: string, id: string, patch: UpdateTransactionInput): Promise<CashTransaction> {
    const ledger = await this.#ledger(userId, companyId);
    const txn = patchLedgerTransaction(ledger, id, patch);
    const overlays = await this.#overlaysFor(userId);
    overlays.edits.set(id, { ...overlays.edits.get(id), ...patch });
    await this.#overlayStore.save(userId, overlays);
    return txn;
  }

  async decideReview(userId: string, companyId: string, id: string, decision: ReviewDecision, note: string | null): Promise<CashTransaction> {
    const ledger = await this.#ledger(userId, companyId);
    const txn = decideReview(ledger, id, decision, note);
    if (txn.review) {
      const overlays = await this.#overlaysFor(userId);
      overlays.reviews.set(id, { ...txn.review });
      await this.#overlayStore.save(userId, overlays);
    }
    return txn;
  }

  async loanOffers(userId: string, companyId: string): Promise<LoanOffersResponse> {
    return buildLoanOffers(await this.#ledger(userId, companyId));
  }

  /** `ledger.financing` is the user's overlay object itself, so the mutation only needs persisting. */
  async applyForLoan(userId: string, companyId: string, offerId: string, amount: number): Promise<LoanOffer> {
    const offer = applyForLoan(await this.#ledger(userId, companyId), offerId, amount);
    await this.#overlayStore.save(userId, await this.#overlaysFor(userId));
    return offer;
  }

  async toggleSavedOffer(userId: string, companyId: string, offerId: string): Promise<LoanOffer> {
    const offer = toggleSavedOffer(await this.#ledger(userId, companyId), offerId);
    await this.#overlayStore.save(userId, await this.#overlaysFor(userId));
    return offer;
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

    const overlays = await this.#overlaysFor(userId);
    const snapshot = await fetchSnapshot(this.#api, workspace);
    this.#hooks.onSnapshot?.(user, snapshot);
    const ledger = ledgerFromSnapshot({
      snapshot,
      workspace,
      user,
      today: startOfToday(),
      now: new Date(),
      overlays,
    });
    this.#cache.set(userId, { ledger, fetchedAt: Date.now() });
    return ledger;
  }

  async #overlaysFor(userId: string): Promise<WorkspaceOverlays> {
    let overlays = this.#overlays.get(userId);
    if (!overlays) {
      overlays = await this.#overlayStore.load(userId);
      this.#overlays.set(userId, overlays);
    }
    return overlays;
  }
}
