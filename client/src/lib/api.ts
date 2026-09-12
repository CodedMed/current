import type {
  ApiErrorBody,
  BusinessTypeId,
  DashboardResponse,
  FeatureId,
  IdentitySessionResponse,
  IdentityStatusResponse,
  OnboardingCatalog,
  ProvisionStatus,
  SandboxIdentityOutcome,
  SessionResponse,
} from '../../../shared/types.ts';

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
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
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

  dashboard: (refresh = false) => request<DashboardResponse>(`/api/dashboard${refresh ? '?refresh=1' : ''}`),
};
