import { randomBytes } from 'node:crypto';
import type { IdentitySessionResponse } from '../../../shared/types.ts';
import type { UserRecord, UserRepository } from '../../store/userStore.ts';
import type { IdentityOutcome, IdentityService } from './types.ts';

const DETAIL = 'Identity verification is bypassed in this build; no Persona inquiry was created.';

/**
 * Temporary stand-in while the Persona calls are switched off: every session
 * start records an approved decision so the flow moves straight to the
 * dashboard. Nothing here talks to Persona.
 */
export class BypassIdentityService implements IdentityService {
  readonly mode = 'sandbox' as const;
  readonly #users: UserRepository;

  constructor(users: UserRepository) {
    this.#users = users;
  }

  async startSession(user: UserRecord): Promise<Omit<IdentitySessionResponse, 'nextStep'>> {
    const inquiryId = user.identity.inquiryId ?? `inq_bypass_${randomBytes(6).toString('hex')}`;
    await this.#users.update(user.id, (u) => {
      u.identity = { mode: 'sandbox', status: 'approved', inquiryId, detail: DETAIL, updatedAt: new Date().toISOString() };
    });
    return { mode: 'sandbox', status: 'approved', inquiryId, sessionToken: null };
  }

  async complete(user: UserRecord): Promise<IdentityOutcome> {
    return this.refresh(user);
  }

  async refresh(user: UserRecord): Promise<IdentityOutcome> {
    return { status: user.identity.status, inquiryId: user.identity.inquiryId, detail: user.identity.detail };
  }
}
