import type {
  CashManagement,
  CategorySpend,
  DailyPoint,
  DashboardAccount,
  DashboardResponse,
  FeatureId,
  ForecastPoint,
  Receivable,
  ReportSummary,
  TransactionItem,
  UpcomingBill,
  VendorSummary,
  WeeklyFlow,
  WorkflowSuggestion,
} from '../../../shared/types.ts';
import { addDays, clampDayOfMonth, daysBetween, eachDay, isoDate, parseIsoDate, startOfToday, startOfWeek } from '../../lib/dates.ts';
import type { UserRecord, WorkspaceState } from '../../store/userStore.ts';
import { businessTypeLabel } from '../onboarding/catalog.ts';
import { INTERNAL_TRANSFER_PREFIX, isSettled, type NessieAccount, type NessieSnapshot } from '../nessie/types.ts';

/**
 * Transforms a raw Nessie snapshot into the dashboard model. Pure and
 * deterministic for a given snapshot + date, so it is easy to test and to
 * extend with real (non-demo) account data later.
 */

const HISTORY_DAYS = 90;
const FORECAST_DAYS = 30;
const RECENT_LIMIT = 8;

const money = (n: number): number => Math.round(n * 100) / 100;
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const pctChange = (prev: number, curr: number): number | null => (prev > 0 ? money(((curr - prev) / prev) * 100) : null);

/* ───────────────────────── Classification ───────────────────────── */

function counterpartyOf(description: string): string {
  const parts = description.split('·').map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? (parts[parts.length - 1] as string) : description;
}

function incomeCategory(description: string): string {
  const d = description.toLowerCase();
  if (d.includes('retainer')) return 'Retainers';
  if (d.includes('invoice') || d.includes('milestone') || d.includes('progress draw') || d.includes('client payment')) return 'Client payments';
  if (d.includes('payout') || d.includes('settlement') || d.includes('sales') || d.includes('cash deposit') || d.includes('deposit')) return 'Sales';
  return 'Income';
}

function billCategory(text: string): string {
  const d = text.toLowerCase();
  if (/(rent|lease|office|membership|desk|suite|storage)/.test(d)) return 'Rent & occupancy';
  if (/(insurance|liability|health|workers)/.test(d)) return 'Insurance';
  if (/(energy|electric|gas|utilit|internet|phone|waste|hosting|aws)/.test(d)) return 'Utilities & telecom';
  if (/(loan|credit|card payment|installment|ford)/.test(d)) return 'Loan & card payments';
  if (/(payroll platform|gusto)/.test(d)) return 'Software';
  return 'Bills';
}

function withdrawalCategory(description: string): string {
  const d = description.toLowerCase();
  if (d.startsWith('bill ·')) return billCategory(description);
  if (d.includes('payroll')) return 'Payroll';
  if (d.includes('tax')) return 'Taxes';
  if (d.includes('owner draw')) return 'Owner draw';
  if (d.includes('subcontractor') || d.includes('contractor')) return 'Contractors';
  return 'Operations';
}

/* ───────────────────────── Normalisation ───────────────────────── */

interface Flow {
  item: TransactionItem;
  isBill: boolean;
}

function netExecuted(account: NessieAccount, s: NessieSnapshot): number {
  const id = account._id;
  const executed = <T extends { status: string }>(xs: T[]) => xs.filter((x) => isSettled(x.status));
  return (
    sum(executed(s.deposits).filter((d) => d.payee_id === id).map((d) => d.amount)) -
    sum(executed(s.withdrawals).filter((w) => w.payer_id === id).map((w) => w.amount)) -
    sum(executed(s.purchases).filter((p) => p.payer_id === id).map((p) => p.amount)) -
    sum(executed(s.transfers).filter((t) => t.payer_id === id).map((t) => t.amount)) +
    sum(executed(s.transfers).filter((t) => t.payee_id === id).map((t) => t.amount))
  );
}

function normaliseAccounts(snapshot: NessieSnapshot, workspace: WorkspaceState): DashboardAccount[] {
  return snapshot.accounts.map((a) => {
    const isCard = a.type === 'Credit Card';
    const balance = isCard || workspace.balancesApplied ? a.balance : a.balance + netExecuted(a, snapshot);
    return { id: a._id, nickname: a.nickname, type: a.type, balance: money(Math.abs(balance)) };
  });
}

function normaliseFlows(snapshot: NessieSnapshot, accountNames: Map<string, string>): Flow[] {
  const flows: Flow[] = [];
  for (const d of snapshot.deposits) {
    if (!isSettled(d.status)) continue;
    const internal = d.description.startsWith(INTERNAL_TRANSFER_PREFIX);
    flows.push({
      isBill: false,
      item: {
        id: d._id,
        date: d.transaction_date,
        description: d.description,
        counterparty: internal ? (accountNames.get(d.payee_id) ?? 'Reserve') : counterpartyOf(d.description),
        category: internal ? 'Transfers' : incomeCategory(d.description),
        amount: money(d.amount),
        direction: internal ? 'internal' : 'in',
        kind: internal ? 'transfer' : 'deposit',
        accountId: d.payee_id,
      },
    });
  }
  for (const p of snapshot.purchases) {
    if (!isSettled(p.status)) continue;
    const merchant = snapshot.merchants[p.merchant_id] ?? { name: 'Merchant', category: 'Other' };
    flows.push({
      isBill: false,
      item: {
        id: p._id,
        date: p.purchase_date,
        description: p.description ? `${p.description} · ${merchant.name}` : merchant.name,
        counterparty: merchant.name,
        category: merchant.category,
        amount: money(p.amount),
        direction: 'out',
        kind: 'purchase',
        accountId: p.payer_id,
      },
    });
  }
  for (const w of snapshot.withdrawals) {
    if (!isSettled(w.status)) continue;
    const isBill = w.description.toLowerCase().startsWith('bill ·');
    const internal = w.description.startsWith(INTERNAL_TRANSFER_PREFIX);
    flows.push({
      isBill,
      item: {
        id: w._id,
        date: w.transaction_date,
        description: w.description,
        counterparty: counterpartyOf(w.description),
        category: internal ? 'Transfers' : withdrawalCategory(w.description),
        amount: money(w.amount),
        direction: internal ? 'internal' : 'out',
        kind: internal ? 'transfer' : 'withdrawal',
        accountId: w.payer_id,
      },
    });
  }
  for (const t of snapshot.transfers) {
    if (!isSettled(t.status)) continue;
    flows.push({
      isBill: false,
      item: {
        id: t._id,
        date: t.transaction_date,
        description: t.description,
        counterparty: (t.payee_id && accountNames.get(t.payee_id)) ?? 'Transfer',
        category: 'Transfers',
        amount: money(t.amount),
        direction: 'internal',
        kind: 'transfer',
        accountId: t.payer_id,
      },
    });
  }
  flows.sort((a, b) => (a.item.date < b.item.date ? 1 : a.item.date > b.item.date ? -1 : 0));
  return flows;
}

/* ───────────────────────── Aggregations ───────────────────────── */

interface DayAgg {
  inflow: number;
  outflow: number;
  billOutflow: number;
}

function aggregateByDay(flows: Flow[]): Map<string, DayAgg> {
  const map = new Map<string, DayAgg>();
  for (const { item, isBill } of flows) {
    if (item.direction === 'internal') continue;
    const agg = map.get(item.date) ?? { inflow: 0, outflow: 0, billOutflow: 0 };
    if (item.direction === 'in') agg.inflow += item.amount;
    else {
      agg.outflow += item.amount;
      if (isBill) agg.billOutflow += item.amount;
    }
    map.set(item.date, agg);
  }
  return map;
}

function buildHistory(byDay: Map<string, DayAgg>, cashOnHand: number, today: Date): DailyPoint[] {
  const days = eachDay(addDays(today, -(HISTORY_DAYS - 1)), today);
  const points: DailyPoint[] = days.map((d) => {
    const agg = byDay.get(isoDate(d));
    return { date: isoDate(d), inflow: money(agg?.inflow ?? 0), outflow: money(agg?.outflow ?? 0), balance: 0 };
  });
  // Walk backwards from today's known cash position.
  let balance = cashOnHand;
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i] as DailyPoint;
    p.balance = money(balance);
    balance = balance - p.inflow + p.outflow;
  }
  return points;
}

function buildWeeklyFlows(history: DailyPoint[]): WeeklyFlow[] {
  const weeks = new Map<string, WeeklyFlow>();
  for (const p of history) {
    const weekStart = isoDate(startOfWeek(parseIsoDate(p.date)));
    const w = weeks.get(weekStart) ?? { weekStart, label: shortLabel(weekStart), inflow: 0, outflow: 0 };
    w.inflow = money(w.inflow + p.inflow);
    w.outflow = money(w.outflow + p.outflow);
    weeks.set(weekStart, w);
  }
  return [...weeks.values()].slice(-12);
}

function shortLabel(iso: string): string {
  return parseIsoDate(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function windowTotals(flows: Flow[], from: Date, to: Date): { inflow: number; outflow: number } {
  const start = isoDate(from);
  const end = isoDate(to);
  let inflow = 0;
  let outflow = 0;
  for (const { item } of flows) {
    if (item.date < start || item.date > end) continue;
    if (item.direction === 'in') inflow += item.amount;
    else if (item.direction === 'out') outflow += item.amount;
  }
  return { inflow: money(inflow), outflow: money(outflow) };
}

function nextRecurringDate(day: number, from: Date): Date {
  const candidate = clampDayOfMonth(from.getUTCFullYear(), from.getUTCMonth(), day);
  return candidate.getTime() >= from.getTime() ? candidate : clampDayOfMonth(from.getUTCFullYear(), from.getUTCMonth() + 1, day);
}

function buildBills(snapshot: NessieSnapshot, today: Date): UpcomingBill[] {
  const bills: UpcomingBill[] = [];
  for (const b of snapshot.bills) {
    if (b.status === 'cancelled' || b.status === 'completed') continue;
    let due = parseIsoDate(b.upcoming_payment_date ?? b.payment_date);
    if (b.status === 'recurring' && due.getTime() < today.getTime()) due = nextRecurringDate(b.recurring_date, today);
    const daysUntilDue = daysBetween(today, due);
    if (daysUntilDue > 45) continue;
    bills.push({
      id: b._id,
      payee: b.payee,
      nickname: b.nickname,
      amount: money(b.payment_amount),
      dueDate: isoDate(due),
      daysUntilDue,
      recurring: b.status === 'recurring',
      status: b.status,
    });
  }
  return bills.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}

function buildReceivables(snapshot: NessieSnapshot, today: Date): Receivable[] {
  const items: Receivable[] = [];
  for (const d of snapshot.deposits) {
    if (d.status !== 'pending') continue;
    const parts = d.description.split('·').map((p) => p.trim());
    const reference = (parts[0] ?? '').replace(/^invoice\s+/i, '') || d._id.slice(-6).toUpperCase();
    const customer = parts[1] ?? counterpartyOf(d.description);
    const due = parseIsoDate(d.transaction_date);
    const daysUntilDue = daysBetween(today, due);
    items.push({
      id: d._id,
      customer,
      reference,
      amount: money(d.amount),
      dueDate: isoDate(due),
      daysUntilDue,
      status: daysUntilDue < 0 ? 'overdue' : daysUntilDue <= 7 ? 'due_soon' : 'open',
    });
  }
  return items.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}

function buildCategories(flows: Flow[], today: Date): CategorySpend[] {
  const currentStart = isoDate(addDays(today, -29));
  const priorStart = isoDate(addDays(today, -59));
  const current = new Map<string, number>();
  const prior = new Map<string, number>();
  for (const { item } of flows) {
    if (item.direction !== 'out') continue;
    if (item.date >= currentStart) current.set(item.category, (current.get(item.category) ?? 0) + item.amount);
    else if (item.date >= priorStart) prior.set(item.category, (prior.get(item.category) ?? 0) + item.amount);
  }
  const total = sum([...current.values()]);
  return [...current.entries()]
    .map(([category, amount]) => ({
      category,
      amount: money(amount),
      share: total > 0 ? money((amount / total) * 100) : 0,
      change: pctChange(prior.get(category) ?? 0, amount),
    }))
    .sort((a, b) => b.amount - a.amount);
}

function buildVendors(flows: Flow[], bills: UpcomingBill[]): VendorSummary[] {
  const vendors = new Map<string, VendorSummary>();
  for (const { item } of flows) {
    if (item.kind !== 'purchase') continue;
    const v = vendors.get(item.counterparty) ?? {
      id: item.counterparty.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: item.counterparty,
      category: item.category,
      spent90d: 0,
      payments: 0,
      lastPaid: item.date,
      nextDue: null,
    };
    v.spent90d = money(v.spent90d + item.amount);
    v.payments += 1;
    if (item.date > v.lastPaid) v.lastPaid = item.date;
    vendors.set(item.counterparty, v);
  }
  for (const bill of bills) {
    const v = vendors.get(bill.payee);
    if (v && !bill.recurring && !v.nextDue) v.nextDue = bill.dueDate;
  }
  return [...vendors.values()].sort((a, b) => b.spent90d - a.spent90d).slice(0, 8);
}

function buildForecast(
  history: DailyPoint[],
  byDay: Map<string, DayAgg>,
  bills: UpcomingBill[],
  receivables: Receivable[],
  cashOnHand: number,
  today: Date,
): ForecastPoint[] {
  const recent = history.slice(-56);
  const inflowByWeekday = Array.from({ length: 7 }, () => ({ total: 0, days: 0 }));
  const outflowByWeekday = Array.from({ length: 7 }, () => ({ total: 0, days: 0 }));
  const nets: number[] = [];
  for (const p of recent) {
    const wd = parseIsoDate(p.date).getUTCDay();
    const agg = byDay.get(p.date);
    const inflow = p.inflow;
    const nonBillOutflow = p.outflow - (agg?.billOutflow ?? 0);
    const inSlot = inflowByWeekday[wd] as { total: number; days: number };
    const outSlot = outflowByWeekday[wd] as { total: number; days: number };
    inSlot.total += inflow;
    inSlot.days += 1;
    outSlot.total += nonBillOutflow;
    outSlot.days += 1;
    nets.push(inflow - nonBillOutflow);
  }
  const mean = nets.length ? sum(nets) / nets.length : 0;
  const sigma = nets.length > 1 ? Math.sqrt(sum(nets.map((n) => (n - mean) ** 2)) / (nets.length - 1)) : 0;

  // Scheduled items inside the horizon.
  const scheduledOut = new Map<string, number>();
  for (const bill of bills) {
    let due = parseIsoDate(bill.dueDate);
    while (daysBetween(today, due) <= FORECAST_DAYS) {
      if (daysBetween(today, due) >= 1) scheduledOut.set(isoDate(due), (scheduledOut.get(isoDate(due)) ?? 0) + bill.amount);
      if (!bill.recurring) break;
      due = nextRecurringDate(due.getUTCDate(), addDays(due, 1));
    }
  }
  const scheduledIn = new Map<string, number>();
  for (const r of receivables) {
    // Overdue invoices are assumed to land mid-horizon at a discounted probability.
    const landing = r.daysUntilDue < 0 ? addDays(today, 10) : parseIsoDate(r.dueDate);
    if (daysBetween(today, landing) > FORECAST_DAYS) continue;
    const weight = r.status === 'overdue' ? 0.6 : 0.9;
    scheduledIn.set(isoDate(landing), (scheduledIn.get(isoDate(landing)) ?? 0) + r.amount * weight);
  }

  const points: ForecastPoint[] = [];
  let projected = cashOnHand;
  for (let t = 1; t <= FORECAST_DAYS; t++) {
    const d = addDays(today, t);
    const wd = d.getUTCDay();
    const inSlot = inflowByWeekday[wd] as { total: number; days: number };
    const outSlot = outflowByWeekday[wd] as { total: number; days: number };
    const expectedIn = inSlot.days ? inSlot.total / inSlot.days : 0;
    const expectedOut = outSlot.days ? outSlot.total / outSlot.days : 0;
    projected += expectedIn - expectedOut + (scheduledIn.get(isoDate(d)) ?? 0) - (scheduledOut.get(isoDate(d)) ?? 0);
    const band = 0.8 * sigma * Math.sqrt(t);
    points.push({ date: isoDate(d), projected: money(projected), low: money(projected - band), high: money(projected + band) });
  }
  return points;
}

function buildReport(flows: Flow[], categories: CategorySpend[], today: Date): ReportSummary {
  const current = windowTotals(flows, addDays(today, -29), today);
  const prior = windowTotals(flows, addDays(today, -59), addDays(today, -30));
  const net = money(current.inflow - current.outflow);
  return {
    periodLabel: `${shortLabel(isoDate(addDays(today, -29)))} – ${shortLabel(isoDate(today))}`,
    revenue: current.inflow,
    expenses: current.outflow,
    netIncome: net,
    margin: current.inflow > 0 ? money((net / current.inflow) * 100) : 0,
    revenueChange: pctChange(prior.inflow, current.inflow),
    expensesChange: pctChange(prior.outflow, current.outflow),
    topCategories: categories.slice(0, 5),
  };
}

function buildCashManagement(accounts: DashboardAccount[], monthlyOutflow: number, billsDue30d: number): CashManagement {
  const operating = sum(accounts.filter((a) => a.type === 'Checking').map((a) => a.balance));
  const reserve = sum(accounts.filter((a) => a.type === 'Savings').map((a) => a.balance));
  const card = sum(accounts.filter((a) => a.type === 'Credit Card').map((a) => a.balance));
  const target = money(monthlyOutflow);
  const coverage = target > 0 ? money((reserve / target) * 100) : 100;
  const idle = money(Math.max(0, operating - billsDue30d - monthlyOutflow * 0.5));
  const gap = Math.max(0, target - reserve);
  let suggestion: string;
  if (coverage < 60 && idle >= 500) {
    suggestion = `Your reserve covers ${Math.round(coverage)}% of one month of outflows. Moving ${fmtWhole(Math.min(idle, gap))} from operating today would ${idle >= gap ? 'close the gap' : 'close most of the gap'} without touching upcoming bills.`;
  } else if (coverage < 60) {
    suggestion = `Your reserve covers ${Math.round(coverage)}% of one month of outflows, and operating cash is committed for the next 30 days. A weekly sweep of about ${fmtWhole(gap / 13)} would reach the target in a quarter.`;
  } else if (idle > monthlyOutflow * 0.5) {
    suggestion = `About ${fmtWhole(idle)} in operating cash is not needed for the next 30 days. A scheduled sweep to reserves keeps it earning without touching bills.`;
  } else {
    suggestion = 'Operating cash and reserves are balanced against the next 30 days of commitments.';
  }
  return { operatingBalance: money(operating), reserveBalance: money(reserve), reserveTarget: target, reserveCoverage: coverage, idleCash: idle, cardBalance: money(card), suggestion };
}

function fmtWhole(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function buildWorkflows(features: FeatureId[], summary: { overdueReceivables: number; billsDue14d: number }): WorkflowSuggestion[] {
  const all: WorkflowSuggestion[] = [
    {
      id: 'invoice-reminders',
      feature: 'invoices',
      title: 'Automatic invoice reminders',
      description:
        summary.overdueReceivables > 0
          ? `Nudge customers 3 days before due and again at 7 days overdue. ${fmtWhole(summary.overdueReceivables)} is overdue right now.`
          : 'Nudge customers 3 days before an invoice is due and again at 7 days overdue.',
      trigger: 'Invoice due date approaches',
    },
    {
      id: 'reserve-sweep',
      feature: 'cash_management',
      title: 'Friday reserve sweep',
      description: 'Move operating cash above your 30-day buffer into reserves every Friday afternoon.',
      trigger: 'Every Friday at 3:00 pm',
    },
    {
      id: 'bill-approvals',
      feature: 'vendor_payments',
      title: 'Approval for large vendor bills',
      description: 'Route any vendor bill over $2,500 to you for a one-tap approval before it is scheduled.',
      trigger: 'New bill above $2,500',
    },
    {
      id: 'bill-pay-scheduling',
      feature: 'expenses',
      title: 'Schedule bills two days early',
      description:
        summary.billsDue14d > 0
          ? `Pay recurring bills two business days before they are due. ${fmtWhole(summary.billsDue14d)} is due in the next two weeks.`
          : 'Pay recurring bills two business days before they are due so nothing lands late.',
      trigger: 'Bill due in 2 business days',
    },
    {
      id: 'low-balance-alert',
      feature: 'forecasting',
      title: 'Low-balance early warning',
      description: 'Get an alert the moment the 30-day projection dips below your minimum operating balance.',
      trigger: 'Forecast crosses threshold',
    },
    {
      id: 'monday-summary',
      feature: 'reporting',
      title: 'Monday cash summary',
      description: 'A one-page snapshot of cash, inflows, outflows, and what is due, in your inbox every Monday.',
      trigger: 'Every Monday at 7:00 am',
    },
    {
      id: 'receivable-followup',
      feature: 'receivables',
      title: 'Receivables follow-up queue',
      description: 'Build a daily list of customers to call, ordered by amount and days overdue.',
      trigger: 'Every weekday at 9:00 am',
    },
  ];
  const chosen = all.filter((w) => features.includes(w.feature));
  const fallback = all.filter((w) => !chosen.includes(w));
  return [...chosen, ...fallback].slice(0, Math.max(3, Math.min(5, chosen.length + 1)));
}

/* ───────────────────────── Entry point ───────────────────────── */

export function buildDashboard(user: UserRecord, workspace: WorkspaceState, snapshot: NessieSnapshot, today: Date = startOfToday()): DashboardResponse {
  const features = user.onboarding.features;
  const has = (f: FeatureId) => features.includes(f);
  const businessType = user.onboarding.businessType ?? 'other';

  const accounts = normaliseAccounts(snapshot, workspace);
  const accountNames = new Map(accounts.map((a) => [a.id, a.nickname]));
  const flows = normaliseFlows(snapshot, accountNames);
  const byDay = aggregateByDay(flows);

  const cashOnHand = money(sum(accounts.filter((a) => a.type !== 'Credit Card').map((a) => a.balance)));
  const history = buildHistory(byDay, cashOnHand, today);
  const weeklyFlows = buildWeeklyFlows(history);

  const current = windowTotals(flows, addDays(today, -29), today);
  const prior = windowTotals(flows, addDays(today, -59), addDays(today, -30));
  const ninety = windowTotals(flows, addDays(today, -(HISTORY_DAYS - 1)), today);
  const monthlyOutflow = ninety.outflow / 3;
  const net30d = money(current.inflow - current.outflow);

  const bills = buildBills(snapshot, today);
  const receivables = buildReceivables(snapshot, today);
  const categories = buildCategories(flows, today);
  const billsDue14d = money(sum(bills.filter((b) => b.daysUntilDue <= 14).map((b) => b.amount)));
  const billsDue30d = money(sum(bills.filter((b) => b.daysUntilDue <= 30).map((b) => b.amount)));
  const openReceivables = money(sum(receivables.map((r) => r.amount)));
  const overdueReceivables = money(sum(receivables.filter((r) => r.status === 'overdue').map((r) => r.amount)));

  const summary = {
    cashOnHand,
    inflow30d: current.inflow,
    outflow30d: current.outflow,
    net30d,
    inflowChange: pctChange(prior.inflow, current.inflow),
    outflowChange: pctChange(prior.outflow, current.outflow),
    runwayMonths: net30d < 0 ? money(cashOnHand / -net30d) : null,
    billsDue14d,
    openReceivables,
    overdueReceivables,
  };

  const showBills = has('expenses') || has('vendor_payments');
  const showReceivables = has('receivables') || has('invoices');

  return {
    generatedAt: new Date().toISOString(),
    dataSource: { provider: 'nessie', mode: workspace.mode, customerId: workspace.nessieCustomerId },
    business: {
      name: workspace.businessName,
      ownerName: user.name,
      businessType,
      businessTypeLabel: businessTypeLabel(businessType),
      features: [...features],
    },
    accounts,
    summary,
    history,
    weeklyFlows,
    recentTransactions: flows.slice(0, RECENT_LIMIT).map((f) => f.item),
    forecast: has('forecasting') ? buildForecast(history, byDay, bills, receivables, cashOnHand, today) : null,
    receivables: showReceivables ? receivables : null,
    bills: showBills ? bills : null,
    categories: has('expenses') || has('reporting') ? categories : null,
    vendors: has('vendor_payments') ? buildVendors(flows, bills) : null,
    report: has('reporting') ? buildReport(flows, categories, today) : null,
    cashManagement: has('cash_management') ? buildCashManagement(accounts, monthlyOutflow, billsDue30d) : null,
    workflows: has('automation') ? buildWorkflows(features, summary) : null,
  };
}
