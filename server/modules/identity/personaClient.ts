import type { PersonaConfig } from '../../config.ts';
import { IntegrationError } from '../../lib/errors.ts';
import { requestJson } from '../../lib/http.ts';

/**
 * Minimal typed client for the Persona REST API (JSON:API, kebab-case keys).
 * https://docs.withpersona.com/api-reference
 */

export interface PersonaInquiryAttributes {
  status: string;
  'reference-id'?: string | null;
  'created-at'?: string | null;
  'completed-at'?: string | null;
  'failed-at'?: string | null;
  'expired-at'?: string | null;
  'reviewer-comment'?: string | null;
  note?: string | null;
}

export interface PersonaInquiry {
  id: string;
  type: string;
  attributes: PersonaInquiryAttributes;
}

interface InquiryEnvelope {
  data: PersonaInquiry;
  meta?: { 'session-token'?: string; 'one-time-link'?: string };
}

interface PersonaErrorBody {
  errors?: Array<{ title?: string; details?: string; detail?: string }>;
}

export interface CreateInquiryInput {
  referenceId: string;
  fields: Record<string, string>;
}

export class PersonaClient {
  readonly #config: PersonaConfig;

  constructor(config: PersonaConfig) {
    this.#config = config;
  }

  async createInquiry(input: CreateInquiryInput): Promise<{ inquiry: PersonaInquiry; sessionToken: string | null }> {
    const body = await this.#request<InquiryEnvelope>('POST', '/api/v1/inquiries', {
      data: {
        attributes: {
          'inquiry-template-id': this.#config.templateId,
          'reference-id': input.referenceId,
          fields: input.fields,
        },
      },
      meta: { 'auto-create-inquiry-session': true },
    });
    return { inquiry: body.data, sessionToken: body.meta?.['session-token'] ?? null };
  }

  /** Issues a fresh session token for a `created`/`pending`/`expired` inquiry. */
  async resumeInquiry(inquiryId: string): Promise<{ inquiry: PersonaInquiry; sessionToken: string | null }> {
    const body = await this.#request<InquiryEnvelope>('POST', `/api/v1/inquiries/${encodeURIComponent(inquiryId)}/resume`);
    return { inquiry: body.data, sessionToken: body.meta?.['session-token'] ?? null };
  }

  async getInquiry(inquiryId: string): Promise<PersonaInquiry> {
    const body = await this.#request<InquiryEnvelope>('GET', `/api/v1/inquiries/${encodeURIComponent(inquiryId)}`);
    return body.data;
  }

  async #request<T>(method: 'GET' | 'POST', path: string, payload?: unknown): Promise<T> {
    const url = `${this.#config.baseUrl}${path}`;
    let res;
    try {
      res = await requestJson<T & PersonaErrorBody>(url, {
        method,
        body: payload,
        headers: {
          Authorization: `Bearer ${this.#config.apiKey}`,
          'Persona-Version': this.#config.apiVersion,
          'Key-Inflection': 'kebab',
        },
      });
    } catch (err) {
      throw new IntegrationError('persona', 'Could not reach Persona. Check your network and try again.', null, describe(err));
    }
    if (!res.ok || !res.body) {
      const detail = res.body?.errors?.map((e) => e.details ?? e.detail ?? e.title).filter(Boolean).join('; ');
      const hint =
        res.status === 401
          ? 'Persona rejected the API key.'
          : res.status === 404
            ? 'Persona could not find that inquiry or template.'
            : res.status === 422
              ? 'Persona rejected the inquiry request.'
              : 'Persona returned an unexpected response.';
      throw new IntegrationError('persona', detail ? `${hint} ${detail}` : hint, res.status, res.text.slice(0, 500));
    }
    return res.body;
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
