import { Router, raw } from 'express';
import { z } from 'zod';
import type { IdentitySessionResponse, IdentityStatusResponse } from '../../../shared/types.ts';
import type { AppConfig } from '../../config.ts';
import { badRequest, notFound } from '../../lib/errors.ts';
import { currentUser, requireUser } from '../../lib/guards.ts';
import { computeNextStep } from '../../flow.ts';
import type { UserRepository } from '../../store/userStore.ts';
import type { IdentityService } from './types.ts';

export interface IdentityRouterDeps {
  config: AppConfig;
  users: UserRepository;
  identity: IdentityService;
}

const completeSchema = z.object({ inquiryId: z.string().min(1) });
const simulateSchema = z.object({ outcome: z.enum(['approved', 'declined', 'needs_review', 'failed']) });

export function createIdentityRouter({ config, users, identity }: IdentityRouterDeps): Router {
  const router = Router();

  const statusResponse = async (userId: string, detail: string | null): Promise<IdentityStatusResponse> => {
    const fresh = await users.get(userId);
    return {
      status: fresh?.identity.status ?? 'not_started',
      inquiryId: fresh?.identity.inquiryId ?? null,
      nextStep: computeNextStep(fresh, config),
      detail,
    };
  };

  /** Create or resume the verification session for the signed-in user. */
  router.post('/session', requireUser, async (_req, res) => {
    const user = currentUser(res);
    const session = await identity.startSession(user);
    const fresh = await users.get(user.id);
    const body: IdentitySessionResponse = { ...session, nextStep: computeNextStep(fresh, config) };
    res.json(body);
  });

  /** The embedded flow finished; confirm the outcome with the provider. */
  router.post('/complete', requireUser, async (req, res) => {
    const user = currentUser(res);
    const parsed = completeSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('inquiryId is required.');
    const outcome = await identity.complete(user, parsed.data.inquiryId);
    res.json(await statusResponse(user.id, outcome.detail));
  });

  /** Poll for a decision (e.g. `completed` → `approved`). */
  router.get('/status', requireUser, async (_req, res) => {
    const user = currentUser(res);
    const outcome = await identity.refresh(user);
    res.json(await statusResponse(user.id, outcome.detail));
  });

  /** Sandbox only: choose the verification outcome explicitly. */
  router.post('/sandbox/decision', requireUser, async (req, res) => {
    if (!identity.simulate) throw notFound('Sandbox decisions are disabled when Persona is configured.');
    const user = currentUser(res);
    const parsed = simulateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('outcome must be approved, declined, needs_review, or failed.');
    const outcome = await identity.simulate(user, parsed.data.outcome);
    res.json(await statusResponse(user.id, outcome.detail));
  });

  return router;
}

/**
 * Webhook receiver. Mounted before the JSON body parser and session middleware
 * because the signature is computed over the raw bytes.
 */
export function createIdentityWebhookRouter(identity: IdentityService): Router {
  const router = Router();
  router.post('/', raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    if (!identity.handleWebhook) throw notFound('Webhooks are only available with a live Persona configuration.');
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const signature = req.header('Persona-Signature');
    const inquiryId = await identity.handleWebhook(body, signature);
    res.json({ received: true, inquiryId });
  });
  return router;
}
