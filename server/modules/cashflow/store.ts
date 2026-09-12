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
} from '../../../shared/types.ts';
import type { ListOptions } from './mock/ledgerOps.ts';

type MaybeAsync<T> = T | Promise<T>;

/**
 * What the cash-flow routes need from a data source. The Nessie-backed store
 * is asynchronous (it talks to the banking API); the generated mock store is
 * synchronous. Routes always `await`, so both satisfy this shape.
 */
export interface CashflowStore {
  readonly source: 'nessie' | 'mock';
  companies(userId: string): MaybeAsync<CashflowCompany[]>;
  dashboard(userId: string, filters: CashflowFilters): MaybeAsync<CashflowDashboard>;
  listTransactions(userId: string, companyId: string, options: ListOptions): MaybeAsync<TransactionListResponse>;
  getTransaction(userId: string, companyId: string, id: string): MaybeAsync<CashTransaction>;
  addTransaction(userId: string, companyId: string, input: NewTransactionInput): MaybeAsync<CashTransaction>;
  updateTransaction(userId: string, companyId: string, id: string, patch: UpdateTransactionInput): MaybeAsync<CashTransaction>;
  decideReview(userId: string, companyId: string, id: string, decision: ReviewDecision, note: string | null): MaybeAsync<CashTransaction>;
  loanOffers(userId: string, companyId: string): MaybeAsync<LoanOffersResponse>;
  applyForLoan(userId: string, companyId: string, offerId: string, amount: number): MaybeAsync<LoanOffer>;
  toggleSavedOffer(userId: string, companyId: string, offerId: string): MaybeAsync<LoanOffer>;
  sync(userId: string, companyId: string): MaybeAsync<SyncResponse>;
}
