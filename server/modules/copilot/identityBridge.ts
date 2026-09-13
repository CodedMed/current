import type { CopilotMe, CopilotPersonaStatus, NessieSyncResult } from '../../../shared/copilot.ts';
import type { IdentityStatus } from '../../../shared/types.ts';
import type { AppConfig } from '../../config.ts';
import { acceptCompletedPolicy, isIdentityVerified } from '../../flow.ts';
import { createLogger } from '../../lib/logger.ts';
import type { UserRecord } from '../../store/userStore.ts';
import type { NessieSnapshot } from '../nessie/types.ts';
import { bankSnapshotKey, toBankSnapshot } from './bankSnapshot.ts';
import type { LedgerClient, LedgerProfile } from './ledgerClient.ts';
import { UpstreamError } from './upstream.ts';

const log = createLogger('copilot');

/** After a failed push, wait this long before the next request tries again. */
const PUSH_RETRY_MS = 30_000;

/** Reads the bank snapshot behind a user's workspace. Null when the dashboard runs on the generated ledger. */
export type WorkspaceSnapshotSource = (user: UserRecord) => Promise<NessieSnapshot>;

export interface IdentityBridgeOptions {
  snapshot?: WorkspaceSnapshotSource | null;
}

/**
 * Keeps the ledger service's view of a user in step with Express.
 *
 * Express owns sign-in, Persona and the Nessie workspace. The ledger only needs the outcome plus
 * who the user is, so before any financial call this bridge (1) mirrors the Persona decision and
 * the sign-in profile, (2) pushes the workspace's bank snapshot so the ledger holds the same
 * business the dashboard shows, and (3) in demo mode seeds what the walkthrough still needs: the
 * whole fixture business for a user without a workspace, only the vendor invoice history for one
 * with. Every step is cached per process and re-done when the ledger turns out to have lost the
 * user (a restart without a database), so a stale cache never becomes a 403 mid-demo.
 */
export class CopilotIdentityBridge {
  readonly #ledger: LedgerClient;
  readonly #config: AppConfig;
  readonly #snapshot: WorkspaceSnapshotSource | null;
  /** Last state mirrored per subject, so a steady state costs no round-trip. */
  readonly #mirrored = new Map<string, string>();
  /** The ledger's user id per subject; a change means the ledger's database was reset. */
  readonly #ledgerUserIds = new Map<string, string>();
  readonly #seeded = new Set<string>();
  readonly #seeding = new Map<string, Promise<void>>();
  /** Fingerprint of the last snapshot pushed per subject. */
  readonly #pushed = new Map<string, string>();
  readonly #pushFailedAt = new Map<string, number>();
  readonly #pushing = new Map<string, Promise<NessieSyncResult | null>>();

  constructor(ledger: LedgerClient, config: AppConfig, options: IdentityBridgeOptions = {}) {
    this.#ledger = ledger;
    this.#config = config;
    this.#snapshot = options.snapshot ?? null;
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

  /** True when this user's bank data is their own workspace rather than the demo fixture. */
  usesWorkspace(user: UserRecord): boolean {
    return Boolean(user.workspace && this.#snapshot);
  }

  /** Mirrors the current decision and profile when either changed since the last mirror. Returns the ledger's view. */
  async mirror(user: UserRecord, force = false): Promise<CopilotMe> {
    const subject = this.subjectFor(user);
    if (!force && this.#mirrored.get(subject) === this.#mirrorKey(user)) {
      const me = await this.#ledger.me(subject);
      if (!this.#ledgerAgrees(subject, me, user)) return this.#send(user);
      return me;
    }
    return this.#send(user);
  }

  /**
   * Prepares a verified user for financial calls: mirrors approval, pushes their bank snapshot
   * once, and in demo mode seeds what is missing. Returns the subject to forward.
   */
  async prepare(user: UserRecord): Promise<string> {
    const subject = this.subjectFor(user);
    await this.#ensureMirrored(user);
    await this.#ensureBankData(user);
    return subject;
  }

  /**
   * Pushes the workspace's bank snapshot to the ledger. Skipped when the same snapshot was already
   * pushed (unless forced); concurrent calls share one push. Returns null when nothing was sent.
   */
  async pushWorkspace(user: UserRecord, options: { snapshot?: NessieSnapshot; force?: boolean } = {}): Promise<NessieSyncResult | null> {
    if (!user.workspace || !this.#snapshot) return null;
    const subject = this.subjectFor(user);
    const inflight = this.#pushing.get(subject);
    if (inflight) {
      if (!options.force) return inflight;
      // A refresh after a bank mutation must not reuse a snapshot read before the mutation.
      // Finish that push first, then read and push the latest bank state.
      await inflight.catch(() => {});
      return this.pushWorkspace(user, options);
    }
    const run = (async () => {
      await this.#ensureMirrored(user);
      const snapshot = options.snapshot ?? (await this.#snapshot!(user));
      const push = toBankSnapshot(user.workspace!, snapshot);
      const key = bankSnapshotKey(push);
      if (!options.force && this.#pushed.get(subject) === key) return null;
      const result = await this.#ledger.pushBankSnapshot(subject, push);
      this.#pushed.set(subject, key);
      this.#pushFailedAt.delete(subject);
      log.info('Pushed bank snapshot to ledger', { subject, inserted: result.insertedEvents, updated: result.updatedEvents });
      return result;
    })().finally(() => this.#pushing.delete(subject));
    this.#pushing.set(subject, run);
    return run;
  }

  /** Forget everything cached for a subject so the next call re-mirrors, re-pushes and re-seeds. */
  invalidate(subject: string): void {
    this.#mirrored.delete(subject);
    this.#ledgerUserIds.delete(subject);
    this.#seeded.delete(subject);
    this.#pushed.delete(subject);
    this.#pushFailedAt.delete(subject);
  }

  async #ensureMirrored(user: UserRecord): Promise<void> {
    const subject = this.subjectFor(user);
    if (this.#mirrored.get(subject) === this.#mirrorKey(user)) {
      // Cheap check that the ledger still holds this user as we last left it.
      const me = await this.#ledger.me(subject);
      if (this.#ledgerAgrees(subject, me, user)) return;
    }
    await this.#send(user);
  }

  async #ensureBankData(user: UserRecord): Promise<void> {
    const subject = this.subjectFor(user);
    const usesWorkspace = this.usesWorkspace(user);
    if (usesWorkspace && !this.#pushed.has(subject)) {
      const failedAt = this.#pushFailedAt.get(subject);
      if (failedAt === undefined || Date.now() - failedAt > PUSH_RETRY_MS) {
        try {
          await this.pushWorkspace(user);
        } catch (err) {
          // The ledger keeps whatever it last had; the copilot must still answer.
          this.#pushFailedAt.set(subject, Date.now());
          log.warn('Bank snapshot push failed; continuing with the ledger\'s last data', { subject, message: err instanceof Error ? err.message : String(err) });
        }
      }
    }
    if (this.#config.copilot.demoMode && this.ledgerStatusFor(user) === 'approved' && !this.#seeded.has(subject)) {
      // Dashboard and forecast load together. Share the seed so both requests cannot
      // observe an empty invoice history and insert the same demo invoices twice.
      let seeding = this.#seeding.get(subject);
      if (!seeding) {
        seeding = (async () => {
          try {
            const result = await this.#ledger.seedDemo(subject, !usesWorkspace);
            if (result.seeded) log.info('Seeded demo data', { subject, bankData: !usesWorkspace, invoices: result.invoices, todos: result.todos });
          } catch (err) {
            if (err instanceof UpstreamError && err.status === 501) {
              log.warn('Ledger service refused demo seeding (DEMO_MODE is off there).', { subject });
            } else {
              throw err;
            }
          }
          this.#seeded.add(subject);
        })().finally(() => this.#seeding.delete(subject));
        this.#seeding.set(subject, seeding);
      }
      await seeding;
    }
  }

  /** The ledger still knows this user under the same id and with the decision we sent. */
  #ledgerAgrees(subject: string, me: CopilotMe, user: UserRecord): boolean {
    const knownId = this.#ledgerUserIds.get(subject);
    const expected = this.ledgerStatusFor(user);
    if ((knownId !== undefined && knownId !== me.userId) || me.personaStatus !== expected) {
      log.warn('Ledger service lost this user (restart without a database?); re-mirroring and re-seeding', { subject });
      this.invalidate(subject);
      return false;
    }
    return true;
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
    this.#ledgerUserIds.set(subject, me.userId);
    log.info('Mirrored identity to ledger', { subject, status });
    return me;
  }
}
