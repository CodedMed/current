import type { CashAccountType, CashCategory, ConnectionStatus, PaymentMethod } from '../../../../shared/types.ts';

/**
 * Everything the mock ledger needs to describe one company. Monthly targets are
 * turned into dated events by the generator, so a profile reads like a budget.
 */

export interface AccountSeed {
  id: string;
  institutionId: string;
  institutionName: string;
  name: string;
  mask: string | null;
  type: CashAccountType;
  bookBalance: number;
  connectionStatus: ConnectionStatus;
  minimumBalance: number | null;
  /** Minutes before "now" the last sync happened. */
  syncedMinutesAgo: number;
}

export interface CustomerSeed {
  id: string;
  name: string;
  /** Invoice amount per month. */
  monthly: number;
  /** Day of month the payment usually lands. */
  day: number;
  method: Extract<PaymentMethod, 'ACH' | 'WIRE' | 'CHECK'>;
  accountId: string;
  categoryId: 'services' | 'enterprise';
}

export interface OneOffSeed {
  /** Days relative to today (negative = past). */
  offsetDays: number;
  merchant: string;
  description: string;
  amount: number;
  direction: 'INFLOW' | 'OUTFLOW';
  categoryId: string;
  accountId: string;
  method: PaymentMethod;
  confidence: number;
}

export interface BillingAnomalySeed {
  /** Merchant whose most recent charge is altered. */
  merchant: string;
  kind: 'scale' | 'duplicate';
  /** Multiplier for `scale`. */
  factor?: number;
  /** Days after the original for `duplicate`. */
  daysAfter?: number;
}

export interface CompanyProfile {
  id: string;
  name: string;
  legalName: string;
  seed: string;
  accounts: AccountSeed[];
  /** Account that pays payroll, rent, cards, and receives processor payouts. */
  operatingAccountId: string;
  /** Account used for taxes, contractors, and professional services. */
  secondaryAccountId: string;
  /** Account that receives marketplace transfers. */
  marketplaceAccountId: string | null;
  /** Interest-bearing account, if any. */
  savingsAccountId: string | null;
  /** Month-over-month revenue growth, applied backwards through history. */
  growth: number;
  revenue: {
    subscriptions: number;
    marketplace: number;
    referral: number;
  };
  customers: CustomerSeed[];
  expenses: {
    payroll: number;
    contractors: number;
    software: number;
    cloud: number;
    marketing: number;
    rent: number;
    insurance: number;
    federalTaxQuarterly: number;
    stateTaxQuarterly: number;
    salesTax: number;
    accounting: number;
    legalQuarterly: number;
    travel: number;
    loan: number;
    utilities: number;
    other: number;
  };
  /** Multiplier applied to this month's cloud invoice (1.23 = 23% above trend). */
  cloudSpike: number;
  oneOffs: OneOffSeed[];
  /** Deliberate billing irregularities so the review queue has real cases. */
  billingAnomalies: BillingAnomalySeed[];
  vendors: {
    payroll: string;
    landlord: string;
    insurer: string;
    stateTaxAgency: string;
    accountant: string;
    lawFirm: string;
    lender: string | null;
    utility: string;
    telecom: string;
    contractors: string[];
  };
}

export const CATEGORIES: CashCategory[] = [
  { id: 'subscriptions', name: 'Subscriptions', parentId: 'income' },
  { id: 'services', name: 'Services', parentId: 'income' },
  { id: 'enterprise', name: 'Enterprise', parentId: 'income' },
  { id: 'marketplace', name: 'Marketplace', parentId: 'income' },
  { id: 'interest', name: 'Interest', parentId: 'income' },
  { id: 'sales', name: 'Sales', parentId: 'income' },
  { id: 'other_income', name: 'Other income', parentId: 'income' },
  { id: 'payroll', name: 'Payroll', parentId: 'expenses' },
  { id: 'contractors', name: 'Contractors', parentId: 'expenses' },
  { id: 'software', name: 'Software & SaaS', parentId: 'expenses' },
  { id: 'cloud', name: 'Cloud infrastructure', parentId: 'expenses' },
  { id: 'marketing', name: 'Marketing', parentId: 'expenses' },
  { id: 'rent', name: 'Rent', parentId: 'expenses' },
  { id: 'insurance', name: 'Insurance', parentId: 'expenses' },
  { id: 'federal_taxes', name: 'Federal taxes', parentId: 'expenses' },
  { id: 'state_taxes', name: 'State taxes', parentId: 'expenses' },
  { id: 'sales_tax', name: 'Sales tax', parentId: 'expenses' },
  { id: 'professional_services', name: 'Professional services', parentId: 'expenses' },
  { id: 'travel', name: 'Travel', parentId: 'expenses' },
  { id: 'bank_fees', name: 'Bank fees', parentId: 'expenses' },
  { id: 'loan_payments', name: 'Loan payments', parentId: 'expenses' },
  { id: 'utilities', name: 'Utilities', parentId: 'expenses' },
  { id: 'inventory', name: 'Inventory', parentId: 'expenses' },
  { id: 'food_beverage', name: 'Food & beverage', parentId: 'expenses' },
  { id: 'materials', name: 'Materials', parentId: 'expenses' },
  { id: 'equipment', name: 'Equipment', parentId: 'expenses' },
  { id: 'supplies', name: 'Supplies & packaging', parentId: 'expenses' },
  { id: 'fulfillment_shipping', name: 'Fulfillment & shipping', parentId: 'expenses' },
  { id: 'fleet', name: 'Vehicles & fuel', parentId: 'expenses' },
  { id: 'owner_draw', name: 'Owner draw', parentId: 'expenses' },
  { id: 'other_expenses', name: 'Other expenses', parentId: 'expenses' },
];

export const CATEGORY_NAME: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.name]));

const ACME: CompanyProfile = {
  id: 'acme',
  name: 'Acme Inc.',
  legalName: 'Acme Software, Inc.',
  seed: 'acme-2026',
  accounts: [
    { id: 'chase-chk', institutionId: 'chase', institutionName: 'JPMorgan Chase', name: 'Chase Business Checking', mask: '4821', type: 'CHECKING', bookBalance: 184_220, connectionStatus: 'CONNECTED', minimumBalance: 100_000, syncedMinutesAgo: 3 },
    { id: 'bofa-chk', institutionId: 'bofa', institutionName: 'Bank of America', name: 'Business Advantage Checking', mask: '7310', type: 'CHECKING', bookBalance: 128_240, connectionStatus: 'CONNECTED', minimumBalance: 40_000, syncedMinutesAgo: 3 },
    { id: 'wf-sav', institutionId: 'wells', institutionName: 'Wells Fargo', name: 'Business Savings', mask: '0264', type: 'SAVINGS', bookBalance: 82_480, connectionStatus: 'CONNECTED', minimumBalance: null, syncedMinutesAgo: 41 },
    { id: 'capone-chk', institutionId: 'capitalone', institutionName: 'Capital One', name: 'Spark Business Checking', mask: '9958', type: 'CHECKING', bookBalance: 14_820, connectionStatus: 'CONNECTED', minimumBalance: null, syncedMinutesAgo: 12 },
    { id: 'stripe', institutionId: 'stripe', institutionName: 'Stripe', name: 'Stripe balance', mask: null, type: 'PAYMENT_PROCESSOR', bookBalance: 11_930, connectionStatus: 'CONNECTED', minimumBalance: null, syncedMinutesAgo: 3 },
    { id: 'paypal', institutionId: 'paypal', institutionName: 'PayPal', name: 'PayPal Business', mask: null, type: 'PAYMENT_PROCESSOR', bookBalance: 6_953, connectionStatus: 'RECONNECT_REQUIRED', minimumBalance: null, syncedMinutesAgo: 3 * 24 * 60 + 110 },
  ],
  operatingAccountId: 'chase-chk',
  secondaryAccountId: 'bofa-chk',
  marketplaceAccountId: 'capone-chk',
  savingsAccountId: 'wf-sav',
  growth: 0.03,
  revenue: { subscriptions: 82_000, marketplace: 10_000, referral: 3_200 },
  customers: [
    { id: 'northstar', name: 'Northstar Inc.', monthly: 14_000, day: 10, method: 'ACH', accountId: 'chase-chk', categoryId: 'services' },
    { id: 'bright-labs', name: 'Bright Labs', monthly: 9_500, day: 18, method: 'ACH', accountId: 'chase-chk', categoryId: 'services' },
    { id: 'apex', name: 'Apex Systems', monthly: 7_500, day: 12, method: 'ACH', accountId: 'chase-chk', categoryId: 'services' },
    { id: 'nova', name: 'Nova Health', monthly: 6_000, day: 22, method: 'CHECK', accountId: 'chase-chk', categoryId: 'services' },
    { id: 'harbor', name: 'Harbor Logistics', monthly: 8_000, day: 5, method: 'ACH', accountId: 'chase-chk', categoryId: 'services' },
    { id: 'meridian', name: 'Meridian Health Systems', monthly: 22_000, day: 8, method: 'WIRE', accountId: 'bofa-chk', categoryId: 'enterprise' },
    { id: 'pacific-rail', name: 'Pacific Rail Partners', monthly: 16_000, day: 20, method: 'WIRE', accountId: 'bofa-chk', categoryId: 'enterprise' },
  ],
  expenses: {
    payroll: 52_000,
    contractors: 9_000,
    software: 5_530,
    cloud: 8_240,
    marketing: 13_800,
    rent: 12_000,
    insurance: 6_400,
    federalTaxQuarterly: 21_000,
    stateTaxQuarterly: 6_200,
    salesTax: 3_100,
    accounting: 1_750,
    legalQuarterly: 4_800,
    travel: 3_000,
    loan: 4_850,
    utilities: 2_040,
    other: 1_100,
  },
  cloudSpike: 1.23,
  oneOffs: [
    { offsetDays: 24, merchant: 'Cooley LLP', description: 'Series A closing fees', amount: 19_500, direction: 'OUTFLOW', categoryId: 'professional_services', accountId: 'bofa-chk', method: 'WIRE', confidence: 0.9 },
    { offsetDays: 38, merchant: 'The Hartford', description: 'Annual liability policy renewal', amount: 14_200, direction: 'OUTFLOW', categoryId: 'insurance', accountId: 'chase-chk', method: 'ACH', confidence: 0.95 },
    { offsetDays: 47, merchant: 'Meridian Health Systems', description: 'Implementation milestone 2', amount: 30_000, direction: 'INFLOW', categoryId: 'enterprise', accountId: 'bofa-chk', method: 'WIRE', confidence: 0.7 },
    { offsetDays: -9, merchant: 'Dell Technologies', description: 'Engineering laptops (4)', amount: 9_860, direction: 'OUTFLOW', categoryId: 'other_expenses', accountId: 'chase-chk', method: 'CREDIT_CARD', confidence: 1 },
  ],
  billingAnomalies: [
    { merchant: 'Hudson Yards Properties', kind: 'scale', factor: 1.25 },
    { merchant: 'Datadog', kind: 'duplicate', daysAfter: 2 },
    { merchant: 'Kite Dev Studio', kind: 'scale', factor: 2.4 },
  ],
  vendors: {
    payroll: 'Gusto',
    landlord: 'Hudson Yards Properties',
    insurer: 'The Hartford',
    stateTaxAgency: 'NYS Tax Department',
    accountant: 'Stratton & Co. CPA',
    lawFirm: 'Cooley LLP',
    lender: 'Chase SBA Lending',
    utility: 'Con Edison',
    telecom: 'Verizon Business',
    contractors: ['Lena Ortiz Design', 'Kite Dev Studio', 'Marcus Bell Consulting', 'Northbeam Data'],
  },
};

const NORTHWIND: CompanyProfile = {
  id: 'northwind',
  name: 'Northwind Studio',
  legalName: 'Northwind Studio LLC',
  seed: 'northwind-2026',
  accounts: [
    { id: 'mercury-chk', institutionId: 'mercury', institutionName: 'Mercury', name: 'Mercury Business Checking', mask: '2210', type: 'CHECKING', bookBalance: 96_400, connectionStatus: 'CONNECTED', minimumBalance: 60_000, syncedMinutesAgo: 6 },
    { id: 'chase-chk', institutionId: 'chase', institutionName: 'JPMorgan Chase', name: 'Chase Business Checking', mask: '7745', type: 'CHECKING', bookBalance: 31_200, connectionStatus: 'CONNECTED', minimumBalance: 15_000, syncedMinutesAgo: 6 },
    { id: 'wf-sav', institutionId: 'wells', institutionName: 'Wells Fargo', name: 'Business Savings', mask: '5031', type: 'SAVINGS', bookBalance: 25_000, connectionStatus: 'CONNECTED', minimumBalance: null, syncedMinutesAgo: 95 },
    { id: 'stripe', institutionId: 'stripe', institutionName: 'Stripe', name: 'Stripe balance', mask: null, type: 'PAYMENT_PROCESSOR', bookBalance: 4_120, connectionStatus: 'CONNECTED', minimumBalance: null, syncedMinutesAgo: 6 },
  ],
  operatingAccountId: 'mercury-chk',
  secondaryAccountId: 'chase-chk',
  marketplaceAccountId: null,
  savingsAccountId: 'wf-sav',
  growth: 0.012,
  revenue: { subscriptions: 28_000, marketplace: 0, referral: 0 },
  customers: [
    { id: 'lumen', name: 'Lumen Retail Group', monthly: 6_500, day: 9, method: 'ACH', accountId: 'mercury-chk', categoryId: 'services' },
    { id: 'kestrel', name: 'Kestrel Outdoors', monthly: 4_200, day: 16, method: 'ACH', accountId: 'mercury-chk', categoryId: 'services' },
    { id: 'juniper', name: 'Juniper Dental', monthly: 3_300, day: 24, method: 'CHECK', accountId: 'chase-chk', categoryId: 'services' },
  ],
  expenses: {
    payroll: 38_000,
    contractors: 6_000,
    software: 2_400,
    cloud: 3_100,
    marketing: 4_200,
    rent: 4_500,
    insurance: 1_900,
    federalTaxQuarterly: 6_000,
    stateTaxQuarterly: 1_800,
    salesTax: 900,
    accounting: 1_200,
    legalQuarterly: 0,
    travel: 900,
    loan: 0,
    utilities: 600,
    other: 500,
  },
  cloudSpike: 1.06,
  oneOffs: [
    { offsetDays: 19, merchant: 'Lumen Retail Group', description: 'Brand refresh — final invoice', amount: 12_000, direction: 'INFLOW', categoryId: 'services', accountId: 'mercury-chk', method: 'ACH', confidence: 0.75 },
    { offsetDays: 33, merchant: 'Apple', description: 'Studio workstation', amount: 7_400, direction: 'OUTFLOW', categoryId: 'other_expenses', accountId: 'mercury-chk', method: 'CREDIT_CARD', confidence: 0.9 },
  ],
  billingAnomalies: [
    { merchant: 'Slack', kind: 'scale', factor: 1.6 },
    { merchant: 'Slate Motion', kind: 'scale', factor: 2.1 },
  ],
  vendors: {
    payroll: 'Rippling',
    landlord: 'Pearl District Holdings',
    insurer: 'Hiscox',
    stateTaxAgency: 'Oregon Dept. of Revenue',
    accountant: 'Bench Accounting',
    lawFirm: 'Tonkon Torp',
    lender: null,
    utility: 'Portland General Electric',
    telecom: 'Comcast Business',
    contractors: ['Ava Chen Illustration', 'Slate Motion', 'Rowan Type Foundry'],
  },
};

export const PROFILES: readonly CompanyProfile[] = [ACME, NORTHWIND];

export function findProfile(id: string): CompanyProfile | null {
  return PROFILES.find((p) => p.id === id) ?? null;
}
