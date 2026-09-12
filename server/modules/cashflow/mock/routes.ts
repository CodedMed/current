import { Router } from 'express';
import { z } from 'zod';
import { FORECAST_HORIZONS, PAYMENT_METHODS, type CashflowFilters, type ForecastHorizon } from '../../../../shared/types.ts';
import type { AppConfig } from '../../../config.ts';
import { badRequest, notFound } from '../../../lib/errors.ts';
import { currentUser, requireProgress } from '../../../lib/guards.ts';
import type { CashflowStore } from '../store.ts';

export interface CashflowRouterDeps {
  config: AppConfig;
  store: CashflowStore;
}

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.');
const company = z.string().optional();

const accountsParam = z
  .string()
  .optional()
  .transform((s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : null))
  .transform((list) => (list && list.length > 0 ? list : null));

const dashboardQuery = z.object({
  company,
  accounts: accountsParam,
  period: z.string().default('last30'),
  horizon: z
    .string()
    .default('90')
    .transform((s) => Number(s))
    .refine((n): n is ForecastHorizon => (FORECAST_HORIZONS as readonly number[]).includes(n), 'horizon must be 30, 60, 90, 180, or 365'),
  scenario: z.enum(['expected', 'conservative', 'optimistic']).default('expected'),
});

const listQuery = z.object({
  company,
  accounts: accountsParam,
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  q: z.string().max(80).optional(),
  scope: z.enum(['activity', 'scheduled', 'all']).default('activity'),
});

const companyQuery = z.object({ company });

const newTransactionBody = z.object({
  companyId: company,
  accountId: z.string().min(1),
  date: isoDay,
  direction: z.enum(['INFLOW', 'OUTFLOW']),
  amount: z.number().positive().max(100_000_000),
  merchant: z.string().trim().min(1, 'Add who the money goes to or comes from.').max(80),
  description: z.string().trim().max(200).optional(),
  categoryId: z.string().min(1),
  paymentMethod: z.enum(PAYMENT_METHODS),
  status: z.enum(['POSTED', 'SCHEDULED']),
});

const updateTransactionBody = z.object({
  companyId: company,
  note: z.string().max(500).nullable().optional(),
  categoryId: z.string().min(1).optional(),
  description: z.string().trim().max(200).optional(),
  merchant: z.string().trim().max(80).optional(),
});

const companyBody = z.object({ companyId: company });

const reviewBody = z.object({
  companyId: company,
  decision: z.enum(['approve', 'dispute', 'reopen']),
  note: z.string().max(500).nullable().optional(),
});

const applyBody = z.object({
  companyId: company,
  amount: z.number().positive().max(100_000_000),
});

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid request.';
}

/** The company to act on: the one requested (if it belongs to the user) or the user's first. */
async function resolveCompany(store: CashflowStore, userId: string, requested: string | undefined): Promise<string> {
  const companies = await store.companies(userId);
  if (requested) {
    if (!companies.some((c) => c.id === requested)) throw notFound('No such company.');
    return requested;
  }
  const first = companies[0];
  if (!first) throw notFound('No company is set up for this account yet.');
  return first.id;
}

/**
 * Cash-flow API. The store decides where the ledger comes from: the Nessie
 * banking API by default, or the generated sample ledger.
 */
export function createCashflowRouter({ config, store }: CashflowRouterDeps): Router {
  const router = Router();
  router.use(requireProgress(config, 'dashboard'));

  router.get('/companies', async (_req, res) => {
    res.json({ companies: await store.companies(currentUser(res).id) });
  });

  router.get('/dashboard', async (req, res) => {
    const parsed = dashboardQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    const q = parsed.data;
    const userId = currentUser(res).id;
    const companyId = await resolveCompany(store, userId, q.company);
    const filters: CashflowFilters = { companyId, accountIds: q.accounts, period: q.period, horizon: q.horizon, scenario: q.scenario };
    res.set('Cache-Control', 'no-store');
    res.json(await store.dashboard(userId, filters));
  });

  router.get('/categories', async (req, res) => {
    const parsed = companyQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    const userId = currentUser(res).id;
    const companyId = await resolveCompany(store, userId, parsed.data.company);
    const dashboard = await store.dashboard(userId, { companyId, accountIds: null, period: 'last30', horizon: 30, scenario: 'expected' });
    res.json({ categories: dashboard.categories });
  });

  router.get('/transactions', async (req, res) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    const q = parsed.data;
    const userId = currentUser(res).id;
    const companyId = await resolveCompany(store, userId, q.company);
    res.json(await store.listTransactions(userId, companyId, { accountIds: q.accounts, limit: q.limit, offset: q.offset, query: q.q ?? null, scope: q.scope }));
  });

  router.get('/transactions/:id', async (req, res) => {
    const parsed = companyQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    const userId = currentUser(res).id;
    const companyId = await resolveCompany(store, userId, parsed.data.company);
    res.json(await store.getTransaction(userId, companyId, String(req.params.id)));
  });

  router.post('/transactions', async (req, res) => {
    const parsed = newTransactionBody.safeParse(req.body);
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    const { companyId: requested, ...input } = parsed.data;
    const userId = currentUser(res).id;
    const companyId = await resolveCompany(store, userId, requested);
    res.status(201).json(await store.addTransaction(userId, companyId, input));
  });

  router.patch('/transactions/:id', async (req, res) => {
    const parsed = updateTransactionBody.safeParse(req.body);
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    const { companyId: requested, ...patch } = parsed.data;
    const userId = currentUser(res).id;
    const companyId = await resolveCompany(store, userId, requested);
    res.json(await store.updateTransaction(userId, companyId, String(req.params.id), patch));
  });

  router.post('/sync', async (req, res) => {
    const parsed = companyBody.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    const userId = currentUser(res).id;
    const companyId = await resolveCompany(store, userId, parsed.data.companyId);
    res.json(await store.sync(userId, companyId));
  });

  /** Record the team's decision on a flagged vendor bill. */
  router.post('/transactions/:id/review', async (req, res) => {
    const parsed = reviewBody.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    const userId = currentUser(res).id;
    const companyId = await resolveCompany(store, userId, parsed.data.companyId);
    res.json(await store.decideReview(userId, companyId, String(req.params.id), parsed.data.decision, parsed.data.note ?? null));
  });

  /** Financing offers underwritten from the company's own ledger. */
  router.get('/loan-offers', async (req, res) => {
    const parsed = companyQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    const userId = currentUser(res).id;
    const companyId = await resolveCompany(store, userId, parsed.data.company);
    res.set('Cache-Control', 'no-store');
    res.json(await store.loanOffers(userId, companyId));
  });

  router.post('/loan-offers/:id/apply', async (req, res) => {
    const parsed = applyBody.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    const userId = currentUser(res).id;
    const companyId = await resolveCompany(store, userId, parsed.data.companyId);
    res.status(201).json(await store.applyForLoan(userId, companyId, String(req.params.id), parsed.data.amount));
  });

  router.post('/loan-offers/:id/save', async (req, res) => {
    const parsed = companyBody.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    const userId = currentUser(res).id;
    const companyId = await resolveCompany(store, userId, parsed.data.companyId);
    res.json(await store.toggleSavedOffer(userId, companyId, String(req.params.id)));
  });

  return router;
}
