import type { CopilotMe, CopilotPersonaStatus } from '../../../shared/copilot.ts';
import type { IdentityStatus } from '../../../shared/types.ts';
import type { AppConfig } from '../../config.ts';
import { acceptCompletedPolicy, isIdentityVerified } from '../../flow.ts';
import { createLogger } from '../../lib/logger.ts';
import type { UserRecord } from '../../store/userStore.ts';
import type { LedgerClient, LedgerProfile } from './ledgerClient.ts';
import { UpstreamError } from './upstream.ts';

const log = createLogger('copilot');

/**
 * Keeps the ledger service's view of a user in step with Express.
 *
 * Express owns sign-in and Persona: it creates inquiries, re-reads decisions
 * from Persona server-side, and handles signed webhooks. The ledger service
 * only needs the outcome plus who the user is, so this bridge mirrors the
 * decision and the sign-in profile over the internal channel before any
 * financial call, and in demo mode seeds the demo business for a newly
 * verified user so the walkthrough works without sponsor credentials.
 */
export class CopilotIdentityBridge {
  readonly #ledger: LedgerClient;
  readonly #config: AppConfig;
  /** Last state mirrored per subject, so a steady state costs no round-trip. */
  readonly #mirrored = new Map<string, string>();
  readonly #seeded = new Set<string>();

  constructor(ledger: LedgerClient, config: AppConfig) {
    this.#ledger = ledger;
    this.#config = config;
  }

  /** The stable subject forwarded to both services. Survives restarts, unlike the in-memory user id. */
  subjectFor(user: UserRecord): string {
    return `${user.provider}:${user.providerSubject}`;
  }

  /** Maps Express's identity states onto the ledger's five Persona statuses. */
  ledgerStatusFor(user: UserRecord): CopilotPersonaStatus {
    const status: IdentityStatus = user.identity.status;
    if (isIdentityVerified(status, acceptCompletedPolicy(this.#config))) return 'approved';
    switch (status) {
      case 'declined':
        return 'declined';
      case 'failed':
      case 'expired':
        return 'failed';
      case 'not_started':
        return 'unverified';
      default:
        return 'pending';
    }
  }

  /** Mirrors the current decision and profile when either changed since the last mirror. Returns the ledger's view. */
  async mirror(user: UserRecord, force = false): Promise<CopilotMe> {
    const subject = this.subjectFor(user);
    if (!force && this.#mirrored.get(subject) === this.#mirrorKey(user)) {
      return this.#ledger.me(subject);
    }
    return this.#send(user);
  }

  /**
   * Prepares a verified user for financial calls: mirrors approval, and in demo
   * mode seeds the demo business the first time. Returns the subject to forward.
   */
  async prepare(user: UserRecord): Promise<string> {
    const subject = this.subjectFor(user);
    if (this.#mirrored.get(subject) !== this.#mirrorKey(user)) {
      await this.#send(user);
    }
    if (this.#config.copilot.demoMode && this.ledgerStatusFor(user) === 'approved' && !this.#seeded.has(subject)) {
      try {
        const result = await this.#ledger.seedDemo(subject);
        if (result.seeded) log.info('Seeded demo business', { subject, invoices: result.invoices, todos: result.todos });
      } catch (err) {
        // The ledger may run with DEMO_MODE=false while Express does not; that is not fatal.
        if (err instanceof UpstreamError && err.status === 501) {
          log.warn('Ledger service refused demo seeding (DEMO_MODE is off there).', { subject });
        } else {
          throw err;
        }
      }
      this.#seeded.add(subject);
    }
    return subject;
  }

  /** Forget the cached mirror so the next call re-sends the decision (after a ledger restart, say). */
  invalidate(subject: string): void {
    this.#mirrored.delete(subject);
    this.#seeded.delete(subject);
  }

  #profileFor(user: UserRecord): LedgerProfile {
    return { email: user.email, displayName: user.name };
  }

  /** Everything the ledger is told about a user; a change in any part re-sends. */
  #mirrorKey(user: UserRecord): string {
    return `${this.ledgerStatusFor(user)}|${user.identity.inquiryId ?? ''}|${user.email}|${user.name}`;
  }

  async #send(user: UserRecord): Promise<CopilotMe> {
    const subject = this.subjectFor(user);
    const status = this.ledgerStatusFor(user);
    const me = await this.#ledger.syncPersonaStatus(subject, status, user.identity.inquiryId, this.#profileFor(user));
    this.#mirrored.set(subject, this.#mirrorKey(user));
    log.info('Mirrored identity to ledger', { subject, status });
    return me;
  }
}
