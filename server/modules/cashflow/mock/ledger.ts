import type {
  CashAccount,
  CashCategory,
  CashCounterparty,
  CashTransaction,
  FlowDirection,
  ForecastSource,
  LoanApplication,
  PaymentMethod,
} from '../../../../shared/types.ts';
import { addDays, daysBetween, isoDate } from '../../../lib/dates.ts';
import { createRng, type Rng } from '../../../lib/random.ts';
import { CATEGORIES, type CompanyProfile } from './profiles.ts';
import { assessReviews } from './review.ts';

/** Days of posted history and of scheduled entries generated around "today". */
export const HISTORY_DAYS = 400;
export const FUTURE_DAYS = 370;

/** The part of a company the analytics and lending code actually read. */
export interface LedgerCompany {
  id: string;
  name: string;
  legalName: string;
  operatingAccountId: string;
}

export interface Ledger {
  profile: LedgerCompany;
  /** ISO date the ledger was generated for; balances are "as of" this day. */
  today: string;
  generatedAt: string;
  accounts: CashAccount[];
  categories: CashCategory[];
  customers: CashCounterparty[];
  /** Posted, pending, and scheduled entries, sorted by date. */
  transactions: CashTransaction[];
  nextId: number;
  financing: {
    applications: Record<string, LoanApplication>;
    saved: string[];
  };
}

type Schedule =
  | { kind: 'monthly'; day: number }
  | { kind: 'semimonthly' }
  | { kind: 'weekly'; weekday: number }
  | { kind: 'biweekly'; weekday: number; phase: 0 | 1 }
  | { kind: 'quarterly'; months: number[]; day: number }
  | { kind: 'weekdays'; days: number[] }
  | { kind: 'random'; perMonth: number };

interface Rule {
  merchant: string | ((rng: Rng) => string);
  description: string;
  categoryId: string;
  accountId: string;
  method: PaymentMethod;
  direction: FlowDirection;
  counterpartyId: string | null;
  schedule: Schedule;
  amount: number;
  /** ± fraction applied to `amount`. */
  jitter: number;
  /** Follows the company's revenue growth backwards through history. */
  grows: boolean;
  confidence: number;
  forecastSource: ForecastSource;
  /** Extra multiplier for a given month (0 = this month, 1 = last month, …). */
  monthFactor?: (monthsAgo: number) => number;
}

const DAY_MS = 86_400_000;

function lastDayOfMonth(d: Date): number {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

function fires(schedule: Schedule, d: Date, rng: Rng): boolean {
  const day = d.getUTCDate();
  const weekday = d.getUTCDay();
  switch (schedule.kind) {
    case 'monthly':
      return day === Math.min(schedule.day, lastDayOfMonth(d));
    case 'semimonthly':
      return day === 15 || day === lastDayOfMonth(d);
    case 'weekly':
      return weekday === schedule.weekday;
    case 'biweekly':
      return weekday === schedule.weekday && Math.floor(d.getTime() / DAY_MS / 7) % 2 === schedule.phase;
    case 'quarterly':
      return schedule.months.includes(d.getUTCMonth()) && day === schedule.day;
    case 'weekdays':
      return schedule.days.includes(weekday);
    case 'random':
      return rng.chance(schedule.perMonth / 30.4);
  }
}

function monthsAgo(today: Date, d: Date): number {
  return (today.getUTCFullYear() - d.getUTCFullYear()) * 12 + (today.getUTCMonth() - d.getUTCMonth());
}

/** Builds the recurring rules that describe a company's month. */
function rulesFor(p: CompanyProfile): Rule[] {
  const e = p.expenses;
  const v = p.vendors;
  const op = p.operatingAccountId;
  const sec = p.secondaryAccountId;
  const opInstitution = p.accounts.find((a) => a.id === op)?.institutionName ?? 'Bank';
  const secInstitution = p.accounts.find((a) => a.id === sec)?.institutionName ?? 'Bank';
  const rules: Rule[] = [];

  /* ── Cash in ── */
  rules.push({
    merchant: 'Stripe',
    description: 'Stripe payout',
    categoryId: 'subscriptions',
    accountId: op,
    method: 'STRIPE',
    direction: 'INFLOW',
    counterpartyId: null,
    schedule: { kind: 'weekdays', days: [1, 3, 5] },
    amount: p.revenue.subscriptions / 13,
    jitter: 0.25,
    grows: true,
    confidence: 0.8,
    forecastSource: 'RECURRING',
  });
  for (const c of p.customers) {
    rules.push({
      merchant: c.name,
      description: 'Invoice payment',
      categoryId: c.categoryId,
      accountId: c.accountId,
      method: c.method,
      direction: 'INFLOW',
      counterpartyId: c.id,
      schedule: { kind: 'monthly', day: c.day },
      amount: c.monthly,
      jitter: 0.06,
      grows: true,
      confidence: c.method === 'CHECK' ? 0.65 : 0.75,
      forecastSource: 'INVOICE',
    });
  }
  if (p.marketplaceAccountId && p.revenue.marketplace > 0) {
    rules.push({
      merchant: 'PayPal',
      description: 'PayPal transfer',
      categoryId: 'marketplace',
      accountId: p.marketplaceAccountId,
      method: 'PAYPAL',
      direction: 'INFLOW',
      counterpartyId: null,
      schedule: { kind: 'weekdays', days: [2, 4] },
      amount: p.revenue.marketplace / 8.7,
      jitter: 0.4,
      grows: true,
      confidence: 0.6,
      forecastSource: 'RECURRING',
    });
  }
  if (p.revenue.referral > 0) {
    rules.push({
      merchant: 'PartnerStack',
      description: 'Referral partner payout',
      categoryId: 'other_income',
      accountId: op,
      method: 'ACH',
      direction: 'INFLOW',
      counterpartyId: null,
      schedule: { kind: 'monthly', day: 27 },
      amount: p.revenue.referral,
      jitter: 0.3,
      grows: false,
      confidence: 0.6,
      forecastSource: 'RECURRING',
    });
  }
  if (p.savingsAccountId) {
    const savings = p.accounts.find((a) => a.id === p.savingsAccountId);
    rules.push({
      merchant: savings?.institutionName ?? 'Bank',
      description: 'Interest payment',
      categoryId: 'interest',
      accountId: p.savingsAccountId,
      method: 'OTHER',
      direction: 'INFLOW',
      counterpartyId: null,
      schedule: { kind: 'monthly', day: 1 },
      amount: ((savings?.bookBalance ?? 0) * 0.0425) / 12,
      jitter: 0.05,
      grows: false,
      confidence: 0.95,
      forecastSource: 'RECURRING',
    });
  }
  rules.push({
    merchant: (rng) => rng.pick(['Amazon Business', 'Uline', 'Staples']),
    description: 'Vendor refund',
    categoryId: 'other_income',
    accountId: op,
    method: 'CREDIT_CARD',
    direction: 'INFLOW',
    counterpartyId: null,
    schedule: { kind: 'random', perMonth: 0.7 },
    amount: 600,
    jitter: 0.8,
    grows: false,
    confidence: 0.3,
    forecastSource: 'MODEL',
  });

  /* ── Cash out ── */
  rules.push({
    merchant: v.payroll,
    description: 'Payroll and payroll taxes',
    categoryId: 'payroll',
    accountId: op,
    method: 'ACH',
    direction: 'OUTFLOW',
    counterpartyId: null,
    schedule: { kind: 'semimonthly' },
    amount: e.payroll / 2,
    jitter: 0.015,
    grows: false,
    confidence: 0.98,
    forecastSource: 'RECURRING',
  });
  for (const [i, day] of [7, 14, 21].entries()) {
    rules.push({
      merchant: v.contractors[i % v.contractors.length] ?? 'Contractor',
      description: 'Contractor invoice',
      categoryId: 'contractors',
      accountId: sec,
      method: 'ACH',
      direction: 'OUTFLOW',
      counterpartyId: null,
      schedule: { kind: 'monthly', day },
      amount: e.contractors / 3,
      jitter: 0.3,
      grows: false,
      confidence: 0.6,
      forecastSource: 'BILL',
    });
  }
  const software: Array<[string, number, number]> = [
    ['Google Workspace', 0.2, 5],
    ['Slack', 0.15, 7],
    ['GitHub', 0.11, 9],
    ['HubSpot', 0.34, 11],
    ['Figma', 0.09, 13],
    ['Notion', 0.06, 17],
    ['Zoom', 0.05, 19],
  ];
  for (const [name, share, day] of software) {
    rules.push({
      merchant: name,
      description: `${name} subscription`,
      categoryId: 'software',
      accountId: op,
      method: 'CREDIT_CARD',
      direction: 'OUTFLOW',
      counterpartyId: null,
      schedule: { kind: 'monthly', day },
      amount: e.software * share,
      jitter: 0,
      grows: false,
      confidence: 0.95,
      forecastSource: 'RECURRING',
    });
  }
  rules.push({
    merchant: 'Amazon Web Services',
    description: 'AWS monthly invoice',
    categoryId: 'cloud',
    accountId: op,
    method: 'CREDIT_CARD',
    direction: 'OUTFLOW',
    counterpartyId: null,
    schedule: { kind: 'monthly', day: 3 },
    amount: e.cloud,
    jitter: 0.03,
    grows: false,
    confidence: 0.85,
    forecastSource: 'BILL',
    monthFactor: (m) => (m === 0 ? p.cloudSpike : m < 0 ? (1 + p.cloudSpike) / 2 : 1),
  });
  rules.push({
    merchant: 'Datadog',
    description: 'Monitoring subscription',
    categoryId: 'cloud',
    accountId: op,
    method: 'CREDIT_CARD',
    direction: 'OUTFLOW',
    counterpartyId: null,
    schedule: { kind: 'monthly', day: 8 },
    amount: e.cloud * 0.14,
    jitter: 0.05,
    grows: false,
    confidence: 0.9,
    forecastSource: 'RECURRING',
  });
  rules.push({
    merchant: 'Cloudflare',
    description: 'Cloudflare subscription',
    categoryId: 'cloud',
    accountId: op,
    method: 'CREDIT_CARD',
    direction: 'OUTFLOW',
    counterpartyId: null,
    schedule: { kind: 'monthly', day: 14 },
    amount: e.cloud * 0.03,
    jitter: 0,
    grows: false,
    confidence: 0.95,
    forecastSource: 'RECURRING',
  });
  rules.push(
    {
      merchant: 'Google Ads',
      description: 'Search campaigns',
      categoryId: 'marketing',
      accountId: op,
      method: 'CREDIT_CARD',
      direction: 'OUTFLOW',
      counterpartyId: null,
      schedule: { kind: 'weekly', weekday: 1 },
      amount: (e.marketing * 0.55) / 4.33,
      jitter: 0.2,
      grows: false,
      confidence: 0.7,
      forecastSource: 'RECURRING',
    },
    {
      merchant: 'Meta Ads',
      description: 'Social campaigns',
      categoryId: 'marketing',
      accountId: op,
      method: 'CREDIT_CARD',
      direction: 'OUTFLOW',
      counterpartyId: null,
      schedule: { kind: 'biweekly', weekday: 4, phase: 0 },
      amount: (e.marketing * 0.28) / 2.17,
      jitter: 0.2,
      grows: false,
      confidence: 0.7,
      forecastSource: 'RECURRING',
    },
    {
      merchant: 'LinkedIn',
      description: 'Sponsored content',
      categoryId: 'marketing',
      accountId: op,
      method: 'CREDIT_CARD',
      direction: 'OUTFLOW',
      counterpartyId: null,
      schedule: { kind: 'monthly', day: 4 },
      amount: e.marketing * 0.17,
      jitter: 0.15,
      grows: false,
      confidence: 0.7,
      forecastSource: 'RECURRING',
    },
  );
  rules.push({
    merchant: v.landlord,
    description: 'Office rent',
    categoryId: 'rent',
    accountId: op,
    method: 'ACH',
    direction: 'OUTFLOW',
    counterpartyId: null,
    schedule: { kind: 'monthly', day: 1 },
    amount: e.rent,
    jitter: 0,
    grows: false,
    confidence: 1,
    forecastSource: 'BILL',
  });
  rules.push({
    merchant: v.insurer,
    description: 'Business insurance premium',
    categoryId: 'insurance',
    accountId: op,
    method: 'ACH',
    direction: 'OUTFLOW',
    counterpartyId: null,
    schedule: { kind: 'monthly', day: 26 },
    amount: e.insurance,
    jitter: 0,
    grows: false,
    confidence: 0.95,
    forecastSource: 'BILL',
  });
  const taxMonths = [0, 3, 5, 8];
  rules.push({
    merchant: 'IRS (EFTPS)',
    description: 'Federal estimated tax',
    categoryId: 'federal_taxes',
    accountId: sec,
    method: 'ACH',
    direction: 'OUTFLOW',
    counterpartyId: null,
    schedule: { kind: 'quarterly', months: taxMonths, day: 15 },
    amount: e.federalTaxQuarterly,
    jitter: 0,
    grows: false,
    confidence: 0.95,
    forecastSource: 'BILL',
  });
  rules.push({
    merchant: v.stateTaxAgency,
    description: 'State estimated tax',
    categoryId: 'state_taxes',
    accountId: sec,
    method: 'ACH',
    direction: 'OUTFLOW',
    counterpartyId: null,
    schedule: { kind: 'quarterly', months: taxMonths, day: 15 },
    amount: e.stateTaxQuarterly,
    jitter: 0,
    grows: false,
    confidence: 0.95,
    forecastSource: 'BILL',
  });
  rules.push({
    merchant: v.stateTaxAgency,
    description: 'Sales tax remittance',
    categoryId: 'sales_tax',
    accountId: sec,
    method: 'ACH',
    direction: 'OUTFLOW',
    counterpartyId: null,
    schedule: { kind: 'monthly', day: 20 },
    amount: e.salesTax,
    jitter: 0.12,
    grows: true,
    confidence: 0.9,
    forecastSource: 'BILL',
  });
  rules.push({
    merchant: v.accountant,
    description: 'Monthly bookkeeping',
    categoryId: 'professional_services',
    accountId: sec,
    method: 'ACH',
    direction: 'OUTFLOW',
    counterpartyId: null,
    schedule: { kind: 'monthly', day: 6 },
    amount: e.accounting,
    jitter: 0,
    grows: false,
    confidence: 0.9,
    forecastSource: 'RECURRING',
  });
  if (e.legalQuarterly > 0) {
    rules.push({
      merchant: v.lawFirm,
      description: 'Legal services',
      categoryId: 'professional_services',
      accountId: sec,
      method: 'WIRE',
      direction: 'OUTFLOW',
      counterpartyId: null,
      schedule: { kind: 'quarterly', months: [1, 4, 7, 10], day: 12 },
      amount: e.legalQuarterly,
      jitter: 0.2,
      grows: false,
      confidence: 0.6,
      forecastSource: 'BILL',
    });
  }
  rules.push({
    merchant: (rng) => rng.pick(['Delta Air Lines', 'United Airlines', 'Marriott', 'Hilton', 'Uber', 'Amtrak']),
    description: 'Business travel',
    categoryId: 'travel',
    accountId: op,
    method: 'CREDIT_CARD',
    direction: 'OUTFLOW',
    counterpartyId: null,
    schedule: { kind: 'random', perMonth: 3 },
    amount: e.travel / 3,
    jitter: 0.7,
    grows: false,
    confidence: 0.35,
    forecastSource: 'MODEL',
  });
  if (e.loan > 0 && v.lender) {
    rules.push({
      merchant: v.lender,
      description: 'SBA 7(a) loan payment',
      categoryId: 'loan_payments',
      accountId: op,
      method: 'ACH',
      direction: 'OUTFLOW',
      counterpartyId: null,
      schedule: { kind: 'monthly', day: 10 },
      amount: e.loan,
      jitter: 0,
      grows: false,
      confidence: 1,
      forecastSource: 'BILL',
    });
  }
  rules.push(
    {
      merchant: v.utility,
      description: 'Electric service',
      categoryId: 'utilities',
      accountId: op,
      method: 'ACH',
      direction: 'OUTFLOW',
      counterpartyId: null,
      schedule: { kind: 'monthly', day: 22 },
      amount: e.utilities * 0.69,
      jitter: 0.12,
      grows: false,
      confidence: 0.85,
      forecastSource: 'BILL',
    },
    {
      merchant: v.telecom,
      description: 'Internet and phone',
      categoryId: 'utilities',
      accountId: op,
      method: 'ACH',
      direction: 'OUTFLOW',
      counterpartyId: null,
      schedule: { kind: 'monthly', day: 24 },
      amount: e.utilities * 0.31,
      jitter: 0.02,
      grows: false,
      confidence: 0.95,
      forecastSource: 'BILL',
    },
  );
  rules.push(
    {
      merchant: opInstitution,
      description: 'Monthly service fee',
      categoryId: 'bank_fees',
      accountId: op,
      method: 'OTHER',
      direction: 'OUTFLOW',
      counterpartyId: null,
      schedule: { kind: 'monthly', day: 2 },
      amount: 45,
      jitter: 0,
      grows: false,
      confidence: 1,
      forecastSource: 'RECURRING',
    },
    {
      merchant: secInstitution,
      description: 'Account analysis fee',
      categoryId: 'bank_fees',
      accountId: sec,
      method: 'OTHER',
      direction: 'OUTFLOW',
      counterpartyId: null,
      schedule: { kind: 'monthly', day: 3 },
      amount: 65,
      jitter: 0,
      grows: false,
      confidence: 1,
      forecastSource: 'RECURRING',
    },
  );
  rules.push({
    merchant: (rng) => rng.pick(['Amazon Business', 'Staples', 'Uline', 'WeWork', 'DoorDash for Business']),
    description: 'Office and supplies',
    categoryId: 'other_expenses',
    accountId: op,
    method: 'CREDIT_CARD',
    direction: 'OUTFLOW',
    counterpartyId: null,
    schedule: { kind: 'random', perMonth: 2 },
    amount: e.other / 2,
    jitter: 0.6,
    grows: false,
    confidence: 0.3,
    forecastSource: 'MODEL',
  });
  return rules;
}

interface GenerateOptions {
  today: Date;
  now: Date;
}

/** Deterministically generates a full ledger for a company, anchored on `today`. */
export function generateLedger(profile: CompanyProfile, { today, now }: GenerateOptions): Ledger {
  const rng = createRng(profile.seed);
  const todayIso = isoDate(today);
  const from = addDays(today, -HISTORY_DAYS);
  const to = addDays(today, FUTURE_DAYS);
  const transactions: CashTransaction[] = [];
  let counter = 0;

  const push = (
    d: Date,
    fields: {
      accountId: string;
      amount: number;
      direction: FlowDirection;
      method: PaymentMethod;
      merchant: string;
      description: string;
      categoryId: string;
      counterpartyId: string | null;
      confidence: number;
      forecastSource: ForecastSource;
      manual?: boolean;
    },
  ) => {
    const offset = daysBetween(today, d);
    const date = isoDate(d);
    counter += 1;
    const id = `txn_${profile.id}_${String(counter).padStart(5, '0')}`;
    const amount = Math.max(1, Math.round(fields.amount * 100) / 100);
    const settles = fields.method === 'ACH' || fields.method === 'CHECK' || fields.method === 'CREDIT_CARD';
    if (offset > 0) {
      transactions.push({
        id,
        accountId: fields.accountId,
        date,
        postedDate: null,
        amount,
        direction: fields.direction,
        status: 'SCHEDULED',
        paymentMethod: fields.method,
        merchant: fields.merchant,
        description: fields.description,
        categoryId: fields.categoryId,
        source: fields.manual ? 'MANUAL' : 'FORECAST',
        counterpartyId: fields.counterpartyId,
        note: null,
        forecast: { confidence: fields.confidence, source: fields.forecastSource },
        review: null,
      });
      return;
    }
    const pending = offset >= -2 && settles && rng.chance(0.6);
    transactions.push({
      id,
      accountId: fields.accountId,
      date,
      postedDate: pending ? null : isoDate(settles && offset < 0 ? addDays(d, 1) : d),
      amount,
      direction: fields.direction,
      status: pending ? 'PENDING' : 'POSTED',
      paymentMethod: fields.method,
      merchant: fields.merchant,
      description: fields.description,
      categoryId: fields.categoryId,
      source: fields.manual ? 'MANUAL' : 'BANK_SYNC',
      counterpartyId: fields.counterpartyId,
      note: null,
      forecast: null,
      review: null,
    });
  };

  for (const rule of rulesFor(profile)) {
    for (let d = from; d.getTime() <= to.getTime(); d = addDays(d, 1)) {
      if (!fires(rule.schedule, d, rng)) continue;
      const ago = monthsAgo(today, d);
      const growth = rule.grows ? (1 + profile.growth) ** -Math.max(0, ago) : 1;
      const monthFactor = rule.monthFactor?.(ago) ?? 1;
      const jitter = rule.jitter > 0 ? 1 + (rng.next() * 2 - 1) * rule.jitter : 1;
      const amount = rule.amount * growth * monthFactor * jitter;
      const merchant = typeof rule.merchant === 'function' ? rule.merchant(rng) : rule.merchant;
      push(d, {
        accountId: rule.accountId,
        amount: rule.jitter === 0 ? Math.round(amount) : amount,
        direction: rule.direction,
        method: rule.method,
        merchant,
        description: rule.description,
        categoryId: rule.categoryId,
        counterpartyId: rule.counterpartyId,
        confidence: rule.confidence,
        forecastSource: rule.forecastSource,
      });
    }
  }

  for (const one of profile.oneOffs) {
    push(addDays(today, one.offsetDays), {
      accountId: one.accountId,
      amount: one.amount,
      direction: one.direction,
      method: one.method,
      merchant: one.merchant,
      description: one.description,
      categoryId: one.categoryId,
      counterpartyId: profile.customers.find((c) => c.name === one.merchant)?.id ?? null,
      confidence: one.confidence,
      forecastSource: one.direction === 'INFLOW' ? 'INVOICE' : 'BILL',
      manual: true,
    });
  }

  // Billing irregularities: alter or duplicate a vendor's latest charge.
  for (const anomaly of profile.billingAnomalies) {
    const latest = [...transactions].reverse().find((t) => t.merchant === anomaly.merchant && t.direction === 'OUTFLOW' && (t.status === 'POSTED' || t.status === 'PENDING'));
    if (!latest) continue;
    if (anomaly.kind === 'scale') {
      latest.amount = Math.round(latest.amount * (anomaly.factor ?? 1) * 100) / 100;
    } else {
      const date = addDays(new Date(`${latest.date}T00:00:00Z`), anomaly.daysAfter ?? 1);
      if (daysBetween(today, date) > 0) continue;
      counter += 1;
      transactions.push({
        ...latest,
        id: `txn_${profile.id}_${String(counter).padStart(5, '0')}`,
        date: isoDate(date),
        postedDate: latest.postedDate ? isoDate(date) : null,
      });
    }
  }

  transactions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));

  const accounts: CashAccount[] = profile.accounts.map((seed) => {
    const pendingOut = transactions
      .filter((t) => t.accountId === seed.id && t.status === 'PENDING' && t.direction === 'OUTFLOW')
      .reduce((sum, t) => sum + t.amount, 0);
    return {
      id: seed.id,
      institutionId: seed.institutionId,
      institutionName: seed.institutionName,
      name: seed.name,
      mask: seed.mask,
      type: seed.type,
      currency: 'USD',
      bookBalance: seed.bookBalance,
      availableBalance: Math.round((seed.bookBalance - pendingOut) * 100) / 100,
      lastSyncedAt: new Date(now.getTime() - seed.syncedMinutesAgo * 60_000).toISOString(),
      connectionStatus: seed.connectionStatus,
      minimumBalance: seed.minimumBalance,
    };
  });

  const ledger: Ledger = {
    profile,
    today: todayIso,
    generatedAt: now.toISOString(),
    accounts,
    categories: CATEGORIES,
    customers: profile.customers.map((c) => ({ id: c.id, name: c.name })),
    transactions,
    nextId: counter + 1,
    financing: { applications: {}, saved: [] },
  };
  assessReviews(ledger, now);
  return ledger;
}
