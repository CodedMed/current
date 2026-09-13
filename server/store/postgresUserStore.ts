import { randomUUID } from 'node:crypto';
import type { IntegrationMode } from '../../shared/types.ts';
import type { Pool } from './postgres.ts';
import type { AuthProfile, IdentityState, OnboardingState, UserRecord, UserRepository, WorkspaceState } from './userStore.ts';

const COLUMNS =
  'id, provider, provider_subject, email, name, given_name, family_name, picture, identity, onboarding, workspace, created_at';

interface UserRow {
  id: string;
  provider: 'google';
  provider_subject: string;
  email: string;
  name: string;
  given_name: string;
  family_name: string;
  picture: string | null;
  identity: IdentityState;
  onboarding: OnboardingState;
  workspace: WorkspaceState | null;
  created_at: Date;
}

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    provider: row.provider,
    providerSubject: row.provider_subject,
    email: row.email,
    name: row.name,
    givenName: row.given_name,
    familyName: row.family_name,
    picture: row.picture,
    createdAt: row.created_at.toISOString(),
    identity: row.identity,
    onboarding: row.onboarding,
    workspace: row.workspace,
  };
}

/**
 * `UserRepository` on PostgreSQL (`keel.users`). The nested identity, onboarding
 * and workspace states are stored as jsonb so `UserRecord` stays the single
 * definition of their shape; the scalar profile columns keep the table readable
 * in psql. A returning sign-in is matched on (provider, subject), which is
 * stable for real Google accounts.
 */
export class PostgresUserRepository implements UserRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async get(id: string): Promise<UserRecord | null> {
    return this.#one(`SELECT ${COLUMNS} FROM keel.users WHERE id = $1`, [id]);
  }

  async findByProviderSubject(provider: 'google', subject: string): Promise<UserRecord | null> {
    return this.#one(`SELECT ${COLUMNS} FROM keel.users WHERE provider = $1 AND provider_subject = $2`, [provider, subject]);
  }

  async findByInquiryId(inquiryId: string): Promise<UserRecord | null> {
    return this.#one(`SELECT ${COLUMNS} FROM keel.users WHERE identity ->> 'inquiryId' = $1`, [inquiryId]);
  }

  /** Creates the user on first sign-in; a returning sign-in only refreshes the profile columns. */
  async upsertFromProfile(profile: AuthProfile, identityMode: IntegrationMode): Promise<UserRecord> {
    const identity: IdentityState = { mode: identityMode, status: 'not_started', inquiryId: null, detail: null, updatedAt: null };
    const onboarding: OnboardingState = { businessType: null, features: [], completedAt: null };
    const { rows } = await this.#pool.query<UserRow>(
      `INSERT INTO keel.users (id, provider, provider_subject, email, name, given_name, family_name, picture, identity, onboarding, workspace, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, NULL, $11)
       ON CONFLICT (provider, provider_subject) DO UPDATE
          SET email = EXCLUDED.email,
              name = EXCLUDED.name,
              given_name = EXCLUDED.given_name,
              family_name = EXCLUDED.family_name,
              picture = EXCLUDED.picture,
              updated_at = now()
       RETURNING ${COLUMNS}`,
      [
        randomUUID(),
        profile.provider,
        profile.subject,
        profile.email,
        profile.name,
        profile.givenName,
        profile.familyName,
        profile.picture,
        JSON.stringify(identity),
        JSON.stringify(onboarding),
        new Date(),
      ],
    );
    const row = rows[0];
    if (!row) throw new Error('Upsert returned no row');
    return toRecord(row);
  }

  /** Read-mutate-write under a row lock, so a background provisioner and a request never clobber each other. */
  async update(id: string, mutate: (user: UserRecord) => void): Promise<UserRecord> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<UserRow>(`SELECT ${COLUMNS} FROM keel.users WHERE id = $1 FOR UPDATE`, [id]);
      const row = rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        throw new Error(`User ${id} not found`);
      }
      const user = toRecord(row);
      mutate(user);
      await client.query(
        `UPDATE keel.users
            SET email = $2, name = $3, given_name = $4, family_name = $5, picture = $6,
                identity = $7::jsonb, onboarding = $8::jsonb, workspace = $9::jsonb, updated_at = now()
          WHERE id = $1`,
        [
          id,
          user.email,
          user.name,
          user.givenName,
          user.familyName,
          user.picture,
          JSON.stringify(user.identity),
          JSON.stringify(user.onboarding),
          user.workspace ? JSON.stringify(user.workspace) : null,
        ],
      );
      await client.query('COMMIT');
      return user;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async #one(sql: string, params: unknown[]): Promise<UserRecord | null> {
    const { rows } = await this.#pool.query<UserRow>(sql, params);
    const row = rows[0];
    return row ? toRecord(row) : null;
  }
}
