import { costOfOffer, estimateImpact } from '../../../../shared/lending.ts';
import type { CreditProfile, CreditTier, LoanApplication, LoanOffer, LoanOffersResponse, LoanPricing, LoanProductType } from '../../../../shared/types.ts';
import { addDays, daysBetween, isoDate, parseIsoDate } from '../../../lib/dates.ts';
import { badRequest, notFound } from '../../../lib/errors.ts';
import { buildDashboard } from './analytics.ts';
import type { Ledger } from './ledger.ts';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const compact = (n: number) => (Math.abs(n) >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : Math.abs(n) >= 1_000 ? `$${Math.round(n / 1_000)}K` : usd.format(n));
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round5k = (n: number) => Math.round(n / 5_000) * 5_000;
const round1k = (n: number) => Math.round(n / 1_000) * 1_000;
const shortDate = (iso: string) => parseIsoDate(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Present value of a level monthly payment stream: how much can be borrowed for a given payment. */
function presentValue(payment: number, apr: number, months: number): number {
  const r = apr / 100 / 12;
  return r === 0 ? payment * months : (payment * (1 - (1 + r) ** -months)) / r;
}

interface Snapshot {
  annualRevenue: number;
  monthlyRevenue: number;
  revenueGrowthPct: number | null;
  monthlyCashOut: number;
  stripeMonthly: number;
  paypalMonthly: number;
  cardSpendMonthly: number;
  debtService: number;
  equipment: { amount: number; description: string } | null;
  topCustomerShare: number;
  totalCash: number;
  monthlyBurn: number;
  runwayMonths: number | null;
  lowestProjectedCash: number;
  lowestDate: string;
  monthsToLowest: number;
  operatingAccountName: string;
  floorBreach: { accountName: string; floor: number; date: string; projected: number } | null;
}

function snapshot(ledger: Ledger): Snapshot {
  const today = parseIsoDate(ledger.today);
  const since = (days: number) => isoDate(addDays(today, -(days - 1)));
  const posted = ledger.transactions.filter((t) => t.status === 'POSTED');
  const sum = (pred: (t: (typeof posted)[number]) => boolean) => posted.reduce((s, t) => (pred(t) ? s + t.amount : s), 0);
  const y = since(365);
  const q = since(90);
  const prevQStart = since(180);
  const annualRevenue = sum((t) => t.direction === 'INFLOW' && t.date >= y);
  const lastQ = sum((t) => t.direction === 'INFLOW' && t.date >= q);
  const prevQ = sum((t) => t.direction === 'INFLOW' && t.date >= prevQStart && t.date < q);
  const byCustomer = new Map<string, number>();
  for (const t of posted) if (t.direction === 'INFLOW' && t.date >= q && t.counterpartyId) byCustomer.set(t.counterpartyId, (byCustomer.get(t.counterpartyId) ?? 0) + t.amount);
  const topCustomer = Math.max(0, ...byCustomer.values());
  const equipmentTxn = posted.filter((t) => t.direction === 'OUTFLOW' && t.categoryId === 'other_expenses' && t.amount >= 5_000 && t.date >= q).sort((a, b) => b.amount - a.amount)[0];

  const dash = buildDashboard(ledger, { companyId: ledger.profile.id, accountIds: null, period: 'last30', horizon: 90, scenario: 'expected' }, []);
  const burn = dash.kpis.runway.averageMonthlyNet < 0 ? -dash.kpis.runway.averageMonthlyNet : 0;
  const lowBalance = dash.insights.find((i) => i.kind === 'low_balance');
  const breachAccount = lowBalance?.accountId ? ledger.accounts.find((a) => a.id === lowBalance.accountId) : null;
  const breachProjected = lowBalance ? Number(lowBalance.figures[0]?.value.replace(/[^0-9.-]/g, '') ?? 0) : 0;

  return {
    annualRevenue,
    monthlyRevenue: annualRevenue / 12,
    revenueGrowthPct: prevQ > 0 ? ((lastQ - prevQ) / prevQ) * 100 : null,
    monthlyCashOut: sum((t) => t.direction === 'OUTFLOW' && t.date >= q) / 3,
    stripeMonthly: sum((t) => t.direction === 'INFLOW' && t.paymentMethod === 'STRIPE' && t.date >= q) / 3,
    paypalMonthly: sum((t) => t.direction === 'INFLOW' && t.paymentMethod === 'PAYPAL' && t.date >= q) / 3,
    cardSpendMonthly: sum((t) => t.direction === 'OUTFLOW' && t.paymentMethod === 'CREDIT_CARD' && t.date >= q) / 3,
    debtService: sum((t) => t.direction === 'OUTFLOW' && t.categoryId === 'loan_payments' && t.date >= q) / 3,
    equipment: equipmentTxn ? { amount: equipmentTxn.amount, description: equipmentTxn.description } : null,
    topCustomerShare: lastQ > 0 ? topCustomer / lastQ : 0,
    totalCash: dash.kpis.totalCash.book,
    monthlyBurn: burn,
    runwayMonths: dash.kpis.runway.months,
    lowestProjectedCash: dash.cashPosition.lowest.projected,
    lowestDate: dash.cashPosition.lowest.date,
    monthsToLowest: Math.max(0.5, daysBetween(today, parseIsoDate(dash.cashPosition.lowest.date)) / 30.4),
    operatingAccountName: ledger.accounts.find((a) => a.id === ledger.profile.operatingAccountId)?.name ?? 'your operating account',
    floorBreach: lowBalance && breachAccount && breachAccount.minimumBalance !== null && lowBalance.date ? { accountName: breachAccount.name, floor: breachAccount.minimumBalance, date: lowBalance.date, projected: breachProjected } : null,
  };
}

function creditProfile(s: Snapshot): CreditProfile {
  let score = 50;
  const factors: CreditProfile['factors'] = [];

  factors.push({ label: '12-month revenue', value: usd.format(s.annualRevenue), impact: s.annualRevenue >= 1_000_000 ? 'positive' : s.annualRevenue >= 250_000 ? 'neutral' : 'negative' });
  score += s.annualRevenue >= 1_000_000 ? 8 : s.annualRevenue >= 250_000 ? 3 : -8;

  if (s.monthlyBurn > 0) {
    factors.push({ label: 'Cash flow', value: `${usd.format(s.monthlyBurn)}/mo burn`, impact: 'negative' });
    score -= s.runwayMonths !== null && s.runwayMonths < 6 ? 20 : 10;
  } else {
    factors.push({ label: 'Cash flow', value: 'Positive for 3+ months', impact: 'positive' });
    score += 15;
  }

  const buffer = s.monthlyCashOut > 0 ? s.totalCash / s.monthlyCashOut : 0;
  factors.push({ label: 'Cash buffer', value: `${buffer.toFixed(1)} months of expenses`, impact: buffer >= 3 ? 'positive' : buffer >= 1.5 ? 'neutral' : 'negative' });
  score += buffer >= 3 ? 10 : buffer >= 1.5 ? 4 : -6;

  if (s.revenueGrowthPct !== null) {
    factors.push({ label: 'Revenue trend', value: `${s.revenueGrowthPct >= 0 ? '+' : ''}${s.revenueGrowthPct.toFixed(0)}% vs prior quarter`, impact: s.revenueGrowthPct > 5 ? 'positive' : s.revenueGrowthPct >= -2 ? 'neutral' : 'negative' });
    score += s.revenueGrowthPct > 5 ? 10 : s.revenueGrowthPct >= -2 ? 3 : -6;
  }

  factors.push({ label: 'Customer concentration', value: `Top customer ${Math.round(s.topCustomerShare * 100)}% of cash in`, impact: s.topCustomerShare < 0.2 ? 'positive' : s.topCustomerShare < 0.3 ? 'neutral' : 'negative' });
  score += s.topCustomerShare < 0.2 ? 4 : s.topCustomerShare < 0.3 ? 0 : -8;

  const leverage = s.monthlyRevenue > 0 ? s.debtService / s.monthlyRevenue : 0;
  factors.push({ label: 'Existing debt', value: s.debtService > 0 ? `${usd.format(s.debtService)}/mo, ${(leverage * 100).toFixed(0)}% of revenue` : 'None', impact: leverage < 0.05 ? 'positive' : leverage < 0.12 ? 'neutral' : 'negative' });
  score += leverage < 0.05 ? 5 : leverage < 0.12 ? 0 : -8;

  score = clamp(Math.round(score), 5, 98);
  const tier: CreditTier = score >= 70 ? 'A' : score >= 45 ? 'B' : 'C';
  const label = tier === 'A' ? 'Strong profile' : tier === 'B' ? 'Solid profile' : 'Building profile';
  const summary =
    tier === 'A'
      ? 'Profitable, growing, and well-buffered: banks will compete for this file.'
      : tier === 'B'
        ? 'Healthy revenue with one or two watch-points; expect bank and fintech offers with mid-range pricing.'
        : 'Lenders will lean on revenue and processing history; faster fintech products price in the risk.';

  return {
    tier,
    score,
    label,
    summary,
    factors,
    annualRevenue: Math.round(s.annualRevenue),
    monthlyRevenue: Math.round(s.monthlyRevenue),
    totalCash: s.totalCash,
    cashBufferMonths: Math.round(buffer * 10) / 10,
    monthlyBurn: Math.round(s.monthlyBurn),
    runwayMonths: s.runwayMonths,
    lowestProjectedCash: s.lowestProjectedCash,
    monthsToLowest: Math.round(s.monthsToLowest * 10) / 10,
    existingDebtService: Math.round(s.debtService),
  };
}

interface Draft {
  id: string;
  lenderId: string;
  lenderName: string;
  product: string;
  type: LoanProductType;
  maxAmount: number;
  minAmount: number;
  pricing: LoanPricing;
  rateLabel: string;
  termLabel: string;
  fundingDays: string;
  fitReason: string;
  highlights: string[];
  requirements: string[];
}

function drafts(s: Snapshot, p: CreditProfile): Draft[] {
  const adj = p.tier === 'A' ? 0 : p.tier === 'B' ? 1.5 : 3.5;
  const capacity = Math.max(0, 0.12 * s.monthlyRevenue - s.debtService);
  const burning = s.monthlyBurn > 0;
  const out: Draft[] = [];
  const bridge = s.floorBreach
    ? `Covers the projected dip in ${s.floorBreach.accountName} on ${shortDate(s.floorBreach.date)} without a fixed monthly payment.`
    : burning
      ? `Interest only on what you draw, so ${compact(s.monthlyBurn)} a month of burn stays covered without a fixed payment.`
      : `Keeps your ${compact(s.totalCash)} of cash untouched; you only pay for what you draw.`;

  if (p.tier !== 'C') {
    const apr = 9.75 + adj;
    out.push({
      id: 'chase-loc',
      lenderId: 'chase',
      lenderName: 'JPMorgan Chase',
      product: 'Business Line of Credit',
      type: 'LINE_OF_CREDIT',
      maxAmount: clamp(round5k(0.2 * s.annualRevenue), 25_000, 500_000),
      minAmount: 10_000,
      pricing: { kind: 'revolving', apr, termMonths: null, originationPct: 0, flatFeePct: null, holdbackPct: null, annualFee: 0, introMonths: null, remittanceBase: null },
      rateLabel: `${apr.toFixed(2)}% APR on drawn balance`,
      termLabel: 'Revolving · renews yearly',
      fundingDays: '5–7 business days',
      fitReason: bridge,
      highlights: ['Interest only on what you draw', 'Annual fee waived in year one', 'Same-day draws to your Chase account'],
      requirements: ['2+ years in business', '$250K+ annual revenue', 'Personal guarantee'],
    });
  }
  {
    const apr = 12.9 + adj;
    out.push({
      id: 'bluevine-loc',
      lenderId: 'bluevine',
      lenderName: 'Bluevine',
      product: 'Flex Line of Credit',
      type: 'LINE_OF_CREDIT',
      maxAmount: clamp(round5k(0.12 * s.annualRevenue), 6_000, 250_000),
      minAmount: 5_000,
      pricing: { kind: 'revolving', apr, termMonths: null, originationPct: 0, flatFeePct: null, holdbackPct: null, annualFee: 0, introMonths: null, remittanceBase: null },
      rateLabel: `${apr.toFixed(1)}% simple interest`,
      termLabel: 'Revolving · 6- or 12-month draws',
      fundingDays: 'Next business day',
      fitReason: burning ? 'Fastest to fund if the dip arrives sooner than forecast.' : 'A quick backstop for a slow-paying customer month.',
      highlights: ['Decision in minutes', 'No draw fees', 'Weekly or monthly repayment'],
      requirements: ['12+ months in business', '$40K+ monthly revenue', 'Personal guarantee'],
    });
  }
  if (p.tier !== 'C' && !burning) {
    const apr = 10.25 + adj * 0.5;
    const max = round5k(Math.min(clamp(1.2 * s.annualRevenue, 50_000, 2_000_000), presentValue(capacity, apr, 120)));
    if (max >= 50_000)
      out.push({
        id: 'wells-sba',
        lenderId: 'wells',
        lenderName: 'Wells Fargo',
        product: 'SBA 7(a) Term Loan',
        type: 'SBA_7A',
        maxAmount: max,
        minAmount: 50_000,
        pricing: { kind: 'amortized', apr, termMonths: 120, originationPct: 2.5, flatFeePct: null, holdbackPct: null, annualFee: 0, introMonths: null, remittanceBase: null },
        rateLabel: `${apr.toFixed(2)}% APR (Prime + 2.75%)`,
        termLabel: '10-year term',
        fundingDays: '30–45 days',
        fitReason: `Lowest monthly payment for the size, sized so debt service stays under 12% of your ${compact(s.monthlyRevenue)} monthly revenue.`,
        highlights: ['Government-guaranteed, so the rate is capped', 'No prepayment penalty after year three', 'Can fund hiring, expansion, or refinancing'],
        requirements: ['Debt service coverage of 1.25×', '2+ years in business', 'Personal guarantee and available collateral'],
      });
  }
  if (p.tier !== 'C') {
    const apr = 8.9 + adj;
    const max = round5k(Math.min(clamp(0.5 * s.annualRevenue, 25_000, 750_000), presentValue(capacity, apr, 48)));
    if (max >= 25_000)
      out.push({
        id: 'capone-term',
        lenderId: 'capitalone',
        lenderName: 'Capital One',
        product: 'Business Term Loan',
        type: 'TERM_LOAN',
        maxAmount: max,
        minAmount: 25_000,
        pricing: { kind: 'amortized', apr, termMonths: 48, originationPct: 1.5, flatFeePct: null, holdbackPct: null, annualFee: 0, introMonths: null, remittanceBase: null },
        rateLabel: `${apr.toFixed(2)}% fixed APR`,
        termLabel: '4-year term',
        fundingDays: '7–10 business days',
        fitReason: burning ? 'A fixed payment is harder to carry while burning cash; consider a line first.' : `Predictable payment for a one-time investment; ${s.revenueGrowthPct !== null && s.revenueGrowthPct > 0 ? 'your revenue trend supports it' : 'sized to your current revenue'}.`,
        highlights: ['Fixed rate and payment for the full term', 'Funds in one lump sum', 'Relationship pricing with a Capital One account'],
        requirements: ['2+ years in business', '$250K+ annual revenue', 'Personal guarantee'],
      });
  }
  {
    const apr = 11.4 + adj;
    const max = round5k(Math.min(clamp(0.35 * s.annualRevenue, 25_000, 500_000), presentValue(capacity, apr, 36)));
    if (max >= 25_000)
      out.push({
        id: 'fc-term',
        lenderId: 'fundingcircle',
        lenderName: 'Funding Circle',
        product: 'Term Loan',
        type: 'TERM_LOAN',
        maxAmount: max,
        minAmount: 25_000,
        pricing: { kind: 'amortized', apr, termMonths: 36, originationPct: 3.5, flatFeePct: null, holdbackPct: null, annualFee: 0, introMonths: null, remittanceBase: null },
        rateLabel: `${apr.toFixed(2)}% fixed APR`,
        termLabel: '3-year term',
        fundingDays: '3–5 business days',
        fitReason: 'Faster than a bank term loan; costs more in origination.',
        highlights: ['Decision within 24 hours', 'No prepayment penalty', 'Dedicated account manager'],
        requirements: ['2+ years in business', 'No bankruptcies in 7 years', 'Personal guarantee'],
      });
  }
  if (s.stripeMonthly > 0) {
    const fee = 7 + adj * 0.5;
    out.push({
      id: 'stripe-capital',
      lenderId: 'stripe',
      lenderName: 'Stripe',
      product: 'Stripe Capital',
      type: 'REVENUE_BASED',
      maxAmount: clamp(round1k(2 * s.stripeMonthly), 5_000, 300_000),
      minAmount: 5_000,
      pricing: { kind: 'revenue_share', apr: null, termMonths: null, originationPct: 0, flatFeePct: fee, holdbackPct: 12, annualFee: 0, introMonths: null, remittanceBase: Math.round(s.stripeMonthly) },
      rateLabel: `${fee.toFixed(1)}% flat fee`,
      termLabel: `Repaid from 12% of Stripe payouts (~${compact(s.stripeMonthly)}/mo)`,
      fundingDays: '1–2 business days',
      fitReason: `Repayment flexes with your ${compact(s.stripeMonthly)} a month of Stripe payouts: slower months mean smaller payments.`,
      highlights: ['No credit check or personal guarantee', 'One flat fee, no compounding interest', 'Automatic repayment from payouts'],
      requirements: ['6+ months of Stripe processing', 'Consistent payout volume'],
    });
  }
  if (s.paypalMonthly > 0) {
    const fee = 5.5 + adj * 0.5;
    out.push({
      id: 'paypal-wc',
      lenderId: 'paypal',
      lenderName: 'PayPal',
      product: 'Working Capital',
      type: 'REVENUE_BASED',
      maxAmount: clamp(round1k(2 * s.paypalMonthly), 1_000, 150_000),
      minAmount: 1_000,
      pricing: { kind: 'revenue_share', apr: null, termMonths: null, originationPct: 0, flatFeePct: fee, holdbackPct: 15, annualFee: 0, introMonths: null, remittanceBase: Math.round(s.paypalMonthly) },
      rateLabel: `${fee.toFixed(1)}% flat fee`,
      termLabel: `Repaid from 15% of PayPal sales (~${compact(s.paypalMonthly)}/mo)`,
      fundingDays: 'Minutes after approval',
      fitReason: 'Small and fast; sized to your marketplace volume rather than the whole business.',
      highlights: ['No credit check', 'Repayment pauses when sales pause', 'Funds go straight to your PayPal balance'],
      requirements: ['PayPal Business account for 90+ days', '$15K+ annual PayPal sales'],
    });
  }
  if (s.cardSpendMonthly > 0) {
    const apr = 18.24 + adj;
    const intro = p.tier === 'A' ? 12 : p.tier === 'B' ? 6 : null;
    const points = Math.round((s.cardSpendMonthly * 12 * 2.6) / 1_000) * 1_000;
    out.push({
      id: 'amex-gold',
      lenderId: 'amex',
      lenderName: 'American Express',
      product: 'Business Gold Card',
      type: 'BUSINESS_CARD',
      maxAmount: clamp(round5k(3 * s.cardSpendMonthly), 10_000, 150_000),
      minAmount: 10_000,
      pricing: { kind: 'charge_card', apr, termMonths: null, originationPct: 0, flatFeePct: null, holdbackPct: null, annualFee: 375, introMonths: intro, remittanceBase: null },
      rateLabel: intro ? `0% intro APR for ${intro} months, then ${apr.toFixed(2)}%` : `${apr.toFixed(2)}% APR on pay-over-time balances`,
      termLabel: 'Charge card · pay in full or over time',
      fundingDays: '7–10 days for the card',
      fitReason: `Your ${compact(s.cardSpendMonthly)} a month of software, cloud, and ad spend would earn roughly ${points.toLocaleString('en-US')} points a year.`,
      highlights: ['4× points on your top two spend categories', 'Pay Over Time on eligible charges', 'Employee cards at no extra cost'],
      requirements: ['Good personal credit', 'Personal guarantee'],
    });
  }
  if (s.totalCash >= 50_000) {
    out.push({
      id: 'brex-card',
      lenderId: 'brex',
      lenderName: 'Brex',
      product: 'Brex Card',
      type: 'BUSINESS_CARD',
      maxAmount: clamp(round5k(Math.min(15 * s.cardSpendMonthly, 0.3 * s.totalCash)), 10_000, 500_000),
      minAmount: 10_000,
      pricing: { kind: 'charge_card', apr: null, termMonths: null, originationPct: 0, flatFeePct: null, holdbackPct: null, annualFee: 0, introMonths: null, remittanceBase: null },
      rateLabel: 'No interest · statement paid monthly',
      termLabel: 'Charge card · limit backed by cash balance',
      fundingDays: 'Virtual card same day',
      fitReason: `Limit scales with your ${compact(s.totalCash)} in cash; no personal guarantee required.`,
      highlights: ['No personal guarantee', 'Limit grows with your balance', 'Spend controls and receipt matching built in'],
      requirements: ['Registered US business', '$50K+ in business bank balances'],
    });
  }
  if (s.equipment) {
    const apr = 7.9 + adj;
    out.push({
      id: 'truist-equipment',
      lenderId: 'truist',
      lenderName: 'Truist',
      product: 'Equipment Financing',
      type: 'EQUIPMENT',
      maxAmount: clamp(round5k(Math.max(s.equipment.amount * 3, 25_000)), 25_000, 250_000),
      minAmount: 10_000,
      pricing: { kind: 'amortized', apr, termMonths: 60, originationPct: 1, flatFeePct: null, holdbackPct: null, annualFee: 0, introMonths: null, remittanceBase: null },
      rateLabel: `${apr.toFixed(2)}% fixed APR`,
      termLabel: '5-year term · equipment as collateral',
      fundingDays: '5–10 business days',
      fitReason: `Spread purchases like the recent ${usd.format(s.equipment.amount)} ${s.equipment.description.toLowerCase()} over five years instead of paying cash.`,
      highlights: ['Up to 100% of equipment cost', 'Equipment is the collateral, no blanket lien', 'Section 179 tax treatment may apply'],
      requirements: ['Invoice or quote for the equipment', '2+ years in business'],
    });
  }
  return out;
}

function nextSteps(lenderId: string, accountName: string, fundingDays: string): string[] {
  const bank = ['chase', 'wells', 'capitalone', 'truist'].includes(lenderId);
  return bank
    ? [
        'A business banker reviews the application within 1 business day.',
        'Six months of statements are shared from your connected accounts; no uploads needed.',
        'Sign the personal guarantee and closing documents electronically.',
        `Funds land in ${accountName} in ${fundingDays}.`,
      ]
    : ['Instant decision in most cases using your connected account data.', 'Review and accept the final terms.', `Funds land in ${accountName} in ${fundingDays}.`];
}

export function buildLoanOffers(ledger: Ledger): LoanOffersResponse {
  const s = snapshot(ledger);
  const profile = creditProfile(s);
  const burning = s.monthlyBurn > 0;
  const list = drafts(s, profile);

  const recommendedId =
    (burning ? list.find((d) => d.id === 'chase-loc')?.id ?? list.find((d) => d.type === 'LINE_OF_CREDIT')?.id : null) ??
    (s.revenueGrowthPct !== null && s.revenueGrowthPct > 0 ? list.find((d) => d.id === 'wells-sba')?.id : null) ??
    list.find((d) => d.id === 'capone-term')?.id ??
    list.find((d) => d.type === 'LINE_OF_CREDIT')?.id ??
    list[0]?.id ??
    null;

  const offers: LoanOffer[] = list.map((d) => {
    const application = ledger.financing.applications[d.id] ?? null;
    const amount = application?.amount ?? d.maxAmount;
    const cost = costOfOffer(d.pricing, amount);
    return {
      id: d.id,
      lenderId: d.lenderId,
      lenderName: d.lenderName,
      product: d.product,
      type: d.type,
      amount,
      minAmount: Math.min(d.minAmount, d.maxAmount),
      maxAmount: d.maxAmount,
      rateLabel: d.rateLabel,
      termLabel: d.termLabel,
      fundingDays: d.fundingDays,
      pricing: d.pricing,
      cost,
      impact: estimateImpact(profile, cost, amount),
      fitReason: d.fitReason,
      highlights: d.highlights,
      requirements: d.requirements,
      recommended: d.id === recommendedId,
      saved: ledger.financing.saved.includes(d.id),
      application,
    };
  });
  // Recommended first, then the cheapest offer of each product type in priority
  // order, then everything else by cost per dollar borrowed.
  const priority: LoanProductType[] = ['LINE_OF_CREDIT', 'SBA_7A', 'TERM_LOAN', 'REVENUE_BASED', 'BUSINESS_CARD', 'EQUIPMENT'];
  const ratio = (o: LoanOffer) => o.cost.totalCost / o.amount;
  const ordered: LoanOffer[] = [];
  const recommended = offers.find((o) => o.recommended);
  if (recommended) ordered.push(recommended);
  for (const type of priority) {
    const best = offers.filter((o) => o.type === type && !ordered.includes(o)).sort((a, b) => ratio(a) - ratio(b))[0];
    if (best) ordered.push(best);
  }
  for (const o of offers.filter((o) => !ordered.includes(o)).sort((a, b) => ratio(a) - ratio(b))) ordered.push(o);
  offers.splice(0, offers.length, ...ordered);

  const headline = s.floorBreach
    ? 'Bridge the dip before it lands'
    : burning
      ? 'Extend your runway on your terms'
      : 'Fund growth without touching your reserve';
  const subheadline = s.floorBreach
    ? `${s.floorBreach.accountName} is projected to fall below its ${usd.format(s.floorBreach.floor)} floor on ${shortDate(s.floorBreach.date)}. Offers below are sized and priced from your last 12 months.`
    : burning
      ? `At ${usd.format(s.monthlyBurn)} a month of burn, these offers are sized to add months of runway with the least fixed cost.`
      : `Matched to ${usd.format(s.annualRevenue)} of revenue over the last 12 months and ${profile.cashBufferMonths.toFixed(1)} months of cash buffer.`;

  return { generatedAt: new Date().toISOString(), companyId: ledger.profile.id, headline, subheadline, profile, offers, recommendedOfferId: recommendedId };
}

export function applyForLoan(ledger: Ledger, offerId: string, amount: number, now: Date = new Date()): LoanOffer {
  const response = buildLoanOffers(ledger);
  const offer = response.offers.find((o) => o.id === offerId);
  if (!offer) throw notFound('That offer is no longer available.');
  if (offer.application) throw badRequest('An application for this offer has already been started.');
  if (amount < offer.minAmount || amount > offer.maxAmount) throw badRequest(`Choose an amount between ${usd.format(offer.minAmount)} and ${usd.format(offer.maxAmount)}.`);
  const accountName = ledger.accounts.find((a) => a.id === ledger.profile.operatingAccountId)?.name ?? 'your operating account';
  const application: LoanApplication = {
    id: `app_${offerId}_${now.getTime().toString(36)}`,
    amount: Math.round(amount),
    startedAt: now.toISOString(),
    status: 'started',
    nextSteps: nextSteps(offer.lenderId, accountName, offer.fundingDays),
  };
  ledger.financing.applications[offerId] = application;
  const updated = buildLoanOffers(ledger).offers.find((o) => o.id === offerId);
  if (!updated) throw notFound('That offer is no longer available.');
  return updated;
}

export function toggleSavedOffer(ledger: Ledger, offerId: string): LoanOffer {
  const offer = buildLoanOffers(ledger).offers.find((o) => o.id === offerId);
  if (!offer) throw notFound('That offer is no longer available.');
  const saved = new Set(ledger.financing.saved);
  if (saved.has(offerId)) saved.delete(offerId);
  else saved.add(offerId);
  ledger.financing.saved = [...saved];
  const updated = buildLoanOffers(ledger).offers.find((o) => o.id === offerId);
  if (!updated) throw notFound('That offer is no longer available.');
  return updated;
}
