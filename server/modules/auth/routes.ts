import { Router } from 'express';
import type { Request } from 'express';
import { pathForStep } from '../../../shared/flow.ts';
import type { AppConfig } from '../../config.ts';
import { createLogger } from '../../lib/logger.ts';
import { destroySession, regenerateSession, saveSession } from '../../lib/session.ts';
import { computeNextStep, toSessionResponse } from '../../flow.ts';
import type { UserRepository } from '../../store/userStore.ts';
import type { AuthProvider } from './types.ts';

const log = createLogger('auth');
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function queryString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export interface AuthRouterDeps {
  config: AppConfig;
  users: UserRepository;
  provider: AuthProvider;
}

export function createAuthRouter({ config, users, provider }: AuthRouterDeps): Router {
  const router = Router();

  const failRedirect = (reason: string) => `${pathForStep('signup')}?auth_error=${encodeURIComponent(reason)}`;

  /** Step 1: send the browser to Google (or the sandbox stand-in). */
  router.get('/google', async (req, res) => {
    const authorization = await provider.createAuthorization();
    req.session.oauth = {
      state: authorization.state,
      codeVerifier: authorization.codeVerifier,
      createdAt: Date.now(),
    };
    await saveSession(req);
    res.redirect(authorization.url);
  });

  /** Step 2: Google redirects back here with a code; exchange it server-side. */
  router.get('/google/callback', async (req, res) => {
    const pending = req.session.oauth;
    delete req.session.oauth;

    const providerError = queryString(req.query.error);
    if (providerError) {
      log.warn('Provider returned an error', { error: providerError });
      return res.redirect(failRedirect(providerError === 'access_denied' ? 'access_denied' : 'provider_error'));
    }

    const code = queryString(req.query.code);
    const state = queryString(req.query.state);
    if (!pending || !code || !state || pending.state !== state) {
      return res.redirect(failRedirect('state_mismatch'));
    }
    if (Date.now() - pending.createdAt > OAUTH_STATE_TTL_MS) {
      return res.redirect(failRedirect('expired'));
    }

    try {
      const profile = await provider.exchange({ code, state, codeVerifier: pending.codeVerifier });
      const user = await users.upsertFromProfile(profile, config.integrations.persona);
      await regenerateSession(req); // prevent session fixation
      req.session.userId = user.id;
      await saveSession(req);
      log.info('Signed in', { userId: user.id, mode: provider.mode });
      res.redirect(pathForStep(computeNextStep(user, config)));
    } catch (err) {
      log.error('Sign-in failed', { message: err instanceof Error ? err.message : String(err) });
      res.redirect(failRedirect('exchange_failed'));
    }
  });

  router.post('/logout', async (req: Request, res) => {
    await destroySession(req);
    res.clearCookie('keel.sid');
    res.json(toSessionResponse(null, config));
  });

  return router;
}
