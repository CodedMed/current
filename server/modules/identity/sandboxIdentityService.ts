import { randomBytes } from 'node:crypto';
import type { IdentitySessionResponse, SandboxIdentityOutcome } from '../../../shared/types.ts';
import type { UserRecord, UserRepository } from '../../store/userStore.ts';
import type { IdentityOutcome, IdentityService } from './types.ts';

const DETAILS: Record<SandboxIdentityOutcome, string | null> = {
  approved: null,
  declined: 'Simulated decline: document could not be matched to a live selfie.',
  needs_review: 'Simulated manual review: a watchlist screening returned a possible match.',
  failed: 'Simulated failure: too many document capture attempts.',
};

/**
 * Used only when Persona credentials are absent. Mirrors the live service's
 * state transitions so the client and flow logic behave identically.
 */
export class SandboxIdentityService implements IdentityService {
  readonly mode = 'sandbox' as const;
  readonly #users: UserRepository;

  constructor(users: UserRepository) {
    this.#users = users;
  }

  async startSession(user: UserRecord): Promise<Omit<IdentitySessionResponse, 'nextStep'>> {
    let inquiryId = user.identity.inquiryId;
    let status = user.identity.status;
    if (!inquiryId || status === 'failed') {
      inquiryId = `inq_sandbox_${randomBytes(8).toString('hex')}`;
      // Read the status back from the repository: a database-backed store does not mutate `user` in place.
      const updated = await this.#users.update(user.id, (u) => {
        u.identity = { mode: 'sandbox', status: 'pending', inquiryId, detail: null, updatedAt: new Date().toISOString() };
      });
      status = updated.identity.status;
    }
    return { mode: 'sandbox', status, inquiryId, sessionToken: null };
  }

  async complete(user: UserRecord): Promise<IdentityOutcome> {
    return this.refresh(user);
  }

  async refresh(user: UserRecord): Promise<IdentityOutcome> {
    return { status: user.identity.status, inquiryId: user.identity.inquiryId, detail: user.identity.detail };
  }

  async simulate(user: UserRecord, outcome: SandboxIdentityOutcome): Promise<IdentityOutcome> {
    const detail = DETAILS[outcome];
    await this.#users.update(user.id, (u) => {
      u.identity = {
        mode: 'sandbox',
        status: outcome,
        inquiryId: u.identity.inquiryId,
        detail,
        updatedAt: new Date().toISOString(),
      };
    });
    return { status: outcome, inquiryId: user.identity.inquiryId, detail };
  }
}
