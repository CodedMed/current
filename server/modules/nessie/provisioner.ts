import type { FeatureId, ProvisionStage, ProvisionStatus } from '../../../shared/types.ts';
import { PROVISION_STAGES } from '../../../shared/types.ts';
import { addDays, clampDayOfMonth, eachDay, isoDate, startOfToday } from '../../lib/dates.ts';
import { IntegrationError } from '../../lib/errors.ts';
import { mapWithConcurrency } from '../../lib/http.ts';
import { createLogger } from '../../lib/logger.ts';
import { createRng, type Rng } from '../../lib/random.ts';
import type { UserRecord, UserRepository } from '../../store/userStore.ts';
import { profileFor, type AccountKey, type Cadence, type DemoProfile } from './demoProfiles.ts';
import { INTERNAL_TRANSFER_PREFIX } from './types.ts';
import type { NessieApi, NewAccount, NewBill, NewCustomer, NewDeposit, NewPurchase, NewWithdrawal } from './types.ts';

const log = createLogger('provision');

/** Days of transaction history seeded before today. */
export const HISTORY_DAYS = 90;
const CONCURRENCY = 6;

export interface SeedPlan {
  businessName: string;
  customer: NewCustomer;
  accounts: Array<{ key: AccountKey; input: NewAccount }>;
  merchants: Array<{ key: string; name: string; category: string }>;
  deposits: Array<{ account: AccountKey; input: NewDeposit }>;
  withdrawals: Array<{ account: AccountKey; input: NewWithdrawal }>;
  purchases: Array<{ account: AccountKey; merchant: string; input: Omit<NewPurchase, 'merchant_id'> }>;
  bills: Array<{ account: AccountKey; input: NewBill }>;
  /** Net executed movement per account over the window; used to detect balance semantics. */
  expectedNet: Record<AccountKey, number>;
}

/* ───────────────────────── Plan generation ───────────────────────── */

function cadenceDates(cadence: Cadence, windowStart: Date, windowEnd: Date, rng: Rng): Date[] {
  const days = eachDay(windowStart, windowEnd);
  switch (cadence.kind) {
    case 'daily':
      return days.filter((d) => cadence.weekdays.includes(d.getUTCDay()));
    case 'weekly':
      return days.filter((d) => d.getUTCDay() === cadence.weekday);
    case 'biweekly':
      return days.filter((d) => d.getUTCDay() === cadence.weekday).filter((_, i) => i % 2 === 0);
    case 'monthly': {
      const out: Date[] = [];
      let year = windowStart.getUTCFullYear();
      let month = windowStart.getUTCMonth();
      const endYear = windowEnd.getUTCFullYear();
      const endMonth = windowEnd.getUTCMonth();
      while (year < endYear || (year === endYear && month <= endMonth)) {
        const d = clampDayOfMonth(year, month, cadence.day);
        if (d.getTime() >= windowStart.getTime() && d.getTime() <= windowEnd.getTime()) out.push(d);
        month += 1;
        if (month > 11) {
          month = 0;
          year += 1;
        }
      }
      return out;
    }
    case 'random': {
      // Pick within each 30-day segment so lumpy income never bunches into a single month.
      const out: Date[] = [];
      for (let start = 0; start < days.length; start += 30) {
        const segment = days.slice(start, start + 30);
        const count = Math.min(segment.length, Math.max(1, Math.round(cadence.perMonth * (segment.length / 30))));
        const picked = new Set<number>();
        while (picked.size < count) picked.add(rng.int(0, segment.length - 1));
        for (const i of [...picked].sort((a, b) => a - b)) out.push(segment[i] as Date);
      }
      return out;
    }
  }
}

/** Next calendar date on/after `from` that falls on `day` of the month. */
function nextMonthlyOccurrence(day: number, from: Date): Date {
  const candidate = clampDayOfMonth(from.getUTCFullYear(), from.getUTCMonth(), day);
  if (candidate.getTime() >= from.getTime()) return candidate;
  return clampDayOfMonth(from.getUTCFullYear(), from.getUTCMonth() + 1, day);
}

export function buildSeedPlan(profile: DemoProfile, user: UserRecord, features: FeatureId[], today: Date, rng: Rng): SeedPlan {
  const windowEnd = today;
  const windowStart = addDays(today, -(HISTORY_DAYS - 1));
  const merchantByKey = new Map(profile.merchants.map((m) => [m.key, m]));
  const expectedNet: Record<AccountKey, number> = { operating: 0, reserve: 0, card: 0 };
  const bump = (account: AccountKey, delta: number) => {
    expectedNet[account] = Math.round((expectedNet[account] + delta) * 100) / 100;
  };

  const plan: SeedPlan = {
    businessName: profile.businessName(user),
    customer: {
      first_name: user.givenName || 'Business',
      last_name: user.familyName || 'Owner',
      address: profile.address,
    },
    accounts: profile.accounts.map((a) => ({
      key: a.key,
      input: { type: a.type, nickname: a.nickname, rewards: 0, balance: a.openingBalance },
    })),
    merchants: profile.merchants.map((m) => ({ ...m })),
    deposits: [],
    withdrawals: [],
    purchases: [],
    bills: [],
    expectedNet,
  };

  for (const income of profile.income) {
    for (const date of cadenceDates(income.cadence, windowStart, windowEnd, rng)) {
      const amount = rng.amount(income.amount[0], income.amount[1]);
      plan.deposits.push({
        account: 'operating',
        input: { medium: 'balance', transaction_date: isoDate(date), status: 'completed', amount, description: income.description },
      });
      bump('operating', amount);
    }
  }

  for (const expense of profile.expenses) {
    if (!merchantByKey.has(expense.merchant)) throw new Error(`Unknown merchant key ${expense.merchant}`);
    for (const date of cadenceDates(expense.cadence, windowStart, windowEnd, rng)) {
      const amount = rng.amount(expense.amount[0], expense.amount[1]);
      plan.purchases.push({
        account: 'operating',
        merchant: expense.merchant,
        input: { medium: 'balance', purchase_date: isoDate(date), amount, status: 'completed', description: expense.description },
      });
      bump('operating', -amount);
    }
  }

  for (const withdrawal of profile.withdrawals) {
    for (const date of cadenceDates(withdrawal.cadence, windowStart, windowEnd, rng)) {
      const amount = rng.amount(withdrawal.amount[0], withdrawal.amount[1]);
      plan.withdrawals.push({
        account: 'operating',
        input: { medium: 'balance', transaction_date: isoDate(date), status: 'completed', amount, description: withdrawal.description },
      });
      bump('operating', -amount);
    }
  }

  // Past occurrences of recurring bills appear as withdrawals; the next one is a live bill.
  for (const bill of profile.bills) {
    for (const date of cadenceDates({ kind: 'monthly', day: bill.day }, windowStart, addDays(today, -1), rng)) {
      plan.withdrawals.push({
        account: 'operating',
        input: {
          medium: 'balance',
          transaction_date: isoDate(date),
          status: 'completed',
          amount: bill.amount,
          description: `Bill · ${bill.nickname} · ${bill.payee}`,
        },
      });
      bump('operating', -bill.amount);
    }
    plan.bills.push({
      account: 'operating',
      input: {
        status: 'recurring',
        payee: bill.payee,
        nickname: bill.nickname,
        payment_date: isoDate(nextMonthlyOccurrence(bill.day, today)),
        recurring_date: bill.day,
        payment_amount: bill.amount,
      },
    });
  }

  if (features.includes('vendor_payments')) {
    for (const vendorBill of profile.vendorBills) {
      const merchant = merchantByKey.get(vendorBill.merchant);
      if (!merchant) continue;
      const due = addDays(today, vendorBill.dueInDays);
      plan.bills.push({
        account: 'operating',
        input: {
          status: 'pending',
          payee: merchant.name,
          nickname: `Vendor invoice · ${merchant.name}`,
          payment_date: isoDate(due),
          recurring_date: due.getUTCDate(),
          payment_amount: vendorBill.amount,
        },
      });
    }
  }

  if (features.includes('receivables') || features.includes('invoices')) {
    for (const receivable of profile.receivables) {
      const due = addDays(today, receivable.termsDays - receivable.issuedDaysAgo);
      plan.deposits.push({
        account: 'operating',
        input: {
          medium: 'balance',
          transaction_date: isoDate(due),
          status: 'pending',
          amount: receivable.amount,
          description: `Invoice ${receivable.reference} · ${receivable.customer} · net ${receivable.termsDays}`,
        },
      });
    }
  }

  // Nessie transfers carry no destination account, so an internal move is recorded as a
  // withdrawal from operating plus a matching deposit into reserve, tagged as a transfer.
  if (profile.reserveSweep) {
    const sweep = profile.reserveSweep;
    const description = `${INTERNAL_TRANSFER_PREFIX}${sweep.description}`;
    for (const date of cadenceDates({ kind: 'monthly', day: sweep.day }, windowStart, windowEnd, rng)) {
      const amount = rng.amount(sweep.amount[0], sweep.amount[1]);
      const transaction_date = isoDate(date);
      plan.withdrawals.push({ account: 'operating', input: { medium: 'balance', transaction_date, status: 'completed', amount, description } });
      plan.deposits.push({ account: 'reserve', input: { medium: 'balance', transaction_date, status: 'completed', amount, description } });
      bump('operating', -amount);
      bump('reserve', amount);
    }
  }

  return plan;
}

/* ───────────────────────── Job execution ───────────────────────── */

interface ProvisionJob {
  userId: string;
  state: 'running' | 'done' | 'error';
  stage: ProvisionStage | null;
  completed: ProvisionStage[];
  error: string | null;
}

export type ProvisionReport = Omit<ProvisionStatus, 'nextStep'>;

/**
 * Turns onboarding choices into a Nessie customer with accounts and history.
 * Runs asynchronously; the client polls `status()` to render progress.
 */
export class Provisioner {
  readonly #api: NessieApi;
  readonly #users: UserRepository;
  readonly #jobs = new Map<string, ProvisionJob>();

  constructor(api: NessieApi, users: UserRepository) {
    this.#api = api;
    this.#users = users;
  }

  status(user: UserRecord): ProvisionReport {
    const mode = this.#api.mode;
    if (user.workspace) return { state: 'done', stage: null, completed: [...PROVISION_STAGES], error: null, mode };
    const job = this.#jobs.get(user.id);
    if (!job) return { state: 'idle', stage: null, completed: [], error: null, mode };
    return { state: job.state, stage: job.stage, completed: [...job.completed], error: job.error, mode };
  }

  start(user: UserRecord): ProvisionReport {
    if (user.workspace) return this.status(user);
    const existing = this.#jobs.get(user.id);
    if (existing?.state === 'running') return this.status(user);

    const job: ProvisionJob = { userId: user.id, state: 'running', stage: 'workspace', completed: [], error: null };
    this.#jobs.set(user.id, job);
    void this.#run(user, job).catch((err: unknown) => {
      job.state = 'error';
      job.error = err instanceof Error ? err.message : String(err);
      const details = err instanceof IntegrationError ? err.details : undefined;
      log.error('Provisioning failed', { userId: user.id, stage: job.stage, error: job.error, details });
    });
    return this.status(user);
  }

  async #run(user: UserRecord, job: ProvisionJob): Promise<void> {
    const businessType = user.onboarding.businessType;
    if (!businessType) throw new Error('Choose a business type before provisioning.');
    const profile = profileFor(businessType);
    const plan = buildSeedPlan(profile, user, user.onboarding.features, startOfToday(), createRng(user.id));
    const api = this.#api;
    const advance = (next: ProvisionStage) => {
      if (job.stage) job.completed.push(job.stage);
      job.stage = next;
    };
    log.info('Provisioning workspace', {
      userId: user.id,
      mode: api.mode,
      businessType,
      records: plan.deposits.length + plan.purchases.length + plan.withdrawals.length + plan.bills.length,
    });

    // 1. Customer
    const customer = await api.createCustomer(plan.customer);

    // 2. Accounts (sequential; only three)
    advance('accounts');
    const accountIds = {} as Record<AccountKey, string>;
    for (const account of plan.accounts) {
      const created = await api.createAccount(customer._id, account.input);
      accountIds[account.key] = created._id;
    }

    // 3. Merchants and transaction history
    advance('transactions');
    const merchantIds = new Map<string, string>();
    const merchants: Record<string, { name: string; category: string }> = {};
    await mapWithConcurrency(plan.merchants, 4, async (m) => {
      const created = await api.createMerchant({
        name: m.name,
        category: m.category,
        address: profile.address,
        geocode: { lat: 40.7128, lng: -74.006 },
      });
      merchantIds.set(m.key, created._id);
      merchants[created._id] = { name: m.name, category: m.category };
    });
    await mapWithConcurrency(plan.deposits, CONCURRENCY, (d) => api.createDeposit(accountIds[d.account], d.input));
    await mapWithConcurrency(plan.purchases, CONCURRENCY, (p) =>
      api.createPurchase(accountIds[p.account], { ...p.input, merchant_id: merchantIds.get(p.merchant) as string }),
    );
    await mapWithConcurrency(plan.withdrawals, CONCURRENCY, (w) => api.createWithdrawal(accountIds[w.account], w.input));

    // 4. Bills (receivables were created above as pending deposits)
    advance('bills');
    await mapWithConcurrency(plan.bills, CONCURRENCY, (b) => api.createBill(accountIds[b.account], b.input));

    // 5. Analysis: confirm how the API treated balances, then persist the workspace
    advance('analysis');
    const operating = await api.getAccount(accountIds.operating);
    const opening = plan.accounts.find((a) => a.key === 'operating')?.input.balance ?? 0;
    const balancesApplied = Math.abs(operating.balance - (opening + plan.expectedNet.operating)) < 1;
    if (!balancesApplied) {
      log.warn('Banking API did not apply seeded transactions to balances; the dashboard will derive balances.', {
        userId: user.id,
      });
    }

    await this.#users.update(user.id, (u) => {
      u.workspace = {
        mode: api.mode,
        businessName: plan.businessName,
        nessieCustomerId: customer._id,
        accountIds: Object.values(accountIds),
        merchants,
        balancesApplied,
        provisionedAt: new Date().toISOString(),
      };
      u.onboarding.completedAt = new Date().toISOString();
    });

    job.completed.push('analysis');
    job.stage = null;
    job.state = 'done';
    log.info('Workspace ready', { userId: user.id, customerId: customer._id });
  }
}
