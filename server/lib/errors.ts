import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiErrorBody } from '../../shared/types.ts';
import { createLogger } from './logger.ts';

const log = createLogger('http');

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type IntegrationName = 'google' | 'persona' | 'nessie';

/** Raised when a third-party API call fails. Surfaces as a 502 so callers can offer a retry. */
export class IntegrationError extends HttpError {
  readonly integration: IntegrationName;
  readonly upstreamStatus: number | null;

  constructor(integration: IntegrationName, message: string, upstreamStatus: number | null = null, details?: unknown) {
    super(502, `${integration}_unavailable`, message, details);
    this.name = 'IntegrationError';
    this.integration = integration;
    this.upstreamStatus = upstreamStatus;
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'bad_request', message, details);
export const unauthenticated = () => new HttpError(401, 'unauthenticated', 'Sign in to continue.');
export const forbidden = (message = 'You cannot do that yet.') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Not found.') => new HttpError(404, 'not_found', message);
export const conflict = (message: string) => new HttpError(409, 'conflict', message);

export const notFoundHandler: RequestHandler = (_req, res) => {
  const body: ApiErrorBody = { error: { code: 'not_found', message: 'No such API route.' } };
  res.status(404).json(body);
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return;

  if (err instanceof HttpError) {
    if (err.status >= 500) log.error(err.message, { code: err.code, path: req.path, details: err.details });
    const body: ApiErrorBody = { error: { code: err.code, message: err.message } };
    if (err.details !== undefined) body.error.details = err.details;
    res.status(err.status).json(body);
    return;
  }

  // Malformed JSON body from express.json()
  if (err && typeof err === 'object' && 'type' in err && (err as { type?: string }).type === 'entity.parse.failed') {
    const body: ApiErrorBody = { error: { code: 'bad_request', message: 'Request body is not valid JSON.' } };
    res.status(400).json(body);
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  log.error('Unhandled error', { path: req.path, message, stack: err instanceof Error ? err.stack : undefined });
  const body: ApiErrorBody = { error: { code: 'internal_error', message: 'Something went wrong on our side.' } };
  res.status(500).json(body);
};
