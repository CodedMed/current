import session from 'express-session';
import type { Request } from 'express';
import type { AppConfig } from '../config.ts';

export const SESSION_COOKIE = 'keel.sid';

/**
 * Cookie-backed sessions. With `DATABASE_URL` set the store is PostgreSQL
 * (`keel.sessions`, see `store/persistence.ts`) so a restart keeps everyone
 * signed in; otherwise the default MemoryStore is used.
 */
export function createSessionMiddleware(config: AppConfig, store?: session.Store) {
  return session({
    name: SESSION_COOKIE,
    secret: config.sessionSecret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // Secure cookies only work over HTTPS; follow the public URL's scheme so a
      // production build served over plain HTTP (local preview, internal demo) still signs in.
      secure: config.appUrl.startsWith('https://'),
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  });
}

export function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

export function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

export function destroySession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => (err ? reject(err) : resolve()));
  });
}
