import connectPgSimple from 'connect-pg-simple';
import session from 'express-session';
import type { AppConfig } from '../config.ts';
import { createLogger } from '../lib/logger.ts';
import { InMemoryOverlayRepository, PostgresOverlayRepository, type OverlayRepository } from '../modules/cashflow/nessie/overlayStore.ts';
import { connectDatabase } from './postgres.ts';
import { PostgresUserRepository } from './postgresUserStore.ts';
import { InMemoryUserRepository, type UserRepository } from './userStore.ts';

const log = createLogger('store');

export interface Persistence {
  mode: 'postgres' | 'memory';
  users: UserRepository;
  overlays: OverlayRepository;
  /** express-session store; `null` keeps the default MemoryStore. */
  sessionStore: session.Store | null;
  close(): Promise<void>;
}

/**
 * Chooses where Express keeps user state. With `DATABASE_URL` set, users,
 * sessions, and dashboard edits live in the `keel` schema of the shared
 * database and survive restarts; without it everything is in memory, the same
 * way the ledger service falls back to an embedded database.
 */
export async function createPersistence(config: AppConfig): Promise<Persistence> {
  if (!config.databaseUrl) {
    return {
      mode: 'memory',
      users: new InMemoryUserRepository(),
      overlays: new InMemoryOverlayRepository(),
      sessionStore: null,
      close: async () => {},
    };
  }

  const pool = await connectDatabase(config.databaseUrl, log);
  const PgStore = connectPgSimple(session);
  const sessionStore = new PgStore({
    pool,
    schemaName: 'keel',
    tableName: 'sessions',
    createTableIfMissing: false, // created with the rest of the schema in connectDatabase()
    pruneSessionInterval: 15 * 60,
  });
  return {
    mode: 'postgres',
    users: new PostgresUserRepository(pool),
    overlays: new PostgresOverlayRepository(pool),
    sessionStore,
    close: async () => {
      sessionStore.close();
      await pool.end();
    },
  };
}
