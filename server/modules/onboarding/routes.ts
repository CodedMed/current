import { Router } from 'express';
import { z } from 'zod';
import { BUSINESS_TYPE_IDS, FEATURE_IDS } from '../../../shared/types.ts';
import type { OnboardingCatalog, ProvisionStatus, SessionResponse } from '../../../shared/types.ts';
import type { AppConfig } from '../../config.ts';
import { badRequest, conflict } from '../../lib/errors.ts';
import { currentUser, requireProgress, requireVerified } from '../../lib/guards.ts';
import { computeNextStep, toSessionResponse } from '../../flow.ts';
import type { UserRepository } from '../../store/userStore.ts';
import type { Provisioner } from '../nessie/provisioner.ts';
import { catalog, recommendedFeatures } from './catalog.ts';

export interface OnboardingRouterDeps {
  config: AppConfig;
  users: UserRepository;
  provisioner: Provisioner;
}

const businessTypeSchema = z.object({ businessType: z.enum(BUSINESS_TYPE_IDS) });
const featuresSchema = z.object({
  features: z
    .array(z.enum(FEATURE_IDS))
    .min(1, 'Choose at least one area to manage.')
    .max(FEATURE_IDS.length)
    .refine((list) => new Set(list).size === list.length, 'Features must be unique.'),
});

export function createOnboardingRouter({ config, users, provisioner }: OnboardingRouterDeps): Router {
  const router = Router();
  const verified = requireVerified(config);

  router.get('/catalog', verified, (_req, res) => {
    const user = currentUser(res);
    const body: OnboardingCatalog & { recommended: string[] } = {
      ...catalog,
      recommended: user.onboarding.businessType ? recommendedFeatures(user.onboarding.businessType) : [],
    };
    res.json(body);
  });

  router.put('/business-type', verified, async (req, res) => {
    const user = currentUser(res);
    if (user.workspace) throw conflict('Your workspace is already set up. Business type can no longer change here.');
    const parsed = businessTypeSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Choose one of the listed business types.');
    const updated = await users.update(user.id, (u) => {
      u.onboarding.businessType = parsed.data.businessType;
    });
    const body: SessionResponse = toSessionResponse(updated, config);
    res.json(body);
  });

  router.put('/features', requireProgress(config, 'features'), async (req, res) => {
    const user = currentUser(res);
    if (user.workspace) throw conflict('Your workspace is already set up. Features can no longer change here.');
    const parsed = featuresSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid feature selection.');
    const updated = await users.update(user.id, (u) => {
      u.onboarding.features = parsed.data.features;
    });
    const body: SessionResponse = toSessionResponse(updated, config);
    res.json(body);
  });

  router.post('/provision', requireProgress(config, 'setup'), async (_req, res) => {
    const user = currentUser(res);
    const report = provisioner.start(user);
    const fresh = await users.get(user.id);
    const body: ProvisionStatus = { ...report, nextStep: computeNextStep(fresh, config) };
    res.status(report.state === 'running' ? 202 : 200).json(body);
  });

  router.get('/provision/status', requireProgress(config, 'setup'), async (_req, res) => {
    const user = currentUser(res);
    const report = provisioner.status(user);
    const body: ProvisionStatus = { ...report, nextStep: computeNextStep(user, config) };
    res.json(body);
  });

  return router;
}
