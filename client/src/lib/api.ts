import type {
  ApiErrorBody,
  BusinessTypeId,
  CashTransaction,
  CashflowCompany,
  CashflowDashboard,
  CashflowFilters,
  DashboardResponse,
  FeatureId,
  LoanOffer,
  LoanOffersResponse,
  NewTransactionInput,
  ReviewDecision,
  SyncResponse,
  TransactionListResponse,
  UpdateTransactionInput,
  IdentitySessionResponse,
  IdentityStatusResponse,
  OnboardingCatalog,
  ProvisionStatus,
  SandboxIdentityOutcome,
  SessionResponse,
} from '../../../shared/types.ts';
import type {
  AccountsSummary,
  AdvisorLanguage,
  AdvisorReply,
  AdvisorTurn,
  CashEvent,
  CashFlowForecast,
  CopilotDashboard,
  CopilotHealth,
  CopilotInvoice,
  CopilotMe,
  CopilotTodo,
  CreateTodoInput,
  DocumentUploadEvent,
  DocumentUploadStage,
  InvoiceRiskResult,
  ManualCashEventInput,
  RiskBackfillResult,
  TranslateResponse,
  NessieSyncResult,
  SavedDocumentResult,
  UpdateTodoInput,
  VoiceSession,
} from '../../../shared/copilot.ts';

export interface TransactionListParams {
  companyId: string;
  accountIds: string[] | null;
  limit?: number;
  offset?: number;
  query?: string;
  scope?: 'activity' | 'scheduled' | 'all';
}

function toQuery(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** True when a retry is a sensible next action (network / upstream problems). */
  get retryable(): boolean {
    return this.status === 0 || this.status === 502 || this.status === 503 || this.status >= 500;
  }
}

export const UNAUTHENTICATED_EVENT = 'keel:unauthenticated';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: options.method ?? 'GET',
      headers: options.body !== undefined ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      credentials: 'same-origin',
      signal: options.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'network', 'We could not reach current.surf. Check your connection and try again.');
  }

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (!res.ok) {
    const body = json as ApiErrorBody | null;
    const code = body?.error?.code ?? 'http_error';
    const message = body?.error?.message ?? `Request failed (${res.status}).`;
    if (res.status === 401) window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT));
    throw new ApiError(res.status, code, message, body?.error?.details);
  }
  return json as T;
}

/**
 * Uploads a document to the copilot backend and reports each stage as the
 * server reaches it (extracting locally → validating → scoring → saved).
 * Resolves once the invoice is in the ledger; rejects with an ApiError otherwise.
 */
export async function uploadCopilotDocument(file: File, onStage?: (stage: DocumentUploadStage) => void): Promise<SavedDocumentResult> {
  const form = new FormData();
  form.append('file', file);
  onStage?.('uploading');
  let res: Response;
  try {
    res = await fetch('/api/copilot/documents', { method: 'POST', body: form, headers: { Accept: 'application/x-ndjson' }, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network', 'We could not reach current.surf. Check your connection and try again.');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    if (res.status === 401) window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT));
    throw new ApiError(res.status, body?.error?.code ?? 'http_error', body?.error?.message ?? `Upload failed (${res.status}).`, body?.error?.details);
  }
  if (!res.body) throw new ApiError(0, 'network', 'Upload status is unavailable.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  const receive = (line: string): SavedDocumentResult | null => {
    if (!line.trim()) return null;
    let event: DocumentUploadEvent;
    try {
      event = JSON.parse(line) as DocumentUploadEvent;
    } catch {
      throw new ApiError(0, 'interrupted', 'Upload status could not be read. Check your invoices before uploading again.');
    }
    if (event.stage === 'error') throw new ApiError(422, event.error.code, event.error.message);
    if (event.stage === 'saved') {
      onStage?.('saved');
      return event.result;
    }
    onStage?.(event.stage);
    return null;
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let newline: number;
      while ((newline = pending.indexOf('\n')) !== -1) {
        const result = receive(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        if (result) return result;
      }
      if (done) {
        const result = receive(pending);
        if (result) return result;
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  throw new ApiError(0, 'interrupted', 'The connection was interrupted. Check your invoices before uploading again.');
}

/* Typed endpoints — the only place the client knows URL shapes. */
export const api = {
  session: (signal?: AbortSignal) => request<SessionResponse>('/api/session', { signal }),
  logout: () => request<SessionResponse>('/api/auth/logout', { method: 'POST' }),

  /** Interface translation. Open to signed-out visitors so sign-up and verification translate too. */
  i18n: {
    translate: (language: AdvisorLanguage, strings: string[], signal?: AbortSignal) =>
      request<TranslateResponse>('/api/i18n/translate', { method: 'POST', body: { language, strings }, signal }),
  },

  identity: {
    start: () => request<IdentitySessionResponse>('/api/identity/session', { method: 'POST' }),
    complete: (inquiryId: string) => request<IdentityStatusResponse>('/api/identity/complete', { method: 'POST', body: { inquiryId } }),
    status: () => request<IdentityStatusResponse>('/api/identity/status'),
    simulate: (outcome: SandboxIdentityOutcome) =>
      request<IdentityStatusResponse>('/api/identity/sandbox/decision', { method: 'POST', body: { outcome } }),
  },

  onboarding: {
    catalog: () => request<OnboardingCatalog & { recommended: FeatureId[] }>('/api/onboarding/catalog'),
    setBusinessType: (businessType: BusinessTypeId) =>
      request<SessionResponse>('/api/onboarding/business-type', { method: 'PUT', body: { businessType } }),
    setFeatures: (features: FeatureId[]) => request<SessionResponse>('/api/onboarding/features', { method: 'PUT', body: { features } }),
    provision: () => request<ProvisionStatus>('/api/onboarding/provision', { method: 'POST' }),
    provisionStatus: () => request<ProvisionStatus>('/api/onboarding/provision/status'),
  },

  /** Nessie-backed dashboard (parked; the route is not mounted while the mock API is in use). */
  dashboard: (refresh = false) => request<DashboardResponse>(`/api/dashboard${refresh ? '?refresh=1' : ''}`),

  cashflow: {
    companies: () => request<{ companies: CashflowCompany[] }>('/api/cashflow/companies'),
    dashboard: (filters: CashflowFilters, signal?: AbortSignal) =>
      request<CashflowDashboard>(
        `/api/cashflow/dashboard${toQuery({
          company: filters.companyId,
          accounts: filters.accountIds?.join(',') ?? null,
          period: filters.period,
          horizon: filters.horizon,
          scenario: filters.scenario,
        })}`,
        { signal },
      ),
    transactions: (params: TransactionListParams, signal?: AbortSignal) =>
      request<TransactionListResponse>(
        `/api/cashflow/transactions${toQuery({
          company: params.companyId,
          accounts: params.accountIds?.join(',') ?? null,
          limit: params.limit,
          offset: params.offset,
          q: params.query,
          scope: params.scope,
        })}`,
        { signal },
      ),
    transaction: (companyId: string, id: string) => request<CashTransaction>(`/api/cashflow/transactions/${encodeURIComponent(id)}${toQuery({ company: companyId })}`),
    addTransaction: (companyId: string, input: NewTransactionInput) =>
      request<CashTransaction>('/api/cashflow/transactions', { method: 'POST', body: { companyId, ...input } }),
    updateTransaction: (companyId: string, id: string, patch: UpdateTransactionInput) =>
      request<CashTransaction>(`/api/cashflow/transactions/${encodeURIComponent(id)}`, { method: 'PATCH', body: { companyId, ...patch } }),
    sync: (companyId: string) => request<SyncResponse>('/api/cashflow/sync', { method: 'POST', body: { companyId } }),
    reviews: {
      decide: (companyId: string, id: string, decision: ReviewDecision, note?: string | null) =>
        request<CashTransaction>(`/api/cashflow/transactions/${encodeURIComponent(id)}/review`, { method: 'POST', body: { companyId, decision, note: note ?? null } }),
    },
    loans: {
      offers: (companyId: string, signal?: AbortSignal) => request<LoanOffersResponse>(`/api/cashflow/loan-offers${toQuery({ company: companyId })}`, { signal }),
      apply: (companyId: string, offerId: string, amount: number) =>
        request<LoanOffer>(`/api/cashflow/loan-offers/${encodeURIComponent(offerId)}/apply`, { method: 'POST', body: { companyId, amount } }),
      save: (companyId: string, offerId: string) => request<LoanOffer>(`/api/cashflow/loan-offers/${encodeURIComponent(offerId)}/save`, { method: 'POST', body: { companyId } }),
    },
  },

  /**
   * Cash Flow Copilot backend (Java ledger + Python intelligence) behind the
   * Express BFF. Every call requires a verified identity; the browser never
   * talks to the services directly.
   */
  copilot: {
    health: () => request<CopilotHealth>('/api/copilot/health'),
    me: () => request<CopilotMe>('/api/copilot/me'),

    dashboard: (horizonDays?: number, signal?: AbortSignal) => request<CopilotDashboard>(`/api/copilot/dashboard${toQuery({ horizonDays })}`, { signal }),
    forecast: (horizonDays?: number, signal?: AbortSignal) => request<CashFlowForecast>(`/api/copilot/forecast${toQuery({ horizonDays })}`, { signal }),
    syncNessie: () => request<NessieSyncResult>('/api/copilot/nessie/sync', { method: 'POST' }),
    accountsSummary: () => request<AccountsSummary>('/api/copilot/accounts/summary'),
    cashEvents: (from?: string, to?: string) => request<CashEvent[]>(`/api/copilot/cash-events${toQuery({ from, to })}`),
    addManualCashEvent: (input: ManualCashEventInput) => request<CashEvent>('/api/copilot/cash-events/manual', { method: 'POST', body: input }),

    invoices: (signal?: AbortSignal) => request<CopilotInvoice[]>('/api/copilot/invoices', { signal }),
    invoice: (id: string) => request<CopilotInvoice>(`/api/copilot/invoices/${encodeURIComponent(id)}`),
    /** Scores the invoice against its vendor history and stores the result. */
    scoreInvoice: (id: string) => request<InvoiceRiskResult>(`/api/copilot/invoices/${encodeURIComponent(id)}/risk`, { method: 'POST' }),
    /** Scores every invoice that has never been scored, so risk checking is not a per-row chore. */
    backfillRisk: (signal?: AbortSignal) => request<RiskBackfillResult>('/api/copilot/invoices/risk/backfill', { method: 'POST', signal }),
    uploadDocument: uploadCopilotDocument,

    /** Text advisor. The financial context is fetched server-side; only the question and prior turns travel. */
    ask: (message: string, language: AdvisorLanguage = 'en', history: AdvisorTurn[] = [], signal?: AbortSignal) =>
      request<AdvisorReply>('/api/copilot/advisor', { method: 'POST', body: { message, language, history }, signal }),
    voice: {
      session: (language: AdvisorLanguage = 'en') => request<VoiceSession>('/api/copilot/voice/session', { method: 'POST', body: { language } }),
      /** A spoken turn: called from the ElevenLabs client tool; runs the same advisor pipeline. */
      message: (message: string, language: AdvisorLanguage = 'en', history: AdvisorTurn[] = []) =>
        request<AdvisorReply>('/api/copilot/voice/message', { method: 'POST', body: { message, language, history } }),
    },

    todos: {
      list: (signal?: AbortSignal) => request<CopilotTodo[]>('/api/copilot/todos', { signal }),
      create: (input: CreateTodoInput) => request<CopilotTodo>('/api/copilot/todos', { method: 'POST', body: input }),
      update: (id: string, patch: UpdateTodoInput) => request<CopilotTodo>(`/api/copilot/todos/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
      remove: (id: string) => request<{ deleted: true }>(`/api/copilot/todos/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    },
  },
};
