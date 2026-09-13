import pg from 'pg';
import type { Logger } from '../lib/logger.ts';

/**
 * Express keeps its own tables in the `keel` schema of the same database the
 * ledger service uses (Tiger Data / PostgreSQL). The Java service owns `public.*`
 * through Flyway; nothing here touches those tables. The DDL below is idempotent
 * and runs at startup, so a fresh database needs no separate migration step.
 *
 *   keel.users               sign-in profile, identity decision, onboarding choices, Nessie workspace
 *   keel.workspace_overlays  dashboard state the bank cannot hold: category/note edits, review decisions, financing
 *   keel.sessions            express-session store (connect-pg-simple layout)
 */
const SCHEMA_SQL = `
CREATE SCHEMA IF NOT EXISTS keel;

CREATE TABLE IF NOT EXISTS keel.users (
  id               uuid PRIMARY KEY,
  provider         text NOT NULL,
  provider_subject text NOT NULL,
  email            text NOT NULL,
  name             text NOT NULL,
  given_name       text NOT NULL,
  family_name      text NOT NULL,
  picture          text,
  identity         jsonb NOT NULL,
  onboarding       jsonb NOT NULL,
  workspace        jsonb,
  created_at       timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject)
);
CREATE INDEX IF NOT EXISTS users_identity_inquiry_idx ON keel.users ((identity ->> 'inquiryId'));

CREATE TABLE IF NOT EXISTS keel.workspace_overlays (
  user_id    uuid PRIMARY KEY REFERENCES keel.users (id) ON DELETE CASCADE,
  edits      jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviews    jsonb NOT NULL DEFAULT '{}'::jsonb,
  financing  jsonb NOT NULL DEFAULT '{"applications":{},"saved":[]}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS keel.sessions (
  sid    varchar NOT NULL PRIMARY KEY,
  sess   json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expire_idx ON keel.sessions (expire);
`;

/** Serialises the DDL when several Express processes boot against one database. */
const SCHEMA_LOCK_KEY = 7_324_501;

export type Pool = pg.Pool;

/** Opens the pool and makes sure the `keel` schema exists. Throws when the database is unreachable. */
export async function connectDatabase(connectionString: string, log: Logger): Promise<Pool> {
  const pool = new pg.Pool({ connectionString, max: 10 });
  pool.on('error', (err) => log.error('Database pool error', { message: err.message }));
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK_KEY]);
    try {
      await client.query(SCHEMA_SQL);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
  return pool;
}
