import { Router } from 'express';
import { z } from 'zod';
import { FORECAST_HORIZONS, PAYMENT_METHODS, type CashflowFilters, type ForecastHorizon } from '../../../../shared/types.ts';
import type { AppConfig } from '../../../config.ts';
import { badRequest } from '../../../lib/errors.ts';
import { currentUser, requireProgress } from '../../../lib/guards.ts';
import type { MockCashflowStore } from './store.ts';

export interface CashflowRouterDeps {
  config: AppConfig;
  store: MockCashflowStore;
}

const DEFAULT_COMPANY = 'acme';
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.');

const accountsParam = z
  .string()
  .optional()
  .transform((s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : null))
  .transform((list) => (list && list.length > 0 ? list : null));

const dashboardQuery = z.object({
  company: z.string().default(DEFAULT_COMPANY),
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
  company: z.string().default(DEFAULT_COMPANY),
  accounts: accountsParam,
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  q: z.string().max(80).optional(),
  scope: z.enum(['activity', 'scheduled', 'all']).default('activity'),
});

const companyQuery = z.object({ company: z.string().default(DEFAULT_COMPANY) });

const newTransactionBody = z.object({
  companyId: z.string().default(DEFAULT_COMPANY),
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
  companyId: z.string().default(DEFAULT_COMPANY),
  note: z.string().max(500).nullable().optional(),
  categoryId: z.string().min(1).optional(),
  description: z.string().trim().max(200).optional(),
  merchant: z.string().trim().max(80).optional(),
});

const syncBody = z.object({ companyId: z.string().default(DEFAULT_COMPANY) });

const reviewBody = z.object({
  companyId: z.string().default(DEFAULT_COMPANY),
  decision: z.enum(['approve', 'dispute', 'reopen']),
  note: z.string().max(500).nullable().optional(),
});

const applyBody = z.object({
  companyId: z.string().default(DEFAULT_COMPANY),
  amount: z.number().positive().max(100_000_000),
});

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid request.';
}

/**
 * Mock cash-flow API. Everything is computed in Node from a deterministic
 * ledger, so the dashboard has real behaviour (filters, scenarios, edits)
 * without a bank connection.
 */
export function createCashflowRouter({ config, store }: CashflowRouterDeps): Router {
  const router = Router();
  router.use(requireProgress(config, 'dashboard'));

  router.get('/companies', (_req, res) => {
    res.json({ companies: store.companies() });
  });

  router.get('/dashboard', (req, res) => {
    const parsed = dashboardQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    const q = parsed.data;
    const filters: CashflowFilters = { companyId: q.company, accountIds: q.accounts, period: q.period, horizon: q.horizon, scenario: q.scenario };
    res.set('Cache-Control', 'no-store');
    res.json(store.dashboard(currentUser(res).id, filters));
  });

  router.get('/categories', (req, res) => {
    const parsed = companyQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    res.json({ categories: store.ledger(currentUser(res).id, parsed.data.company).categories });
  });

  router.get('/transactions', (req, res) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    const q = parsed.data;
    res.json(store.listTransactions(currentUser(res).id, q.company, { accountIds: q.accounts, limit: q.limit, offset: q.offset, query: q.q ?? null, scope: q.scope }));
  });

  router.get('/transactions/:id', (req, res) => {
    const parsed = companyQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    res.json(store.getTransaction(currentUser(res).id, parsed.data.company, String(req.params.id)));
  });

  router.post('/transactions', (req, res) => {
    const parsed = newTransactionBody.safeParse(req.body);
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    const { companyId, ...input } = parsed.data;
    res.status(201).json(store.addTransaction(currentUser(res).id, companyId, input));
  });

  router.patch('/transactions/:id', (req, res) => {
    const parsed = updateTransactionBody.safeParse(req.body);
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    const { companyId, ...patch } = parsed.data;
    res.json(store.updateTransaction(currentUser(res).id, companyId, String(req.params.id), patch));
  });

  router.post('/sync', (req, res) => {
    const parsed = syncBody.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    res.json(store.sync(currentUser(res).id, parsed.data.companyId));
  });

  /** Record the team's decision on a flagged vendor bill. */
  router.post('/transactions/:id/review', (req, res) => {
    const parsed = reviewBody.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    res.json(store.decideReview(currentUser(res).id, parsed.data.companyId, String(req.params.id), parsed.data.decision, parsed.data.note ?? null));
  });

  /** Financing offers underwritten from the company's own ledger. */
  router.get('/loan-offers', (req, res) => {
    const parsed = companyQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    res.set('Cache-Control', 'no-store');
    res.json(store.loanOffers(currentUser(res).id, parsed.data.company));
  });

  router.post('/loan-offers/:id/apply', (req, res) => {
    const parsed = applyBody.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    res.status(201).json(store.applyForLoan(currentUser(res).id, parsed.data.companyId, String(req.params.id), parsed.data.amount));
  });

  router.post('/loan-offers/:id/save', (req, res) => {
    const parsed = syncBody.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest(firstIssue(parsed.error));
    res.json(store.toggleSavedOffer(currentUser(res).id, parsed.data.companyId, String(req.params.id)));
  });

  return router;
}
