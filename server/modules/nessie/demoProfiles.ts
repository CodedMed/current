import type { BusinessTypeId } from '../../../shared/types.ts';
import type { NessieAddress } from './types.ts';

/**
 * Demo configuration per business type. Each profile describes a realistic
 * small business: its accounts, who it pays, how money arrives, and what is
 * still owed. The provisioner turns a profile into ~150 Nessie records.
 *
 * Amounts are dollar ranges; cadences are relative to the 90-day window that
 * ends today. Weekdays use 0 = Sunday … 6 = Saturday.
 */

export type Cadence =
  | { kind: 'daily'; weekdays: number[] }
  | { kind: 'weekly'; weekday: number }
  | { kind: 'biweekly'; weekday: number }
  | { kind: 'monthly'; day: number }
  | { kind: 'random'; perMonth: number };

export type AccountKey = 'operating' | 'reserve' | 'card';

export interface AccountSeed {
  key: AccountKey;
  type: 'Checking' | 'Savings' | 'Credit Card';
  nickname: string;
  /** Balance at the start of the 90-day window (for cards: statement balance owed). */
  openingBalance: number;
}

export interface MerchantSeed {
  key: string;
  name: string;
  category: string;
}

export interface IncomeSeed {
  description: string;
  cadence: Cadence;
  amount: [number, number];
}

export interface ExpenseSeed {
  merchant: string;
  description: string;
  cadence: Cadence;
  amount: [number, number];
}

export interface WithdrawalSeed {
  description: string;
  cadence: Cadence;
  amount: [number, number];
}

export interface BillSeed {
  payee: string;
  nickname: string;
  amount: number;
  /** Day of month the bill is due. */
  day: number;
}

export interface ReceivableSeed {
  customer: string;
  reference: string;
  amount: number;
  issuedDaysAgo: number;
  termsDays: number;
}

export interface VendorBillSeed {
  merchant: string;
  amount: number;
  dueInDays: number;
}

export interface DemoProfile {
  businessType: BusinessTypeId;
  businessName: (owner: { givenName: string; familyName: string; name: string }) => string;
  address: NessieAddress;
  accounts: AccountSeed[];
  merchants: MerchantSeed[];
  income: IncomeSeed[];
  expenses: ExpenseSeed[];
  withdrawals: WithdrawalSeed[];
  bills: BillSeed[];
  receivables: ReceivableSeed[];
  vendorBills: VendorBillSeed[];
  reserveSweep: { description: string; amount: [number, number]; day: number } | null;
}

const daily = (...weekdays: number[]): Cadence => ({ kind: 'daily', weekdays });
const weekly = (weekday: number): Cadence => ({ kind: 'weekly', weekday });
const biweekly = (weekday: number): Cadence => ({ kind: 'biweekly', weekday });
const monthly = (day: number): Cadence => ({ kind: 'monthly', day });
const random = (perMonth: number): Cadence => ({ kind: 'random', perMonth });
const fixed = (n: number): [number, number] => [n, n];

const address = (street_number: string, street_name: string, city: string, state: string, zip: string): NessieAddress => ({
  street_number,
  street_name,
  city,
  state,
  zip,
});

const accounts = (operating: number, reserve: number, card: number, reserveName = 'Reserve Savings'): AccountSeed[] => [
  { key: 'operating', type: 'Checking', nickname: 'Operating Checking', openingBalance: operating },
  { key: 'reserve', type: 'Savings', nickname: reserveName, openingBalance: reserve },
  { key: 'card', type: 'Credit Card', nickname: 'Business Card', openingBalance: card },
];

export const DEMO_PROFILES: Record<BusinessTypeId, DemoProfile> = {
  retail: {
    businessType: 'retail',
    businessName: () => 'Harbor & Vine Goods',
    address: address('412', 'Pier Street', 'Portland', 'ME', '04101'),
    accounts: accounts(21500, 9800, 2340, 'Tax & Reserve Savings'),
    merchants: [
      { key: 'faire', name: 'Faire Wholesale', category: 'Inventory' },
      { key: 'creative', name: 'Creative Co-Op', category: 'Inventory' },
      { key: 'uline', name: 'Uline', category: 'Packaging & supplies' },
      { key: 'meta', name: 'Meta Ads', category: 'Marketing' },
    ],
    income: [
      { description: 'Card settlement · Square', cadence: daily(1, 2, 3, 4, 5, 6), amount: [650, 1900] },
      { description: 'Shopify payout', cadence: weekly(4), amount: [900, 2400] },
    ],
    expenses: [
      { merchant: 'faire', description: 'Wholesale order', cadence: weekly(2), amount: [1800, 3500] },
      { merchant: 'creative', description: 'Wholesale order', cadence: biweekly(3), amount: [900, 2100] },
      { merchant: 'uline', description: 'Packaging & bags', cadence: monthly(9), amount: [220, 480] },
      { merchant: 'meta', description: 'Instagram & Facebook ads', cadence: weekly(1), amount: [120, 260] },
    ],
    withdrawals: [
      { description: 'Payroll · Gusto', cadence: biweekly(5), amount: [3100, 3600] },
      { description: 'Sales tax remittance · State DOR', cadence: monthly(20), amount: [1400, 2200] },
      { description: 'Owner draw', cadence: monthly(28), amount: fixed(3000) },
    ],
    bills: [
      { payee: 'Pier Street Properties', nickname: 'Rent', amount: 3200, day: 1 },
      { payee: 'Hiscox', nickname: 'Business insurance', amount: 210, day: 15 },
      { payee: 'Comcast Business', nickname: 'Internet & phone', amount: 189, day: 20 },
      { payee: 'Square Capital', nickname: 'Loan installment', amount: 640, day: 5 },
    ],
    receivables: [
      { customer: 'The Nook Market', reference: 'INV-2031', amount: 1850, issuedDaysAgo: 18, termsDays: 30 },
      { customer: 'Cedar Cove Gifts', reference: 'INV-2036', amount: 940, issuedDaysAgo: 20, termsDays: 15 },
    ],
    vendorBills: [
      { merchant: 'faire', amount: 2150, dueInDays: 6 },
      { merchant: 'creative', amount: 1320, dueInDays: 11 },
    ],
    reserveSweep: { description: 'Reserve sweep', amount: [1200, 1500], day: 3 },
  },

  professional_services: {
    businessType: 'professional_services',
    businessName: () => 'Northstar Bookkeeping & Tax',
    address: address('88', 'Congress Avenue', 'Austin', 'TX', '78701'),
    accounts: accounts(38000, 25000, 1120),
    merchants: [
      { key: 'qbo', name: 'QuickBooks Online', category: 'Software' },
      { key: 'karbon', name: 'Karbon', category: 'Software' },
      { key: 'gworkspace', name: 'Google Workspace', category: 'Software' },
      { key: 'linkedin', name: 'LinkedIn Ads', category: 'Marketing' },
      { key: 'staples', name: 'Staples', category: 'Office supplies' },
      { key: 'delta', name: 'Delta Air Lines', category: 'Travel' },
    ],
    income: [
      { description: 'Client retainer · ACH', cadence: random(6), amount: [1800, 5200] },
      { description: 'Stripe payout · project invoices', cadence: weekly(2), amount: [800, 3000] },
    ],
    expenses: [
      { merchant: 'qbo', description: 'Accounting software', cadence: monthly(3), amount: fixed(200) },
      { merchant: 'karbon', description: 'Practice management', cadence: monthly(6), amount: fixed(260) },
      { merchant: 'gworkspace', description: 'Email & docs', cadence: monthly(18), amount: fixed(84) },
      { merchant: 'linkedin', description: 'Lead-gen campaign', cadence: weekly(1), amount: [90, 180] },
      { merchant: 'staples', description: 'Office supplies', cadence: monthly(11), amount: [60, 140] },
      { merchant: 'delta', description: 'Client visit · airfare', cadence: random(1), amount: [300, 900] },
    ],
    withdrawals: [
      { description: 'Payroll · Gusto', cadence: biweekly(5), amount: [5400, 5900] },
      { description: 'IRS EFTPS · estimated tax', cadence: monthly(15), amount: fixed(1900) },
      { description: 'Owner draw', cadence: monthly(28), amount: fixed(6000) },
    ],
    bills: [
      { payee: 'WeWork', nickname: 'Office membership', amount: 1650, day: 1 },
      { payee: 'Hiscox', nickname: 'Professional liability', amount: 310, day: 12 },
      { payee: 'Gusto', nickname: 'Payroll platform', amount: 149, day: 3 },
      { payee: 'Sonic Business', nickname: 'Internet', amount: 95, day: 22 },
    ],
    receivables: [
      { customer: 'Bluefin Dental Group', reference: 'INV-1187', amount: 4200, issuedDaysAgo: 35, termsDays: 30 },
      { customer: 'Marsh Creek HOA', reference: 'INV-1190', amount: 1150, issuedDaysAgo: 8, termsDays: 15 },
      { customer: 'Ortega Landscaping LLC', reference: 'INV-1192', amount: 2750, issuedDaysAgo: 4, termsDays: 30 },
    ],
    vendorBills: [
      { merchant: 'karbon', amount: 260, dueInDays: 6 },
      { merchant: 'staples', amount: 140, dueInDays: 10 },
    ],
    reserveSweep: { description: 'Reserve sweep', amount: [2000, 2500], day: 5 },
  },

  consulting: {
    businessType: 'consulting',
    businessName: () => 'Lumen Strategy Partners',
    address: address('1500', 'Market Street', 'Denver', 'CO', '80202'),
    accounts: accounts(52000, 30000, 2760),
    merchants: [
      { key: 'united', name: 'United Airlines', category: 'Travel' },
      { key: 'marriott', name: 'Marriott', category: 'Travel' },
      { key: 'notion', name: 'Notion', category: 'Software' },
      { key: 'zoom', name: 'Zoom', category: 'Software' },
      { key: 'upwork', name: 'Upwork', category: 'Contractors' },
      { key: 'hubspot', name: 'HubSpot', category: 'Software' },
    ],
    income: [
      { description: 'Milestone payment · wire', cadence: random(2), amount: [8000, 20000] },
      { description: 'Retainer · Verdant Foods', cadence: monthly(1), amount: fixed(5000) },
      { description: 'Retainer · Kestrel Robotics', cadence: monthly(15), amount: fixed(5000) },
    ],
    expenses: [
      { merchant: 'united', description: 'Client travel · airfare', cadence: random(3), amount: [280, 1100] },
      { merchant: 'marriott', description: 'Client travel · lodging', cadence: random(2), amount: [400, 900] },
      { merchant: 'notion', description: 'Workspace', cadence: monthly(7), amount: fixed(96) },
      { merchant: 'zoom', description: 'Video conferencing', cadence: monthly(9), amount: fixed(150) },
      { merchant: 'upwork', description: 'Research contractors', cadence: biweekly(4), amount: [900, 2400] },
      { merchant: 'hubspot', description: 'CRM', cadence: monthly(12), amount: fixed(890) },
    ],
    withdrawals: [
      { description: 'Payroll · Gusto', cadence: biweekly(5), amount: [6000, 6400] },
      { description: 'Owner draw', cadence: monthly(28), amount: fixed(8000) },
      { description: 'IRS EFTPS · estimated tax', cadence: monthly(15), amount: fixed(3200) },
    ],
    bills: [
      { payee: 'Regus', nickname: 'Office suite', amount: 980, day: 1 },
      { payee: 'Hiscox', nickname: 'Professional liability', amount: 290, day: 10 },
      { payee: 'Gusto', nickname: 'Payroll platform', amount: 89, day: 3 },
      { payee: 'Google Workspace', nickname: 'Email & docs', amount: 72, day: 18 },
    ],
    receivables: [
      { customer: 'Verdant Foods Inc.', reference: 'INV-0412', amount: 18000, issuedDaysAgo: 12, termsDays: 45 },
      { customer: 'Kestrel Robotics', reference: 'INV-0409', amount: 9500, issuedDaysAgo: 38, termsDays: 30 },
      { customer: 'City of Ashford', reference: 'INV-0415', amount: 12400, issuedDaysAgo: 5, termsDays: 60 },
    ],
    vendorBills: [
      { merchant: 'upwork', amount: 1600, dueInDays: 7 },
      { merchant: 'hubspot', amount: 890, dueInDays: 3 },
    ],
    reserveSweep: { description: 'Reserve sweep', amount: [3000, 4000], day: 2 },
  },

  construction: {
    businessType: 'construction',
    businessName: () => 'Ridgeline Builders LLC',
    address: address('2210', 'Industrial Way', 'Boise', 'ID', '83702'),
    accounts: accounts(61000, 40000, 6840),
    merchants: [
      { key: 'homedepot', name: 'Home Depot Pro', category: 'Materials' },
      { key: 'ferguson', name: 'Ferguson Plumbing Supply', category: 'Materials' },
      { key: 'sunbelt', name: 'Sunbelt Rentals', category: 'Equipment rental' },
      { key: 'shell', name: 'Shell Fleet', category: 'Fuel' },
      { key: 'procore', name: 'Procore', category: 'Software' },
      { key: 'ace', name: 'Ace Hardware', category: 'Materials' },
    ],
    income: [
      { description: 'Progress draw · wire', cadence: random(3), amount: [15000, 40000] },
      { description: 'Service call · card', cadence: weekly(5), amount: [350, 1400] },
    ],
    expenses: [
      { merchant: 'homedepot', description: 'Job materials', cadence: weekly(2), amount: [300, 1900] },
      { merchant: 'homedepot', description: 'Job materials', cadence: weekly(4), amount: [300, 1900] },
      { merchant: 'ferguson', description: 'Plumbing & fixtures', cadence: weekly(3), amount: [400, 2400] },
      { merchant: 'sunbelt', description: 'Equipment rental', cadence: biweekly(1), amount: [900, 2800] },
      { merchant: 'shell', description: 'Fleet fuel', cadence: weekly(5), amount: [260, 520] },
      { merchant: 'procore', description: 'Project management', cadence: monthly(4), amount: fixed(667) },
      { merchant: 'ace', description: 'Fasteners & tools', cadence: random(4), amount: [40, 210] },
    ],
    withdrawals: [
      { description: 'Payroll · crew', cadence: weekly(5), amount: [5400, 7200] },
      { description: 'Subcontractor · Alvarez Electric', cadence: biweekly(3), amount: [3000, 9000] },
      { description: 'Owner draw', cadence: monthly(28), amount: fixed(7000) },
      { description: 'IRS EFTPS · estimated tax', cadence: monthly(15), amount: fixed(4100) },
    ],
    bills: [
      { payee: 'Kessler Industrial', nickname: 'Yard lease', amount: 2400, day: 1 },
      { payee: 'Builders Mutual', nickname: 'Liability & workers comp', amount: 1180, day: 8 },
      { payee: 'Ford Credit', nickname: 'Truck loan', amount: 912, day: 15 },
      { payee: 'Verizon', nickname: 'Fleet phones', amount: 240, day: 22 },
    ],
    receivables: [
      { customer: 'Parkside Development', reference: 'INV-3301', amount: 38000, issuedDaysAgo: 10, termsDays: 30 },
      { customer: 'Dana Whitfield', reference: 'INV-3298', amount: 8400, issuedDaysAgo: 22, termsDays: 15 },
      { customer: 'Oak Hill School District', reference: 'INV-3305', amount: 52000, issuedDaysAgo: 3, termsDays: 60 },
    ],
    vendorBills: [
      { merchant: 'ferguson', amount: 3900, dueInDays: 5 },
      { merchant: 'sunbelt', amount: 1750, dueInDays: 8 },
    ],
    reserveSweep: { description: 'Reserve sweep', amount: [4000, 5000], day: 6 },
  },

  restaurant: {
    businessType: 'restaurant',
    businessName: () => 'Juniper Kitchen & Bar',
    address: address('27', 'Market Street', 'Asheville', 'NC', '28801'),
    accounts: accounts(16500, 8500, 3120),
    merchants: [
      { key: 'sysco', name: 'Sysco', category: 'Food & beverage' },
      { key: 'rdepot', name: 'Restaurant Depot', category: 'Food & beverage' },
      { key: 'glazers', name: "Southern Glazer's", category: 'Food & beverage' },
      { key: 'ecolab', name: 'Ecolab', category: 'Cleaning & sanitation' },
      { key: 'toast', name: 'Toast POS', category: 'Payment processing' },
      { key: 'yelp', name: 'Yelp Ads', category: 'Marketing' },
    ],
    income: [
      { description: 'Card settlement · Toast', cadence: daily(0, 2, 3, 4, 5, 6), amount: [1200, 4200] },
      { description: 'DoorDash payout', cadence: weekly(1), amount: [900, 2100] },
      { description: 'Cash deposit', cadence: weekly(1), amount: [600, 1500] },
    ],
    expenses: [
      { merchant: 'sysco', description: 'Food order', cadence: weekly(1), amount: [1100, 2900] },
      { merchant: 'sysco', description: 'Food order', cadence: weekly(4), amount: [1100, 2900] },
      { merchant: 'rdepot', description: 'Dry goods & produce', cadence: weekly(3), amount: [400, 900] },
      { merchant: 'glazers', description: 'Beverage order', cadence: weekly(2), amount: [500, 1300] },
      { merchant: 'ecolab', description: 'Sanitation service', cadence: biweekly(2), amount: [180, 260] },
      { merchant: 'toast', description: 'POS subscription', cadence: monthly(1), amount: fixed(165) },
      { merchant: 'yelp', description: 'Local ads', cadence: weekly(1), amount: [60, 110] },
    ],
    withdrawals: [
      { description: 'Payroll · staff', cadence: weekly(2), amount: [6400, 7800] },
      { description: 'Sales tax remittance · State DOR', cadence: monthly(20), amount: [2400, 3900] },
      { description: 'Owner draw', cadence: monthly(28), amount: fixed(4000) },
    ],
    bills: [
      { payee: 'Market Street Holdings', nickname: 'Rent', amount: 6500, day: 1 },
      { payee: 'Duke Energy', nickname: 'Electric & gas', amount: 1180, day: 12 },
      { payee: 'Waste Management', nickname: 'Waste pickup', amount: 310, day: 5 },
      { payee: 'Hospitality Mutual', nickname: 'Insurance', amount: 540, day: 20 },
    ],
    receivables: [
      { customer: 'Ashford Tech · catering', reference: 'CAT-118', amount: 3200, issuedDaysAgo: 6, termsDays: 15 },
      { customer: 'Nguyen wedding · private event', reference: 'EVT-42', amount: 5600, issuedDaysAgo: 2, termsDays: 30 },
    ],
    vendorBills: [
      { merchant: 'sysco', amount: 2340, dueInDays: 4 },
      { merchant: 'glazers', amount: 880, dueInDays: 9 },
    ],
    reserveSweep: { description: 'Reserve sweep', amount: [800, 1000], day: 3 },
  },

  ecommerce: {
    businessType: 'ecommerce',
    businessName: () => 'Fern & Field Botanicals',
    address: address('960', 'Bayview Drive', 'Oakland', 'CA', '94607'),
    accounts: accounts(31000, 15000, 4480),
    merchants: [
      { key: 'hangzhou', name: 'Hangzhou Botanics Supply', category: 'Inventory' },
      { key: 'meta', name: 'Meta Ads', category: 'Marketing' },
      { key: 'gads', name: 'Google Ads', category: 'Marketing' },
      { key: 'shipbob', name: 'ShipBob', category: 'Fulfillment' },
      { key: 'klaviyo', name: 'Klaviyo', category: 'Software' },
      { key: 'shopify', name: 'Shopify', category: 'Software' },
      { key: 'ups', name: 'UPS', category: 'Shipping' },
    ],
    income: [
      { description: 'Shopify payout', cadence: daily(1, 3, 5), amount: [900, 3200] },
      { description: 'Amazon settlement', cadence: biweekly(2), amount: [3400, 8800] },
      { description: 'Etsy deposit', cadence: weekly(1), amount: [300, 900] },
    ],
    expenses: [
      { merchant: 'hangzhou', description: 'Inventory · purchase order', cadence: monthly(10), amount: [6000, 11000] },
      { merchant: 'meta', description: 'Paid social', cadence: weekly(1), amount: [700, 1400] },
      { merchant: 'gads', description: 'Search ads', cadence: weekly(1), amount: [400, 800] },
      { merchant: 'shipbob', description: 'Fulfillment & storage', cadence: biweekly(4), amount: [1200, 2600] },
      { merchant: 'klaviyo', description: 'Email marketing', cadence: monthly(6), amount: fixed(175) },
      { merchant: 'shopify', description: 'Store subscription', cadence: monthly(2), amount: fixed(399) },
      { merchant: 'ups', description: 'Outbound shipping', cadence: weekly(5), amount: [250, 600] },
    ],
    withdrawals: [
      { description: 'Payroll · Gusto', cadence: biweekly(5), amount: [3800, 4200] },
      { description: 'Sales tax remittance · TaxJar', cadence: monthly(20), amount: fixed(1800) },
      { description: 'Owner draw', cadence: monthly(28), amount: fixed(5000) },
    ],
    bills: [
      { payee: 'Bayview Storage', nickname: 'Warehouse lease', amount: 1900, day: 1 },
      { payee: 'Next Insurance', nickname: 'Product liability', amount: 160, day: 9 },
      { payee: 'AWS', nickname: 'Hosting', amount: 120, day: 15 },
      { payee: 'Chase Ink', nickname: 'Card payment', amount: 2000, day: 25 },
    ],
    receivables: [
      { customer: 'Whole Foods Market · regional', reference: 'INV-7710', amount: 9800, issuedDaysAgo: 20, termsDays: 45 },
      { customer: 'Bloom Boutique', reference: 'INV-7714', amount: 1250, issuedDaysAgo: 9, termsDays: 30 },
    ],
    vendorBills: [
      { merchant: 'hangzhou', amount: 8400, dueInDays: 12 },
      { merchant: 'shipbob', amount: 1900, dueInDays: 6 },
    ],
    reserveSweep: { description: 'Reserve sweep', amount: [1500, 2000], day: 4 },
  },

  freelance: {
    businessType: 'freelance',
    businessName: (owner) => `${owner.name} · Design & Web`,
    address: address('310', 'Elm Street', 'Minneapolis', 'MN', '55401'),
    accounts: accounts(11800, 6300, 890, 'Tax Savings'),
    merchants: [
      { key: 'adobe', name: 'Adobe', category: 'Software' },
      { key: 'figma', name: 'Figma', category: 'Software' },
      { key: 'webflow', name: 'Webflow', category: 'Software' },
      { key: 'apple', name: 'Apple', category: 'Equipment' },
      { key: 'amazon', name: 'Amazon', category: 'Supplies' },
      { key: 'starbucks', name: 'Starbucks', category: 'Meals' },
    ],
    income: [
      { description: 'Client payment · Stripe', cadence: random(4), amount: [600, 3400] },
      { description: 'Retainer · Trailhead Outfitters', cadence: monthly(1), amount: fixed(2000) },
    ],
    expenses: [
      { merchant: 'adobe', description: 'Creative Cloud', cadence: monthly(5), amount: fixed(60) },
      { merchant: 'figma', description: 'Design tool', cadence: monthly(8), amount: fixed(16) },
      { merchant: 'webflow', description: 'Site hosting', cadence: monthly(12), amount: fixed(35) },
      { merchant: 'apple', description: 'Accessories', cadence: random(1), amount: [30, 200] },
      { merchant: 'amazon', description: 'Studio supplies', cadence: random(2), amount: [25, 140] },
      { merchant: 'starbucks', description: 'Client coffee', cadence: weekly(2), amount: [12, 30] },
    ],
    withdrawals: [
      { description: 'Owner draw', cadence: monthly(28), amount: fixed(3500) },
      { description: 'IRS EFTPS · estimated tax', cadence: monthly(15), amount: fixed(1200) },
    ],
    bills: [
      { payee: 'The Loft Coworking', nickname: 'Desk membership', amount: 275, day: 1 },
      { payee: 'Oscar Health', nickname: 'Health insurance', amount: 410, day: 5 },
      { payee: 'Hiscox', nickname: 'Liability insurance', amount: 42, day: 15 },
    ],
    receivables: [
      { customer: 'Maple Street Bakery', reference: 'INV-0088', amount: 2400, issuedDaysAgo: 25, termsDays: 15 },
      { customer: 'Trailhead Outfitters', reference: 'INV-0091', amount: 4800, issuedDaysAgo: 6, termsDays: 30 },
    ],
    vendorBills: [
      { merchant: 'adobe', amount: 60, dueInDays: 5 },
      { merchant: 'webflow', amount: 35, dueInDays: 12 },
    ],
    reserveSweep: { description: 'Tax set-aside', amount: [700, 800], day: 2 },
  },

  other: {
    businessType: 'other',
    businessName: () => 'Meridian Small Business Co.',
    address: address('55', 'Main Street', 'Columbus', 'OH', '43215'),
    accounts: accounts(26000, 10000, 1500),
    merchants: [
      { key: 'amazonb', name: 'Amazon Business', category: 'Supplies' },
      { key: 'officedepot', name: 'Office Depot', category: 'Office supplies' },
      { key: 'gads', name: 'Google Ads', category: 'Marketing' },
      { key: 'uline', name: 'Uline', category: 'Supplies' },
    ],
    income: [
      { description: 'Customer payments · ACH', cadence: weekly(3), amount: [1200, 4200] },
      { description: 'Card sales · Square', cadence: daily(1, 2, 3, 4, 5), amount: [200, 900] },
    ],
    expenses: [
      { merchant: 'amazonb', description: 'Supplies', cadence: weekly(2), amount: [80, 320] },
      { merchant: 'officedepot', description: 'Office supplies', cadence: monthly(9), amount: [120, 260] },
      { merchant: 'gads', description: 'Search ads', cadence: weekly(1), amount: [100, 250] },
      { merchant: 'uline', description: 'Shipping supplies', cadence: monthly(16), amount: [150, 400] },
    ],
    withdrawals: [
      { description: 'Payroll · Gusto', cadence: biweekly(5), amount: [3600, 4000] },
      { description: 'Owner draw', cadence: monthly(28), amount: fixed(4000) },
      { description: 'IRS EFTPS · estimated tax', cadence: monthly(15), amount: fixed(1500) },
    ],
    bills: [
      { payee: 'Main Street Realty', nickname: 'Rent', amount: 2200, day: 1 },
      { payee: 'Hiscox', nickname: 'Insurance', amount: 190, day: 10 },
      { payee: 'City Utilities', nickname: 'Utilities', amount: 260, day: 14 },
      { payee: 'Comcast Business', nickname: 'Internet', amount: 110, day: 20 },
    ],
    receivables: [
      { customer: 'Redwood Consulting', reference: 'INV-0502', amount: 2300, issuedDaysAgo: 12, termsDays: 30 },
      { customer: 'Pinecrest Dental', reference: 'INV-0505', amount: 1100, issuedDaysAgo: 20, termsDays: 15 },
    ],
    vendorBills: [
      { merchant: 'uline', amount: 320, dueInDays: 6 },
      { merchant: 'amazonb', amount: 210, dueInDays: 9 },
    ],
    reserveSweep: { description: 'Reserve sweep', amount: [800, 1000], day: 3 },
  },
};

export function profileFor(businessType: BusinessTypeId): DemoProfile {
  return DEMO_PROFILES[businessType];
}
