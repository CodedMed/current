import type {
  BalancePoint,
  Breakdown,
  BreakdownSlice,
  CashAccount,
  CashInsight,
  CashPosition,
  CashTransaction,
  CashflowCompany,
  CashflowDashboard,
  CashflowFilters,
  CashflowKpis,
  ForecastHorizon,
  ForecastScenario,
  KpiDelta,
  MonthlyFlow,
  PeriodOption,
  ProjectionPoint,
  ResolvedPeriod,
  UpcomingCash,
  UpcomingItem,
} from '../../../../shared/types.ts';
import { addDays, daysBetween, isoDate, parseIsoDate } from '../../../lib/dates.ts';
import type { Ledger } from './ledger.ts';
import { CATEGORY_NAME } from './profiles.ts';
import { reviewQueue } from './review.ts';

const UPCOMING_WINDOW_DAYS = 30;
const FORECAST_FLOOR_DAYS = 90;
const DAILY_NOISE = 0.5;

const SCENARIOS: Record<ForecastScenario, { inflow: number; outflow: number; invoiceDelayDays: number }> = {
  expected: { inflow: 1, outflow: 1, invoiceDelayDays: 0 },
  conservative: { inflow: 0.85, outflow: 1.05, invoiceDelayDays: 7 },
  optimistic: { inflow: 1.1, outflow: 0.97, invoiceDelayDays: 0 },
};

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const monthName = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
const monthYear = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDate = (iso: string) => parseIsoDate(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const round2 = (n: number) => Math.round(n * 100) / 100;
const signed = (t: CashTransaction) => (t.direction === 'INFLOW' ? t.amount : -t.amount);

/* ───────────── Periods ───────────── */

export function periodOptions(today: Date): PeriodOption[] {
  const options: PeriodOption[] = [
    { id: 'last30', label: 'Last 30 days' },
    { id: 'last90', label: 'Last 90 days' },
  ];
  for (let i = 0; i < 6; i++) {
    const m = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    options.push({ id: isoDate(m).slice(0, 7), label: i === 0 ? `${monthYear(m)} (to date)` : monthYear(m) });
  }
  return options;
}

export function resolvePeriod(id: string, today: Date): ResolvedPeriod {
  if (id === 'last30' || id === 'last90') {
    const days = id === 'last30' ? 30 : 90;
    return { id, label: `Last ${days} days`, start: isoDate(addDays(today, -(days - 1))), end: isoDate(today), days, compareLabel: `vs prior ${days} days` };
  }
  const match = /^(\d{4})-(\d{2})$/.exec(id);
  if (!match) return resolvePeriod('last30', today);
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const start = new Date(Date.UTC(year, month, 1));
  if (start.getTime() > today.getTime()) return resolvePeriod('last30', today);
  const monthEnd = new Date(Date.UTC(year, month + 1, 0));
  const partial = monthEnd.getTime() > today.getTime();
  const end = partial ? today : monthEnd;
  return {
    id,
    label: partial ? `${monthYear(start)} (to date)` : monthYear(start),
    start: isoDate(start),
    end: isoDate(end),
    days: daysBetween(start, end) + 1,
    compareLabel: partial ? 'vs same days last month' : 'vs prior month',
  };
}

function compareWindow(period: ResolvedPeriod): { start: string; end: string } {
  const start = parseIsoDate(period.start);
  if (period.id === 'last30' || period.id === 'last90') {
    return { start: isoDate(addDays(start, -period.days)), end: isoDate(addDays(start, -1)) };
  }
  const prevStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
  const prevMonthEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 0));
  const prevEnd = addDays(prevStart, period.days - 1);
  return { start: isoDate(prevStart), end: isoDate(prevEnd.getTime() > prevMonthEnd.getTime() ? prevMonthEnd : prevEnd) };
}

/* ───────────── Flows & balances ───────────── */

function inRange(t: CashTransaction, start: string, end: string): boolean {
  return t.date >= start && t.date <= end;
}

function sumFlows(txns: CashTransaction[], start: string, end: string): { cashIn: number; cashOut: number } {
  let cashIn = 0;
  let cashOut = 0;
  for (const t of txns) {
    if (t.status !== 'POSTED' || !inRange(t, start, end)) continue;
    if (t.direction === 'INFLOW') cashIn += t.amount;
    else cashOut += t.amount;
  }
  return { cashIn: round2(cashIn), cashOut: round2(cashOut) };
}

function delta(value: number, prior: number): KpiDelta {
  return { pct: prior > 0 ? round2(((value - prior) / prior) * 100) : null, abs: round2(value - prior), prior: round2(prior) };
}

/** Walks posted activity backwards from today's book balance. */
function balanceHistory(startBalance: number, txns: CashTransaction[], today: Date, days: number): BalancePoint[] {
  const net = new Map<string, number>();
  for (const t of txns) {
    if (t.status !== 'POSTED') continue;
    net.set(t.date, (net.get(t.date) ?? 0) + signed(t));
  }
  const points: BalancePoint[] = [{ date: isoDate(today), balance: round2(startBalance) }];
  let balance = startBalance;
  for (let i = 1; i <= days; i++) {
    balance -= net.get(isoDate(addDays(today, -(i - 1)))) ?? 0;
    points.push({ date: isoDate(addDays(today, -i)), balance: round2(balance) });
  }
  return points.reverse();
}

function project(
  startBalance: number,
  txns: CashTransaction[],
  today: Date,
  horizonDays: number,
  scenario: ForecastScenario,
  avgDailyGross: number,
): ProjectionPoint[] {
  const s = SCENARIOS[scenario];
  const net = new Map<string, number>();
  const variance = new Map<string, number>();
  for (const t of txns) {
    if (t.status !== 'SCHEDULED') continue;
    let date = t.date;
    if (t.direction === 'INFLOW' && s.invoiceDelayDays > 0 && t.forecast?.source === 'INVOICE') {
      date = isoDate(addDays(parseIsoDate(date), s.invoiceDelayDays));
    }
    const offset = daysBetween(today, parseIsoDate(date));
    if (offset < 1 || offset > horizonDays) continue;
    const amount = t.amount * (t.direction === 'INFLOW' ? s.inflow : s.outflow);
    net.set(date, (net.get(date) ?? 0) + (t.direction === 'INFLOW' ? amount : -amount));
    const confidence = t.forecast?.confidence ?? 0.5;
    variance.set(date, (variance.get(date) ?? 0) + (t.amount * (1 - confidence)) ** 2);
  }
  const points: ProjectionPoint[] = [];
  let balance = startBalance;
  let totalVariance = 0;
  const noise = (DAILY_NOISE * avgDailyGross) ** 2;
  for (let i = 1; i <= horizonDays; i++) {
    const date = isoDate(addDays(today, i));
    balance += net.get(date) ?? 0;
    totalVariance += (variance.get(date) ?? 0) + noise;
    const sigma = Math.sqrt(totalVariance);
    points.push({ date, projected: Math.round(balance), low: Math.round(balance - sigma), high: Math.round(balance + sigma) });
  }
  return points;
}

function monthlyFlows(txns: CashTransaction[], today: Date, months: number): MonthlyFlow[] {
  const out: MonthlyFlow[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    const partial = end.getTime() > today.getTime();
    const flows = sumFlows(txns, isoDate(start), isoDate(partial ? today : end));
    out.push({
      month: isoDate(start).slice(0, 7),
      label: start.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
      cashIn: flows.cashIn,
      cashOut: flows.cashOut,
      partial,
    });
  }
  return out;
}

/* ───────────── Breakdown ───────────── */

function slices(entries: Map<string, { label: string; amount: number }>, limit: number, otherLabel: string): BreakdownSlice[] {
  const sorted = [...entries.entries()].map(([id, e]) => ({ id, label: e.label, amount: e.amount })).sort((a, b) => b.amount - a.amount);
  const total = sorted.reduce((sum, s) => sum + s.amount, 0);
  if (total <= 0) return [];
  const head = sorted.slice(0, limit);
  const tail = sorted.slice(limit);
  const otherAmount = tail.reduce((sum, s) => sum + s.amount, 0);
  const out: BreakdownSlice[] = head.map((s) => ({ id: s.id, label: s.label, amount: round2(s.amount), share: s.amount / total }));
  if (otherAmount > 0) out.push({ id: 'other', label: otherLabel, amount: round2(otherAmount), share: otherAmount / total });
  return out;
}

function breakdown(ledger: Ledger, txns: CashTransaction[], period: ResolvedPeriod): Breakdown {
  const byCategoryOut = new Map<string, { label: string; amount: number }>();
  const byCategoryIn = new Map<string, { label: string; amount: number }>();
  const byCustomer = new Map<string, { label: string; amount: number }>();
  const customerName = new Map(ledger.customers.map((c) => [c.id, c.name]));
  let totalIn = 0;
  let totalOut = 0;
  for (const t of txns) {
    if (t.status !== 'POSTED' || !inRange(t, period.start, period.end)) continue;
    const label = CATEGORY_NAME[t.categoryId] ?? t.categoryId;
    if (t.direction === 'OUTFLOW') {
      totalOut += t.amount;
      const e = byCategoryOut.get(t.categoryId) ?? { label, amount: 0 };
      e.amount += t.amount;
      byCategoryOut.set(t.categoryId, e);
    } else {
      totalIn += t.amount;
      const e = byCategoryIn.get(t.categoryId) ?? { label, amount: 0 };
      e.amount += t.amount;
      byCategoryIn.set(t.categoryId, e);
      const key = t.counterpartyId ?? '__other';
      const c = byCustomer.get(key) ?? { label: t.counterpartyId ? (customerName.get(t.counterpartyId) ?? t.merchant) : 'Other sources', amount: 0 };
      c.amount += t.amount;
      byCustomer.set(key, c);
    }
  }
  // "Other sources" (payouts, marketplace, interest) always folds into the tail.
  const customers = new Map([...byCustomer.entries()].filter(([k]) => k !== '__other'));
  const otherSources = byCustomer.get('__other')?.amount ?? 0;
  const customerSlices = slices(customers, 5, 'Other customers');
  if (otherSources > 0) {
    const total = customerSlices.reduce((s, x) => s + x.amount, 0) + otherSources;
    for (const s of customerSlices) s.share = s.amount / total;
    customerSlices.push({ id: 'other_sources', label: 'Payouts, marketplace & other', amount: round2(otherSources), share: otherSources / total });
  }
  return {
    cashOut: slices(byCategoryOut, 5, 'Everything else'),
    cashIn: slices(byCategoryIn, 5, 'Everything else'),
    byCustomer: customerSlices,
    totalOut: round2(totalOut),
    totalIn: round2(totalIn),
  };
}

/* ───────────── Upcoming ───────────── */

function upcoming(txns: CashTransaction[], today: Date): UpcomingCash {
  const windowEnd = isoDate(addDays(today, UPCOMING_WINDOW_DAYS));
  const todayIso = isoDate(today);
  const items: UpcomingItem[] = txns
    .filter((t) => t.status === 'SCHEDULED' && t.date > todayIso && t.date <= windowEnd && t.forecast?.source !== 'MODEL')
    .map((t) => ({
      id: t.id,
      date: t.date,
      merchant: t.merchant,
      description: t.description,
      amount: t.amount,
      direction: t.direction,
      categoryId: t.categoryId,
      categoryName: CATEGORY_NAME[t.categoryId] ?? t.categoryId,
      accountId: t.accountId,
      confidence: t.forecast?.confidence ?? 1,
      source: t.forecast?.source ?? 'MANUAL',
    }));
  const inflows = items.filter((i) => i.direction === 'INFLOW');
  const outflows = items.filter((i) => i.direction === 'OUTFLOW');
  const expectedIn = round2(inflows.reduce((s, i) => s + i.amount, 0));
  const expectedOut = round2(outflows.reduce((s, i) => s + i.amount, 0));
  return {
    windowDays: UPCOMING_WINDOW_DAYS,
    windowEnd,
    inflows,
    outflows,
    inflowCount: inflows.length,
    outflowCount: outflows.length,
    expectedIn,
    expectedOut,
    netImpact: round2(expectedIn - expectedOut),
  };
}

/* ───────────── Insights ───────────── */

function insights(ledger: Ledger, accounts: CashAccount[], txns: CashTransaction[], today: Date, totalCash: number, avgDailyGross: number): CashInsight[] {
  const out: CashInsight[] = [];
  const todayIso = isoDate(today);

  // Vendor bills that look unusual and are waiting on a decision.
  const flagged = txns.filter((t) => t.review?.status === 'open').sort((a, b) => (a.date < b.date ? 1 : -1));
  const first = flagged[0];
  if (first?.review) {
    const r = first.review;
    const lead =
      r.reason === 'possible_duplicate'
        ? `${first.merchant} appears to have billed ${usd.format(first.amount)} twice within a few days`
        : `${first.merchant} billed ${usd.format(first.amount)}, about ${Math.abs(Math.round(r.deviationPct))}% ${r.deviation > 0 ? 'above' : 'below'} its usual ${usd.format(r.expected)}`;
    const inQuestion = flagged.reduce((s, t) => s + (t.review?.reason === 'possible_duplicate' ? t.amount : Math.abs(t.review?.deviation ?? 0)), 0);
    out.push({
      id: 'review',
      kind: 'review',
      tone: 'warning',
      title: `${flagged.length} vendor bill${flagged.length === 1 ? '' : 's'} look${flagged.length === 1 ? 's' : ''} unusual`,
      body: `${lead}${flagged.length > 1 ? `, and ${flagged.length - 1} more need${flagged.length - 1 === 1 ? 's' : ''} a look` : ''}.`,
      figures: [
        { label: 'Waiting for review', value: String(flagged.length), emphasis: true },
        { label: 'Amount in question', value: usd.format(inQuestion) },
      ],
      accountId: null,
      date: null,
    });
  }

  // Low balance: per-account expected projection over 90 days against its floor.
  for (const account of accounts) {
    if (account.minimumBalance === null) continue;
    const own = txns.filter((t) => t.accountId === account.id);
    const path = project(account.bookBalance, own, today, FORECAST_FLOOR_DAYS, 'expected', avgDailyGross / Math.max(1, accounts.length));
    const breach = path.find((p) => p.projected < (account.minimumBalance as number));
    if (!breach) continue;
    out.push({
      id: `low_balance:${account.id}`,
      kind: 'low_balance',
      tone: 'warning',
      title: 'Low balance predicted',
      body: `${account.name} may fall below ${usd.format(account.minimumBalance)} on ${shortDate(breach.date)}.`,
      figures: [
        { label: 'Projected balance', value: usd.format(breach.projected), emphasis: true },
        { label: 'Minimum you set', value: usd.format(account.minimumBalance) },
      ],
      accountId: account.id,
      date: breach.date,
    });
    if (out.length >= 2) break;
  }

  // Large payment: biggest non-routine outflow (bills, invoices, manual entries) in the next 30 days.
  const windowEnd = isoDate(addDays(today, UPCOMING_WINDOW_DAYS));
  const big = txns
    .filter(
      (t) =>
        t.status === 'SCHEDULED' &&
        t.direction === 'OUTFLOW' &&
        t.date > todayIso &&
        t.date <= windowEnd &&
        t.forecast?.source !== 'MODEL' &&
        t.forecast?.source !== 'RECURRING',
    )
    .sort((a, b) => b.amount - a.amount)[0];
  if (big && big.amount >= Math.max(10_000, totalCash * 0.04)) {
    out.push({
      id: `large_payment:${big.id}`,
      kind: 'large_payment',
      tone: 'warning',
      title: 'Large payment upcoming',
      body: `${big.description} to ${big.merchant}.`,
      figures: [
        { label: 'Amount', value: usd.format(big.amount), emphasis: true },
        { label: 'Due', value: shortDate(big.date) },
      ],
      accountId: big.accountId,
      date: big.date,
    });
  }

  // Spending anomaly: last 30 days vs the average of the three prior full months, per merchant.
  const last30Start = isoDate(addDays(today, -29));
  const threeMonthsStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 3, 1));
  const thisMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const recent = new Map<string, number>();
  const prior = new Map<string, { total: number; months: Set<string> }>();
  for (const t of txns) {
    if (t.status !== 'POSTED' || t.direction !== 'OUTFLOW') continue;
    if (t.date >= last30Start) recent.set(t.merchant, (recent.get(t.merchant) ?? 0) + t.amount);
    if (t.date >= isoDate(threeMonthsStart) && t.date < isoDate(thisMonthStart)) {
      const p = prior.get(t.merchant) ?? { total: 0, months: new Set<string>() };
      p.total += t.amount;
      p.months.add(t.date.slice(0, 7));
      prior.set(t.merchant, p);
    }
  }
  const anomalies: Array<{ merchant: string; current: number; average: number; ratio: number }> = [];
  for (const [merchant, current] of recent) {
    const p = prior.get(merchant);
    if (!p || p.months.size < 3) continue;
    const average = p.total / 3;
    if (current >= 1_000 && current >= average * 1.15) anomalies.push({ merchant, current, average, ratio: current / average });
  }
  anomalies.sort((a, b) => b.ratio - a.ratio);
  for (const a of anomalies.slice(0, 1)) {
    out.push({
      id: `spend_anomaly:${a.merchant}`,
      kind: 'spend_anomaly',
      tone: 'warning',
      title: `${a.merchant} spend increased`,
      body: `${a.merchant} charges are ${Math.round((a.ratio - 1) * 100)}% above your three-month average.`,
      figures: [
        { label: '3-month average', value: usd.format(a.average) },
        { label: 'Last 30 days', value: usd.format(a.current), emphasis: true },
      ],
      accountId: null,
      date: null,
    });
  }

  // Trend: last full month vs the one before.
  const lastMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const lastMonthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
  const prevMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 2, 1));
  const prevMonthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 0));
  const last = sumFlows(txns, isoDate(lastMonthStart), isoDate(lastMonthEnd));
  const prev = sumFlows(txns, isoDate(prevMonthStart), isoDate(prevMonthEnd));
  const lastNet = last.cashIn - last.cashOut;
  const prevNet = prev.cashIn - prev.cashOut;
  const improving = lastNet > prevNet;
  const change = prevNet !== 0 ? Math.round(((lastNet - prevNet) / Math.abs(prevNet)) * 100) : null;
  out.push({
    id: 'trend',
    kind: 'trend',
    tone: improving ? 'positive' : 'warning',
    title: improving ? 'Cash flow improving' : 'Cash flow declining',
    body: `Net cash flow ${improving ? 'rose' : 'fell'} from ${usd.format(prevNet)} in ${monthName(prevMonthStart)} to ${usd.format(lastNet)} in ${monthName(lastMonthStart)}.`,
    figures: [
      { label: monthName(prevMonthStart), value: usd.format(prevNet) },
      { label: monthName(lastMonthStart), value: usd.format(lastNet), emphasis: true },
      ...(change !== null ? [{ label: 'Change', value: `${change > 0 ? '+' : ''}${change}%` }] : []),
    ],
    accountId: null,
    date: null,
  });

  // Customer concentration over the last 90 days.
  const ninetyStart = isoDate(addDays(today, -89));
  const byCustomer = new Map<string, number>();
  let inflow90 = 0;
  for (const t of txns) {
    if (t.status !== 'POSTED' || t.direction !== 'INFLOW' || t.date < ninetyStart) continue;
    inflow90 += t.amount;
    if (t.counterpartyId) byCustomer.set(t.counterpartyId, (byCustomer.get(t.counterpartyId) ?? 0) + t.amount);
  }
  const top = [...byCustomer.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && inflow90 > 0 && top[1] / inflow90 >= 0.2) {
    const name = ledger.customers.find((c) => c.id === top[0])?.name ?? top[0];
    out.push({
      id: `concentration:${top[0]}`,
      kind: 'concentration',
      tone: 'info',
      title: 'Customer concentration',
      body: `${name} made up ${Math.round((top[1] / inflow90) * 100)}% of cash in over the last 90 days.`,
      figures: [
        { label: name, value: usd.format(top[1]), emphasis: true },
        { label: 'All cash in', value: usd.format(inflow90) },
      ],
      accountId: null,
      date: null,
    });
  }

  // Connections that need attention.
  for (const account of accounts) {
    if (account.connectionStatus !== 'RECONNECT_REQUIRED') continue;
    const days = Math.max(1, Math.round((today.getTime() - new Date(account.lastSyncedAt).getTime()) / 86_400_000));
    out.push({
      id: `connection:${account.id}`,
      kind: 'connection',
      tone: 'danger',
      title: `Reconnect ${account.institutionName}`,
      body: `${account.name} stopped syncing ${days} day${days === 1 ? '' : 's'} ago, so its balance may be stale.`,
      figures: [{ label: 'Last synced', value: shortDate(account.lastSyncedAt.slice(0, 10)) }],
      accountId: account.id,
      date: null,
    });
  }

  return out;
}

/* ───────────── Dashboard ───────────── */

export function buildDashboard(ledger: Ledger, filters: CashflowFilters, companies: CashflowCompany[]): CashflowDashboard {
  const today = parseIsoDate(ledger.today);
  const todayIso = ledger.today;

  const wanted = filters.accountIds ? new Set(filters.accountIds) : null;
  const selected = wanted ? ledger.accounts.filter((a) => wanted.has(a.id)) : ledger.accounts;
  const accounts = selected.length > 0 ? selected : ledger.accounts;
  const accountIds = new Set(accounts.map((a) => a.id));
  const txns = ledger.transactions.filter((t) => t.accountId && accountIds.has(t.accountId));

  const period = resolvePeriod(filters.period, today);
  const compare = compareWindow(period);
  const current = sumFlows(txns, period.start, period.end);
  const prior = sumFlows(txns, compare.start, compare.end);

  const book = round2(accounts.reduce((s, a) => s + a.bookBalance, 0));
  const available = round2(accounts.reduce((s, a) => s + a.availableBalance, 0));

  const horizon: ForecastHorizon = filters.horizon;
  const historyDays = Math.max(FORECAST_FLOOR_DAYS, horizon);
  const history = balanceHistory(book, txns, today, historyDays);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const lastMonthEndIso = isoDate(addDays(monthStart, -1));
  const startOfMonthBalance = history.find((p) => p.date === lastMonthEndIso)?.balance ?? history[0]?.balance ?? book;

  const last90 = sumFlows(txns, isoDate(addDays(today, -89)), todayIso);
  const avgDailyGross = (last90.cashIn + last90.cashOut) / 90;

  const projectionDays = Math.max(FORECAST_FLOOR_DAYS, horizon);
  const full = project(book, txns, today, projectionDays, filters.scenario, avgDailyGross);
  const forecast = full.slice(0, horizon);
  const lowest = full.reduce((min, p) => (p.projected < min.projected ? p : min), full[0] as ProjectionPoint);
  const end = forecast[forecast.length - 1] as ProjectionPoint;
  const checkpoints = [30, 60, 90].map((days) => {
    const p = full[days - 1] as ProjectionPoint;
    return { days, date: p.date, balance: p.projected };
  });

  // Runway on the last three full months.
  let runwayNet = 0;
  for (let i = 1; i <= 3; i++) {
    const s = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    const e = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i + 1, 0));
    const f = sumFlows(txns, isoDate(s), isoDate(e));
    runwayNet += f.cashIn - f.cashOut;
  }
  const averageMonthlyNet = round2(runwayNet / 3);

  const kpis: CashflowKpis = {
    totalCash: {
      book,
      available,
      pending: round2(available - book),
      changeThisMonth: round2(book - startOfMonthBalance),
      monthLabel: monthName(today),
      accountCount: accounts.length,
    },
    cashIn: { value: current.cashIn, delta: delta(current.cashIn, prior.cashIn) },
    cashOut: { value: current.cashOut, delta: delta(current.cashOut, prior.cashOut) },
    net: {
      value: round2(current.cashIn - current.cashOut),
      cashIn: current.cashIn,
      cashOut: current.cashOut,
      delta: delta(current.cashIn - current.cashOut, prior.cashIn - prior.cashOut),
    },
    runway: {
      state: averageMonthlyNet < 0 ? 'burning' : 'positive',
      months: averageMonthlyNet < 0 ? Math.round((book / -averageMonthlyNet) * 10) / 10 : null,
      averageMonthlyNet,
      basisMonths: 3,
    },
  };

  const cashPosition: CashPosition = {
    history,
    forecast,
    horizon,
    scenario: filters.scenario,
    today: { date: todayIso, balance: book },
    lowest,
    end,
    checkpoints,
  };

  const recentTransactions = txns
    .filter((t) => t.status === 'POSTED' || t.status === 'PENDING')
    .sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1))
    .slice(0, 8);

  const lastSyncedAt = accounts.reduce((latest, a) => (a.lastSyncedAt > latest ? a.lastSyncedAt : latest), accounts[0]?.lastSyncedAt ?? ledger.generatedAt);

  return {
    generatedAt: new Date().toISOString(),
    today: todayIso,
    company: { id: ledger.profile.id, name: ledger.profile.name, legalName: ledger.profile.legalName },
    companies,
    filters: { ...filters, accountIds: wanted && selected.length > 0 ? accounts.map((a) => a.id) : null },
    periods: periodOptions(today),
    period,
    kpis,
    cashPosition,
    monthlyFlows: monthlyFlows(txns, today, 6),
    upcoming: upcoming(txns, today),
    breakdown: breakdown(ledger, txns, period),
    accounts: ledger.accounts,
    categories: ledger.categories,
    insights: insights(ledger, accounts, txns, today, book, avgDailyGross),
    reviews: reviewQueue(ledger, txns),
    recentTransactions,
    lastSyncedAt,
    dataSource: { provider: 'mock', mode: 'sandbox', label: 'Sample data' },
  };
}
