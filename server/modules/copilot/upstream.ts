import { HttpError } from '../../lib/errors.ts';
import { createLogger } from '../../lib/logger.ts';

/**
 * One fetch helper for both copilot services. Their error envelopes are
 * identical (`{ error: { code, message, retryable? } }`) and are forwarded to
 * the browser unchanged, so a UI can react to `PERSONA_NOT_VERIFIED` or
 * `DOCUMENT_UNSUPPORTED` the same way whichever service raised it.
 */

export type UpstreamService = 'ledger' | 'intelligence';

const log = createLogger('copilot');

/** A well-formed error the service returned; status and code pass straight through. */
export class UpstreamError extends HttpError {
  readonly service: UpstreamService;
  readonly retryable: boolean;

  constructor(service: UpstreamService, status: number, code: string, message: string, retryable = false) {
    super(status, code, message, retryable ? { retryable } : undefined);
    this.name = 'UpstreamError';
    this.service = service;
    this.retryable = retryable;
  }
}

/** The service could not be reached at all. Surfaces as 503 so the client can offer a retry. */
export class UpstreamUnavailable extends HttpError {
  readonly service: UpstreamService;

  constructor(service: UpstreamService, message: string) {
    super(503, `${service.toUpperCase()}_UNAVAILABLE`, message, { retryable: true });
    this.name = 'UpstreamUnavailable';
    this.service = service;
  }
}

export interface UpstreamRequest {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  /** JSON body; sets the content type. */
  json?: unknown;
  /** Raw body (multipart uploads). */
  body?: RequestInit['body'];
  headers?: Record<string, string>;
  timeoutMs?: number;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; retryable?: boolean };
}

export async function callUpstream<T>(
  service: UpstreamService,
  baseUrl: string,
  headers: Record<string, string>,
  request: UpstreamRequest,
): Promise<T> {
  const url = `${baseUrl}${request.path}`;
  const merged: Record<string, string> = { Accept: 'application/json', ...headers, ...request.headers };
  let body: RequestInit['body'] = request.body;
  if (request.json !== undefined) {
    merged['Content-Type'] = 'application/json';
    body = JSON.stringify(request.json);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: request.method ?? 'GET',
      headers: merged,
      body,
      signal: AbortSignal.timeout(request.timeoutMs ?? 30_000),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.warn(`${service} service unreachable`, { url, reason });
    throw new UpstreamUnavailable(
      service,
      service === 'ledger'
        ? 'The ledger service is not reachable. Start it with `npm run dev:ledger`.'
        : 'The intelligence service is not reachable. Start it with `npm run dev:intelligence`.',
    );
  }

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    const envelope = (parsed ?? {}) as ErrorEnvelope;
    const code = envelope.error?.code ?? 'INTERNAL_ERROR';
    const message = envelope.error?.message ?? `The ${service} service returned ${res.status}.`;
    if (res.status >= 500) log.error(`${service} service failed`, { url, status: res.status, code, message });
    throw new UpstreamError(service, res.status, code, message, envelope.error?.retryable ?? false);
  }
  return parsed as T;
}
