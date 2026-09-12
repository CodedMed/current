import { Router } from 'express';
import type { DashboardResponse } from '../../../shared/types.ts';
import type { AppConfig } from '../../config.ts';
import { currentUser, requireProgress } from '../../lib/guards.ts';
import type { NessieApi } from '../nessie/types.ts';
import { fetchSnapshot } from '../nessie/snapshot.ts';
import { buildDashboard } from './buildDashboard.ts';

export interface DashboardRouterDeps {
  config: AppConfig;
  nessie: NessieApi;
}

const CACHE_TTL_MS = 15_000;

export function createDashboardRouter({ config, nessie }: DashboardRouterDeps): Router {
  const router = Router();
  const cache = new Map<string, { at: number; data: DashboardResponse }>();

  router.get('/', requireProgress(config, 'dashboard'), async (req, res) => {
    const user = currentUser(res);
    const workspace = user.workspace;
    if (!workspace) throw new Error('Workspace missing after progress check.');

    const bypass = req.query.refresh === '1';
    const hit = cache.get(user.id);
    if (!bypass && hit && Date.now() - hit.at < CACHE_TTL_MS) {
      res.json(hit.data);
      return;
    }

    const snapshot = await fetchSnapshot(nessie, workspace);
    const data = buildDashboard(user, workspace, snapshot);
    cache.set(user.id, { at: Date.now(), data });
    res.json(data);
  });

  return router;
}
