import type {
  AccountsSummary,
  AdvisorContext,
  CashEvent,
  CashFlowForecast,
  CopilotDashboard,
  CopilotInvoice,
  CopilotMe,
  CopilotPersonaStatus,
  CopilotTodo,
  CreateTodoInput,
  ExtractedInvoice,
  InvoiceRiskResult,
  ManualCashEventInput,
  NessieSyncResult,
  StoredInvoiceRisk,
  UpdateTodoInput,
} from '../../../shared/copilot.ts';
import type { CopilotConfig } from '../../config.ts';
import { callUpstream, type UpstreamRequest } from './upstream.ts';

export interface LedgerHealth {
  status: string;
  service: string;
  demoMode: boolean;
  time: string;
}

export interface DemoSeedResult {
  seeded: boolean;
  bankEvents: number;
  ledgerEvents: number;
  invoices: number;
  todos: number;
}

/** Ledger-side invoice shape: the browser shape plus the fingerprint the risk engine needs. */
export interface LedgerInvoice extends CopilotInvoice {
  paymentDestinationFingerprint: string | null;
}

function horizonQuery(horizonDays?: number): string {
  return horizonDays ? `?horizonDays=${horizonDays}` : '';
}

/**
 * Typed client for the Java ledger service, the authoritative owner of
 * financial state. Every call carries the internal token and the caller's
 * stable subject; the ledger maps the subject to its own user record.
 */
export class LedgerClient {
  readonly baseUrl: string;
  readonly #token: string;

  constructor(config: CopilotConfig) {
    this.baseUrl = config.ledgerUrl;
    this.#token = config.internalServiceToken;
  }

  #call<T>(subject: string, request: UpstreamRequest): Promise<T> {
    return callUpstream<T>('ledger', this.baseUrl, { 'X-Internal-Service-Token': this.#token, 'X-Auth-Subject': subject }, request);
  }

  /** Unauthenticated liveness check. */
  health(): Promise<LedgerHealth> {
    return callUpstream<LedgerHealth>('ledger', this.baseUrl, {}, { path: '/health', timeoutMs: 5_000 });
  }

  /* ── identity ── */

  me(subject: string): Promise<CopilotMe> {
    return this.#call(subject, { path: '/v1/me' });
  }

  /** Mirrors the verification decision Express obtained from Persona. */
  syncPersonaStatus(subject: string, status: CopilotPersonaStatus, inquiryId: string | null): Promise<CopilotMe> {
    return this.#call(subject, { method: 'POST', path: '/v1/persona/status', json: { status, inquiryId } });
  }

  /** Demo mode only: gives a verified user the seeded demo business, once. */
  seedDemo(subject: string): Promise<DemoSeedResult> {
    return this.#call(subject, { method: 'POST', path: '/v1/demo/seed', timeoutMs: 60_000 });
  }

  /* ── bank data ── */

  syncNessie(subject: string, customerId?: string): Promise<NessieSyncResult> {
    return this.#call(subject, { method: 'POST', path: '/v1/nessie/sync', json: customerId ? { customerId } : {}, timeoutMs: 60_000 });
  }

  accountsSummary(subject: string): Promise<AccountsSummary> {
    return this.#call(subject, { path: '/v1/accounts/summary' });
  }

  /* ── ledger ── */

  cashEvents(subject: string, from?: string, to?: string): Promise<CashEvent[]> {
    const search = new URLSearchParams();
    if (from) search.set('from', from);
    if (to) search.set('to', to);
    const query = search.toString();
    return this.#call(subject, { path: `/v1/cash-events${query ? `?${query}` : ''}` });
  }

  createManualCashEvent(subject: string, input: ManualCashEventInput): Promise<CashEvent> {
    return this.#call(subject, { method: 'POST', path: '/v1/cash-events/manual', json: input });
  }

  forecast(subject: string, horizonDays?: number): Promise<CashFlowForecast> {
    return this.#call(subject, { path: `/v1/forecast${horizonQuery(horizonDays)}` });
  }

  dashboard(subject: string, horizonDays?: number): Promise<CopilotDashboard> {
    return this.#call(subject, { path: `/v1/dashboard${horizonQuery(horizonDays)}` });
  }

  /** The allowlisted facts the reasoning model may see. Never accepted from the browser. */
  advisorContext(subject: string, horizonDays?: number): Promise<AdvisorContext> {
    return this.#call(subject, { path: `/v1/advisor/context${horizonQuery(horizonDays)}` });
  }

  /* ── invoices ── */

  invoices(subject: string): Promise<LedgerInvoice[]> {
    return this.#call(subject, { path: '/v1/invoices' });
  }

  invoice(subject: string, id: string): Promise<LedgerInvoice> {
    return this.#call(subject, { path: `/v1/invoices/${encodeURIComponent(id)}` });
  }

  /** Persists a sanitized extraction; the ledger builds the expected cash event itself. */
  createInvoice(subject: string, extraction: ExtractedInvoice): Promise<LedgerInvoice> {
    return this.#call(subject, { method: 'POST', path: '/v1/invoices', json: extraction });
  }

  storeRiskResult(subject: string, invoiceId: string, risk: InvoiceRiskResult): Promise<StoredInvoiceRisk> {
    return this.#call(subject, { method: 'POST', path: `/v1/invoices/${encodeURIComponent(invoiceId)}/risk-result`, json: risk });
  }

  /* ── tasks ── */

  todos(subject: string): Promise<CopilotTodo[]> {
    return this.#call(subject, { path: '/v1/todos' });
  }

  createTodo(subject: string, input: CreateTodoInput): Promise<CopilotTodo> {
    return this.#call(subject, { method: 'POST', path: '/v1/todos', json: input });
  }

  updateTodo(subject: string, id: string, patch: UpdateTodoInput): Promise<CopilotTodo> {
    return this.#call(subject, { method: 'PATCH', path: `/v1/todos/${encodeURIComponent(id)}`, json: patch });
  }

  deleteTodo(subject: string, id: string): Promise<void> {
    return this.#call(subject, { method: 'DELETE', path: `/v1/todos/${encodeURIComponent(id)}` });
  }
}
