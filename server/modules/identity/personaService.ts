import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IdentitySessionResponse, IdentityStatus } from '../../../shared/types.ts';
import { IDENTITY_STATUSES } from '../../../shared/types.ts';
import type { PersonaConfig } from '../../config.ts';
import { badRequest, forbidden } from '../../lib/errors.ts';
import { createLogger } from '../../lib/logger.ts';
import type { UserRecord, UserRepository } from '../../store/userStore.ts';
import { isIdentityVerified } from '../../flow.ts';
import { PersonaClient, type PersonaInquiry } from './personaClient.ts';
import type { IdentityOutcome, IdentityService } from './types.ts';

const log = createLogger('persona');

/** Inquiry statuses from which a session token can be issued and the flow re-opened. */
const RESUMABLE: ReadonlySet<IdentityStatus> = new Set(['created', 'pending', 'expired']);
/** Statuses after which a brand-new inquiry is the only way forward. */
const RETRYABLE: ReadonlySet<IdentityStatus> = new Set(['failed']);

export function toIdentityStatus(raw: string): IdentityStatus {
  return (IDENTITY_STATUSES as readonly string[]).includes(raw) ? (raw as IdentityStatus) : 'pending';
}

function outcomeFromInquiry(inquiry: PersonaInquiry): IdentityOutcome {
  const attrs = inquiry.attributes;
  return {
    status: toIdentityStatus(attrs.status),
    inquiryId: inquiry.id,
    detail: attrs['reviewer-comment'] ?? attrs.note ?? null,
  };
}

/**
 * Live Persona integration. Inquiries are created server-side against the
 * configured KYC/AML template; the browser only receives a short-lived session
 * token. Final status is always re-read from Persona, never trusted from the client.
 */
export class PersonaIdentityService implements IdentityService {
  readonly mode = 'live' as const;
  readonly #client: PersonaClient;
  readonly #config: PersonaConfig;
  readonly #users: UserRepository;
  /** Concurrent session starts for the same user share one request so only one inquiry is created. */
  readonly #starting = new Map<string, Promise<Omit<IdentitySessionResponse, 'nextStep'>>>();

  constructor(config: PersonaConfig, users: UserRepository) {
    this.#config = config;
    this.#client = new PersonaClient(config);
    this.#users = users;
  }

  startSession(user: UserRecord): Promise<Omit<IdentitySessionResponse, 'nextStep'>> {
    const pending = this.#starting.get(user.id);
    if (pending) return pending;
    const run = this.#startSession(user).finally(() => this.#starting.delete(user.id));
    this.#starting.set(user.id, run);
    return run;
  }

  async #startSession(user: UserRecord): Promise<Omit<IdentitySessionResponse, 'nextStep'>> {
    const existingId = user.identity.inquiryId;

    if (existingId) {
      const inquiry = await this.#client.getInquiry(existingId);
      const outcome = outcomeFromInquiry(inquiry);
      await this.#record(user, outcome);

      if (isIdentityVerified(outcome.status, this.#config.acceptCompleted)) {
        return { mode: 'live', status: outcome.status, inquiryId: existingId, sessionToken: null };
      }
      if (RESUMABLE.has(outcome.status)) {
        const resumed = await this.#client.resumeInquiry(existingId);
        return { mode: 'live', status: toIdentityStatus(resumed.inquiry.attributes.status), inquiryId: existingId, sessionToken: resumed.sessionToken };
      }
      if (!RETRYABLE.has(outcome.status)) {
        // declined / needs_review / completed-awaiting-decision: nothing to open.
        return { mode: 'live', status: outcome.status, inquiryId: existingId, sessionToken: null };
      }
      log.info('Previous inquiry failed; creating a new one', { userId: user.id, inquiryId: existingId });
    }

    const created = await this.#client.createInquiry({
      referenceId: user.id,
      fields: {
        'name-first': user.givenName,
        'name-last': user.familyName,
        'email-address': user.email,
      },
    });
    const outcome = outcomeFromInquiry(created.inquiry);
    await this.#record(user, outcome);
    log.info('Created inquiry', { userId: user.id, inquiryId: created.inquiry.id });
    return { mode: 'live', status: outcome.status, inquiryId: created.inquiry.id, sessionToken: created.sessionToken };
  }

  async complete(user: UserRecord, inquiryId: string): Promise<IdentityOutcome> {
    if (user.identity.inquiryId !== inquiryId) {
      // The client may hold a different inquiry than the one last recorded (e.g. two
      // overlapping session starts). Adopt it if Persona confirms it references this user.
      const inquiry = await this.#client.getInquiry(inquiryId);
      if (inquiry.attributes['reference-id'] !== user.id) {
        throw forbidden('That inquiry does not belong to this account.');
      }
      const outcome = outcomeFromInquiry(inquiry);
      await this.#record(user, outcome);
      return outcome;
    }
    return this.refresh(user);
  }

  async refresh(user: UserRecord): Promise<IdentityOutcome> {
    const inquiryId = user.identity.inquiryId;
    if (!inquiryId) return { status: 'not_started', inquiryId: null, detail: null };
    const inquiry = await this.#client.getInquiry(inquiryId);
    const outcome = outcomeFromInquiry(inquiry);
    await this.#record(user, outcome);
    return outcome;
  }

  async handleWebhook(rawBody: Buffer, signatureHeader: string | undefined): Promise<string | null> {
    const secret = this.#config.webhookSecret;
    if (!secret) throw forbidden('Webhook secret is not configured.');
    if (!signatureHeader || !verifyPersonaSignature(rawBody, signatureHeader, secret)) {
      throw forbidden('Invalid webhook signature.');
    }

    let event: WebhookEvent;
    try {
      event = JSON.parse(rawBody.toString('utf8')) as WebhookEvent;
    } catch {
      throw badRequest('Webhook body is not valid JSON.');
    }
    const name = event.data?.attributes?.name ?? '';
    const inquiry = event.data?.attributes?.payload?.data;
    if (!name.startsWith('inquiry.') || !inquiry?.id || !inquiry.attributes?.status) return null;

    const user = await this.#users.findByInquiryId(inquiry.id);
    if (!user) {
      log.warn('Webhook for unknown inquiry', { inquiryId: inquiry.id, event: name });
      return inquiry.id;
    }
    await this.#record(user, outcomeFromInquiry(inquiry as PersonaInquiry));
    log.info('Webhook applied', { inquiryId: inquiry.id, event: name });
    return inquiry.id;
  }

  async #record(user: UserRecord, outcome: IdentityOutcome): Promise<void> {
    await this.#users.update(user.id, (u) => {
      u.identity = {
        mode: 'live',
        status: outcome.status,
        inquiryId: outcome.inquiryId,
        detail: outcome.detail,
        updatedAt: new Date().toISOString(),
      };
    });
  }
}

interface WebhookEvent {
  data?: {
    attributes?: {
      name?: string;
      payload?: { data?: { id?: string; type?: string; attributes?: { status?: string; 'reviewer-comment'?: string | null; note?: string | null } } };
    };
  };
}

/**
 * Persona signs webhooks with `Persona-Signature: t=<unix>,v1=<hex hmac>`.
 * During secret rotation several space-separated pairs may be present.
 */
export function verifyPersonaSignature(rawBody: Buffer, header: string, secret: string): boolean {
  for (const candidate of header.split(' ')) {
    const parts = Object.fromEntries(
      candidate.split(',').map((kv) => {
        const idx = kv.indexOf('=');
        return [kv.slice(0, idx).trim(), kv.slice(idx + 1).trim()];
      }),
    ) as Record<string, string | undefined>;
    const t = parts.t;
    const v1 = parts.v1;
    if (!t || !v1) continue;
    const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(v1, 'utf8');
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}
