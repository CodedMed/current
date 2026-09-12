import type {
  ApiErrorBody,
  BusinessTypeId,
  CashTransaction,
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
    throw new ApiError(0, 'network', 'We could not reach Keel. Check your connection and try again.');
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

/* Typed endpoints — the only place the client knows URL shapes. */
export const api = {
  session: (signal?: AbortSignal) => request<SessionResponse>('/api/session', { signal }),
  logout: () => request<SessionResponse>('/api/auth/logout', { method: 'POST' }),

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
};
