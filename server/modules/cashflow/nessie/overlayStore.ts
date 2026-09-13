import type { TransactionReview, UpdateTransactionInput } from '../../../../shared/types.ts';
import type { Pool } from '../../../store/postgres.ts';
import type { Ledger } from '../mock/ledger.ts';

/**
 * Dashboard state the bank cannot hold, per user: category/note/wording edits
 * and review decisions keyed by transaction id, plus financing applications and
 * saved offers. The Nessie store re-applies these after every fetch.
 */
export interface WorkspaceOverlays {
  edits: Map<string, UpdateTransactionInput>;
  reviews: Map<string, TransactionReview>;
  financing: Ledger['financing'];
}

export interface OverlayRepository {
  /** The user's overlays, or a fresh empty set when none were stored yet. */
  load(userId: string): Promise<WorkspaceOverlays>;
  save(userId: string, overlays: WorkspaceOverlays): Promise<void>;
}

export function emptyOverlays(): WorkspaceOverlays {
  return { edits: new Map(), reviews: new Map(), financing: { applications: {}, saved: [] } };
}

/** What the in-memory Nessie store did before persistence existed: state lives for the process lifetime. */
export class InMemoryOverlayRepository implements OverlayRepository {
  readonly #byUser = new Map<string, WorkspaceOverlays>();

  async load(userId: string): Promise<WorkspaceOverlays> {
    let overlays = this.#byUser.get(userId);
    if (!overlays) {
      overlays = emptyOverlays();
      this.#byUser.set(userId, overlays);
    }
    return overlays;
  }

  async save(userId: string, overlays: WorkspaceOverlays): Promise<void> {
    this.#byUser.set(userId, overlays);
  }
}

interface OverlayRow {
  edits: Record<string, UpdateTransactionInput>;
  reviews: Record<string, TransactionReview>;
  financing: Ledger['financing'];
}

/** One jsonb row per user in `keel.workspace_overlays`; whole-row write-through on every change. */
export class PostgresOverlayRepository implements OverlayRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async load(userId: string): Promise<WorkspaceOverlays> {
    const { rows } = await this.#pool.query<OverlayRow>('SELECT edits, reviews, financing FROM keel.workspace_overlays WHERE user_id = $1', [userId]);
    const row = rows[0];
    if (!row) return emptyOverlays();
    return {
      edits: new Map(Object.entries(row.edits)),
      reviews: new Map(Object.entries(row.reviews)),
      financing: { applications: row.financing.applications ?? {}, saved: row.financing.saved ?? [] },
    };
  }

  async save(userId: string, overlays: WorkspaceOverlays): Promise<void> {
    await this.#pool.query(
      `INSERT INTO keel.workspace_overlays (user_id, edits, reviews, financing)
       VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb)
       ON CONFLICT (user_id) DO UPDATE
          SET edits = EXCLUDED.edits, reviews = EXCLUDED.reviews, financing = EXCLUDED.financing, updated_at = now()`,
      [
        userId,
        JSON.stringify(Object.fromEntries(overlays.edits)),
        JSON.stringify(Object.fromEntries(overlays.reviews)),
        JSON.stringify(overlays.financing),
      ],
    );
  }
}
