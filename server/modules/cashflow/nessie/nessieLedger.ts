import type {
  CashAccount,
  CashCounterparty,
  CashTransaction,
  ForecastSource,
  PaymentMethod,
  TransactionReview,
  UpdateTransactionInput,
} from '../../../../shared/types.ts';
import { addDays, clampDayOfMonth, daysBetween, isoDate, parseIsoDate } from '../../../lib/dates.ts';
import type { UserRecord, WorkspaceState } from '../../../store/userStore.ts';
import { INTERNAL_TRANSFER_PREFIX, isSettled, type NessieAccount, type NessieSnapshot } from '../../nessie/types.ts';
import { businessTypeLabel } from '../../onboarding/catalog.ts';
import { FUTURE_DAYS, type Ledger } from '../mock/ledger.ts';
import { CATEGORIES } from '../mock/profiles.ts';
import { assessReviews } from '../mock/review.ts';

/**
 * Turns a Nessie snapshot into the ledger the cash-flow analytics consume.
 * Posted history comes straight from the bank records; scheduled entries come
 * from Nessie bills and pending deposits (receivables), plus recurring streams
 * detected in the last 90 days and projected forward so the forecast has the
 * same shape as the sample ledger.
 */

const DETECTION_WINDOW_DAYS = 90;
const round2 = (n: number) => Math.round(n * 100) / 100;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'x';
const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length === 0 ? 0 : sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
};

export interface LedgerOverlays {
  /** Edits Nessie cannot store (category, note, wording), keyed by transaction id. */
  edits?: Map<string, UpdateTransactionInput>;
  /** Review decisions already made, keyed by transaction id. */
  reviews?: Map<string, TransactionReview>;
  financing?: Ledger['financing'];
}

export interface NessieLedgerInput {
  snapshot: NessieSnapshot;
  workspace: WorkspaceState;
  user: UserRecord;
  today: Date;
  now: Date;
  overlays?: LedgerOverlays;
}

/* ───────────── Classification ───────────── */

/** Text after the last "·" separator, which is where seeded descriptions keep the counterparty. */
function counterpartyOf(description: string): string {
  const parts = description.split('·').map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? (parts[parts.length - 1] as string) : description.trim();
}

function incomeCategory(description: string): string {
  const d = description.toLowerCase();
  if (/interest/.test(d)) return 'interest';
  if (/retainer|invoice|milestone|progress draw|client payment|customer payment/.test(d)) return 'services';
  if (/settlement|payout|sales|cash deposit|deposit/.test(d)) return 'sales';
  return 'other_income';
}

const MERCHANT_CATEGORY: Record<string, string> = {
  inventory: 'inventory',
  'packaging & supplies': 'supplies',
  supplies: 'supplies',
  'office supplies': 'supplies',
  'cleaning & sanitation': 'supplies',
  marketing: 'marketing',
  software: 'software',
  travel: 'travel',
  contractors: 'contractors',
  materials: 'materials',
  'equipment rental': 'equipment',
  equipment: 'equipment',
  fuel: 'fleet',
  'food & beverage': 'food_beverage',
  'payment processing': 'bank_fees',
  fulfillment: 'fulfillment_shipping',
  shipping: 'fulfillment_shipping',
  meals: 'other_expenses',
};

function merchantCategory(category: string): string {
  const key = category.trim().toLowerCase();
  const direct = MERCHANT_CATEGORY[key];
  if (direct) return direct;
  if (/software|saas|subscription/.test(key)) return 'software';
  if (/market|ads|advert/.test(key)) return 'marketing';
  if (/travel|air|hotel|lodging/.test(key)) return 'travel';
  if (/food|restaurant|grocer|beverage/.test(key)) return 'food_beverage';
  if (/material|hardware|lumber|plumbing/.test(key)) return 'materials';
  if (/equipment|rental/.test(key)) return 'equipment';
  if (/ship|fulfil|postage|freight/.test(key)) return 'fulfillment_shipping';
  if (/fuel|gas station|fleet|vehicle/.test(key)) return 'fleet';
  if (/supply|supplies|packag|office/.test(key)) return 'supplies';
  if (/inventory|wholesale/.test(key)) return 'inventory';
  if (/contractor|labor/.test(key)) return 'contractors';
  if (/insurance/.test(key)) return 'insurance';
  if (/utilit|telecom|internet/.test(key)) return 'utilities';
  return 'other_expenses';
}

function billCategory(text: string): string {
  const d = text.toLowerCase();
  if (/rent|lease|office|membership|desk|suite|storage|warehouse|yard/.test(d)) return 'rent';
  if (/insurance|liability|health|workers/.test(d)) return 'insurance';
  if (/energy|electric|gas|utilit|internet|phone|waste|hosting|aws|telecom/.test(d)) return 'utilities';
  if (/loan|credit|card payment|installment|ford/.test(d)) return 'loan_payments';
  if (/payroll platform|gusto|software|workspace/.test(d)) return 'software';
  return 'other_expenses';
}

function withdrawalCategory(description: string): string {
  const d = description.toLowerCase();
  if (d.startsWith('bill ·')) return billCategory(d);
  if (/payroll/.test(d)) return 'payroll';
  if (/irs|federal/.test(d)) return 'federal_taxes';
  if (/sales tax/.test(d)) return 'sales_tax';
  if (/\btax/.test(d)) return 'state_taxes';
  if (/owner draw|\bdraw\b/.test(d)) return 'owner_draw';
  if (/subcontractor|contractor/.test(d)) return 'contractors';
  if (/loan|installment/.test(d)) return 'loan_payments';
  if (/\bfee/.test(d)) return 'bank_fees';
  return 'other_expenses';
}

function inflowMethod(description: string): PaymentMethod {
  const d = description.toLowerCase();
  if (/wire/.test(d)) return 'WIRE';
  if (/stripe/.test(d)) return 'STRIPE';
  if (/paypal/.test(d)) return 'PAYPAL';
  if (/\bcash\b/.test(d)) return 'CASH';
  if (/check/.test(d)) return 'CHECK';
  if (/settlement|payout|square|toast|shopify|amazon|etsy|doordash|card sales/.test(d)) return 'OTHER';
  return 'ACH';
}

/* ───────────── Accounts ───────────── */

function accountType(t: NessieAccount['type']): CashAccount['type'] {
  return t === 'Checking' ? 'CHECKING' : t === 'Savings' ? 'SAVINGS' : 'CREDIT';
}

function netSettled(account: NessieAccount, s: NessieSnapshot): number {
  const id = account._id;
  let net = 0;
  for (const d of s.deposits) if (d.payee_id === id && isSettled(d.status)) net += d.amount;
  for (const w of s.withdrawals) if (w.payer_id === id && isSettled(w.status)) net -= w.amount;
  for (const p of s.purchases) if (p.payer_id === id && isSettled(p.status)) net -= p.amount;
  for (const t of s.transfers) {
    if (!isSettled(t.status)) continue;
    if (t.payer_id === id) net -= t.amount;
    if (t.payee_id === id) net += t.amount;
  }
  return net;
}

/* ───────────── Recurrence projection ───────────── */

interface Stream {
  direction: CashTransaction['direction'];
  merchant: string;
  description: string;
  categoryId: string;
  accountId: string;
  method: PaymentMethod;
  counterpartyId: string | null;
  dates: string[];
  amounts: number[];
}

function projectRecurring(history: CashTransaction[], today: Date): CashTransaction[] {
  const since = isoDate(addDays(today, -(DETECTION_WINDOW_DAYS - 1)));
  const streams = new Map<string, Stream>();
  for (const t of history) {
    if (t.status !== 'POSTED' || t.date < since) continue;
    const key = `${t.direction}|${t.merchant}|${t.categoryId}|${t.accountId}`;
    const s = streams.get(key) ?? {
      direction: t.direction,
      merchant: t.merchant,
      description: t.description,
      categoryId: t.categoryId,
      accountId: t.accountId,
      method: t.paymentMethod,
      counterpartyId: t.counterpartyId,
      dates: [],
      amounts: [],
    };
    s.dates.push(t.date);
    s.amounts.push(t.amount);
    streams.set(key, s);
  }

  const horizonEnd = addDays(today, FUTURE_DAYS);
  const out: CashTransaction[] = [];
  for (const [key, s] of streams) {
    if (s.dates.length < 3) continue;
    const dates = [...s.dates].sort().map(parseIsoDate);
    const intervals = dates.slice(1).map((d, i) => daysBetween(dates[i] as Date, d));
    const interval = median(intervals);
    const amount = round2(median(s.amounts.slice(-8)));
    const last = dates[dates.length - 1] as Date;
    const future: Date[] = [];
    let confidence = 0.8;
    let source: ForecastSource = 'RECURRING';

    if (interval <= 1.5) {
      // Near-daily activity (card settlements): keep the weekdays it usually lands on.
      const counts = new Array<number>(7).fill(0);
      for (const d of dates) counts[d.getUTCDay()] = (counts[d.getUTCDay()] ?? 0) + 1;
      const weeks = DETECTION_WINDOW_DAYS / 7;
      const weekdays = counts.map((c, wd) => (c >= weeks * 0.5 ? wd : -1)).filter((wd) => wd >= 0);
      confidence = 0.7;
      for (let d = addDays(today, 1); d.getTime() <= horizonEnd.getTime(); d = addDays(d, 1)) if (weekdays.includes(d.getUTCDay())) future.push(d);
    } else if (interval >= 5 && interval <= 9) {
      for (let d = addDays(last, 7); d.getTime() <= horizonEnd.getTime(); d = addDays(d, 7)) if (d.getTime() > today.getTime()) future.push(d);
    } else if (interval >= 12 && interval <= 16) {
      for (let d = addDays(last, 14); d.getTime() <= horizonEnd.getTime(); d = addDays(d, 14)) if (d.getTime() > today.getTime()) future.push(d);
    } else if (interval >= 26 && interval <= 35) {
      const day = Math.round(median(dates.map((d) => d.getUTCDate())));
      confidence = s.direction === 'INFLOW' ? 0.7 : 0.85;
      for (let m = 0; m <= 13; m++) {
        const d = clampDayOfMonth(today.getUTCFullYear(), today.getUTCMonth() + m, day);
        if (d.getTime() > today.getTime() && d.getTime() <= horizonEnd.getTime() && d.getTime() > last.getTime()) future.push(d);
      }
    } else {
      // Irregular: spread the observed monthly rate evenly, marked as a model estimate.
      const perMonth = s.dates.length / (DETECTION_WINDOW_DAYS / 30);
      const step = Math.max(2, Math.round(30 / perMonth));
      confidence = 0.35;
      source = 'MODEL';
      for (let d = addDays(today, Math.ceil(step / 2)); d.getTime() <= horizonEnd.getTime(); d = addDays(d, step)) future.push(d);
    }

    for (const d of future) {
      const date = isoDate(d);
      out.push({
        id: `fc_${slug(key)}_${date}`,
        accountId: s.accountId,
        date,
        postedDate: null,
        amount,
        direction: s.direction,
        status: 'SCHEDULED',
        paymentMethod: s.method,
        merchant: s.merchant,
        description: s.description,
        categoryId: s.categoryId,
        source: 'FORECAST',
        counterpartyId: s.counterpartyId,
        note: null,
        forecast: { confidence, source },
        review: null,
      });
    }
  }
  return out;
}

/* ───────────── Entry point ───────────── */

export function ledgerFromSnapshot({ snapshot, workspace, user, today, now, overlays }: NessieLedgerInput): Ledger {
  const todayIso = isoDate(today);
  const nowIso = now.toISOString();
  const customers = new Map<string, CashCounterparty>();
  const customerId = (name: string): string => {
    const id = slug(name);
    if (!customers.has(id)) customers.set(id, { id, name });
    return id;
  };

  /* Accounts: balances derive from opening balance + settled history when the API does not apply transactions. */
  const accounts: CashAccount[] = snapshot.accounts.map((a) => {
    const isCard = a.type === 'Credit Card';
    const balance = isCard ? -a.balance : workspace.balancesApplied ? a.balance : a.balance + netSettled(a, snapshot);
    return {
      id: a._id,
      institutionId: 'capitalone',
      institutionName: 'Capital One',
      name: a.nickname,
      mask: a.account_number ? a.account_number.slice(-4) : null,
      type: accountType(a.type),
      currency: 'USD',
      bookBalance: round2(balance),
      availableBalance: round2(balance),
      lastSyncedAt: nowIso,
      connectionStatus: 'CONNECTED',
      minimumBalance: null,
    };
  });
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const activity = new Map<string, number>();
  const bump = (id: string) => activity.set(id, (activity.get(id) ?? 0) + 1);

  const transactions: CashTransaction[] = [];

  /* Posted history */
  for (const d of snapshot.deposits) {
    if (d.description.startsWith(INTERNAL_TRANSFER_PREFIX)) continue; // internal moves never count as cash in/out
    if (isSettled(d.status)) {
      const categoryId = incomeCategory(d.description);
      const counterparty = counterpartyOf(d.description);
      bump(d.payee_id);
      transactions.push({
        id: d._id,
        accountId: d.payee_id,
        date: d.transaction_date,
        postedDate: d.transaction_date,
        amount: round2(d.amount),
        direction: 'INFLOW',
        status: 'POSTED',
        paymentMethod: inflowMethod(d.description),
        merchant: counterparty,
        description: d.description,
        categoryId,
        source: 'BANK_SYNC',
        counterpartyId: categoryId === 'services' ? customerId(counterparty) : null,
        note: null,
        forecast: null,
        review: null,
      });
    } else if (d.status === 'pending') {
      // A pending deposit is an open receivable: "Invoice REF · Customer · net N".
      const parts = d.description.split('·').map((p) => p.trim());
      const reference = parts[0] ?? d.description;
      const customer = parts[1] ?? counterpartyOf(d.description);
      const overdue = d.transaction_date < todayIso;
      transactions.push({
        id: d._id,
        accountId: d.payee_id,
        date: d.transaction_date,
        postedDate: null,
        amount: round2(d.amount),
        direction: 'INFLOW',
        status: 'SCHEDULED',
        paymentMethod: 'ACH',
        merchant: customer,
        description: overdue ? `${reference} · overdue` : reference,
        categoryId: 'services',
        source: 'FORECAST',
        counterpartyId: customerId(customer),
        note: null,
        forecast: { confidence: overdue ? 0.6 : 0.85, source: 'INVOICE' },
        review: null,
      });
    }
  }

  for (const p of snapshot.purchases) {
    if (!isSettled(p.status)) continue;
    const merchant = snapshot.merchants[p.merchant_id] ?? { name: 'Merchant', category: 'Other' };
    const account = accountById.get(p.payer_id);
    bump(p.payer_id);
    transactions.push({
      id: p._id,
      accountId: p.payer_id,
      date: p.purchase_date,
      postedDate: p.purchase_date,
      amount: round2(p.amount),
      direction: 'OUTFLOW',
      status: 'POSTED',
      paymentMethod: account?.type === 'CREDIT' ? 'CREDIT_CARD' : 'DEBIT_CARD',
      merchant: merchant.name,
      description: p.description || merchant.category,
      categoryId: merchantCategory(merchant.category),
      source: 'BANK_SYNC',
      counterpartyId: null,
      note: null,
      forecast: null,
      review: null,
    });
  }

  for (const w of snapshot.withdrawals) {
    if (!isSettled(w.status) || w.description.startsWith(INTERNAL_TRANSFER_PREFIX)) continue;
    const isBill = w.description.toLowerCase().startsWith('bill ·');
    const parts = w.description.split('·').map((p) => p.trim());
    bump(w.payer_id);
    transactions.push({
      id: w._id,
      accountId: w.payer_id,
      date: w.transaction_date,
      postedDate: w.transaction_date,
      amount: round2(w.amount),
      direction: 'OUTFLOW',
      status: 'POSTED',
      paymentMethod: 'ACH',
      merchant: counterpartyOf(w.description),
      description: isBill ? (parts[1] ?? w.description) : (parts[0] ?? w.description),
      categoryId: withdrawalCategory(w.description),
      source: 'BANK_SYNC',
      counterpartyId: null,
      note: null,
      forecast: null,
      review: null,
    });
  }

  /* Scheduled: bills from the bank, recurring ones rolled forward through the forecast horizon. */
  const horizonEnd = addDays(today, FUTURE_DAYS);
  for (const b of snapshot.bills) {
    if (b.status === 'cancelled' || b.status === 'completed') continue;
    const merchant = Object.values(snapshot.merchants).find((m) => m.name === b.payee);
    const isVendorInvoice = b.nickname.toLowerCase().startsWith('vendor invoice');
    const categoryId = isVendorInvoice && merchant ? merchantCategory(merchant.category) : billCategory(`${b.nickname} ${b.payee}`);
    const description = isVendorInvoice ? 'Vendor invoice' : b.nickname;
    let due = parseIsoDate(b.upcoming_payment_date ?? b.payment_date);
    if (due.getTime() <= today.getTime()) {
      if (b.status === 'recurring') {
        const next = clampDayOfMonth(today.getUTCFullYear(), today.getUTCMonth(), b.recurring_date);
        due = next.getTime() > today.getTime() ? next : clampDayOfMonth(today.getUTCFullYear(), today.getUTCMonth() + 1, b.recurring_date);
      } else {
        due = addDays(today, 1); // an overdue one-off bill is assumed to be paid next
      }
    }
    const occurrences: Date[] = [];
    if (b.status === 'recurring') {
      for (let m = 0; m <= 13; m++) {
        const d = clampDayOfMonth(due.getUTCFullYear(), due.getUTCMonth() + m, b.recurring_date);
        if (d.getTime() > today.getTime() && d.getTime() <= horizonEnd.getTime()) occurrences.push(d);
      }
    } else {
      occurrences.push(due);
    }
    for (const d of occurrences) {
      const date = isoDate(d);
      transactions.push({
        id: occurrences.length > 1 ? `${b._id}:${date}` : b._id,
        accountId: b.account_id,
        date,
        postedDate: null,
        amount: round2(b.payment_amount),
        direction: 'OUTFLOW',
        status: 'SCHEDULED',
        paymentMethod: 'ACH',
        merchant: b.payee,
        description,
        categoryId,
        source: 'FORECAST',
        counterpartyId: null,
        note: null,
        forecast: { confidence: b.status === 'recurring' ? 0.95 : 0.9, source: 'BILL' },
        review: null,
      });
    }
  }

  /* Scheduled: recurring streams detected in the posted history, excluding bill payments (covered above). */
  const streamable = transactions.filter((t) => t.status === 'POSTED' && !(t.direction === 'OUTFLOW' && snapshot.withdrawals.some((w) => w._id === t.id && w.description.toLowerCase().startsWith('bill ·'))));
  transactions.push(...projectRecurring(streamable, today));

  /* Overlays: edits and decisions the bank cannot store. */
  for (const t of transactions) {
    const edit = overlays?.edits?.get(t.id);
    if (edit) {
      if (edit.categoryId) t.categoryId = edit.categoryId;
      if (edit.merchant?.trim()) t.merchant = edit.merchant.trim();
      if (edit.description?.trim()) t.description = edit.description.trim();
      if (edit.note !== undefined) t.note = edit.note?.trim() ? edit.note.trim() : null;
    }
    const review = overlays?.reviews?.get(t.id);
    if (review) t.review = { ...review };
  }

  transactions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));

  /* A default floor on the busiest checking account so the low-balance warning has a reference point. */
  const operating = accounts.filter((a) => a.type === 'CHECKING').sort((a, b) => (activity.get(b.id) ?? 0) - (activity.get(a.id) ?? 0))[0] ?? accounts[0];
  if (operating) {
    const since = isoDate(addDays(today, -89));
    const outflow90 = transactions.filter((t) => t.status === 'POSTED' && t.direction === 'OUTFLOW' && t.date >= since).reduce((s, t) => s + t.amount, 0);
    operating.minimumBalance = Math.max(1_000, Math.round((outflow90 / 3) * 0.5 / 1_000) * 1_000);
  }

  const businessType = user.onboarding.businessType ?? 'other';
  const ledger: Ledger = {
    profile: {
      id: workspace.nessieCustomerId,
      name: workspace.businessName,
      legalName: `${workspace.businessName} · ${businessTypeLabel(businessType)}`,
      operatingAccountId: operating?.id ?? '',
    },
    today: todayIso,
    generatedAt: nowIso,
    accounts,
    categories: CATEGORIES,
    customers: [...customers.values()],
    transactions,
    nextId: 1,
    financing: overlays?.financing ?? { applications: {}, saved: [] },
  };
  assessReviews(ledger, now);
  return ledger;
}
