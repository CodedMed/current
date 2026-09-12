import path from 'node:path';
import express from 'express';
import { errorHandler, notFoundHandler } from './lib/errors.ts';
import { attachUser } from './lib/guards.ts';
import { createSessionMiddleware } from './lib/session.ts';
import { toSessionResponse } from './flow.ts';
import { createAuthRouter } from './modules/auth/routes.ts';
// Nessie-backed dashboard, parked while the dashboard runs on mock data.
// import { createDashboardRouter } from './modules/cashflow/routes.ts';
import { createCashflowRouter } from './modules/cashflow/mock/routes.ts';
import { createIdentityRouter, createIdentityWebhookRouter } from './modules/identity/routes.ts';
import { createOnboardingRouter } from './modules/onboarding/routes.ts';
import type { Services } from './services.ts';

export function createApp(services: Services): express.Express {
  const { config, users, auth, identity, provisioner, cashflow } = services;
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  // Webhooks are verified against the raw body, so they are mounted before the JSON parser and sessions.
  app.use('/api/identity/webhook', createIdentityWebhookRouter(identity));

  app.use(express.json({ limit: '100kb' }));
  app.use(createSessionMiddleware(config));
  app.use(attachUser(users));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, integrations: config.integrations });
  });
  app.get('/api/session', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(toSessionResponse(res.locals.user ?? null, config));
  });

  app.use('/api/auth', createAuthRouter({ config, users, provider: auth }));
  app.use('/api/identity', createIdentityRouter({ config, users, identity }));
  app.use('/api/onboarding', createOnboardingRouter({ config, users, provisioner }));
  // app.use('/api/dashboard', createDashboardRouter({ config, nessie: services.nessie }));
  app.use('/api/cashflow', createCashflowRouter({ config, store: cashflow }));
  app.use('/api', notFoundHandler);

  if (config.isProduction) {
    const clientDir = path.resolve(import.meta.dirname, '../dist/client');
    app.use(express.static(clientDir, { index: false, maxAge: '1h' }));
    app.get('/{*splat}', (_req, res) => {
      res.set('Cache-Control', 'no-store');
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
