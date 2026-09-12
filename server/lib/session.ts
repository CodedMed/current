import session from 'express-session';
import type { Request } from 'express';
import type { AppConfig } from '../config.ts';

export const SESSION_COOKIE = 'keel.sid';

/**
 * Cookie-backed sessions. The default MemoryStore is intentional for this demo;
 * swap in a Redis/Postgres store here without touching route code.
 */
export function createSessionMiddleware(config: AppConfig) {
  return session({
    name: SESSION_COOKIE,
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction,
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
