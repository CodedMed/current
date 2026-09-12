import type { FlowStep } from './flow.ts';

/* ───────────────────────── Integrations ───────────────────────── */

/** `live` = real third-party API with credentials; `sandbox` = local stand-in because credentials are absent. */
export type IntegrationMode = 'live' | 'sandbox';

export interface IntegrationStatus {
  google: IntegrationMode;
  persona: IntegrationMode;
  nessie: IntegrationMode;
}

/* ───────────────────────── Identity ───────────────────────── */

export const IDENTITY_STATUSES = [
  'not_started',
  'created',
  'pending',
  'completed',
  'approved',
  'declined',
  'needs_review',
  'failed',
  'expired',
] as const;

export type IdentityStatus = (typeof IDENTITY_STATUSES)[number];

export interface IdentitySessionResponse {
  mode: IntegrationMode;
  status: IdentityStatus;
  inquiryId: string | null;
  /** Present only when the client should open the Persona flow. */
  sessionToken: string | null;
  nextStep: FlowStep;
}

export interface IdentityStatusResponse {
  status: IdentityStatus;
  inquiryId: string | null;
  nextStep: FlowStep;
  /** Reviewer note or failure detail when available. */
  detail: string | null;
}

export type SandboxIdentityOutcome = 'approved' | 'declined' | 'needs_review' | 'failed';

/* ───────────────────────── Onboarding catalog ───────────────────────── */

export const BUSINESS_TYPE_IDS = [
  'retail',
  'professional_services',
  'consulting',
  'construction',
  'restaurant',
  'ecommerce',
  'freelance',
  'other',
] as const;

export type BusinessTypeId = (typeof BUSINESS_TYPE_IDS)[number];

export const FEATURE_IDS = [
  'receivables',
  'expenses',
  'invoices',
  'vendor_payments',
  'forecasting',
  'reporting',
  'cash_management',
  'automation',
] as const;

export type FeatureId = (typeof FEATURE_IDS)[number];

export interface BusinessTypeOption {
  id: BusinessTypeId;
  label: string;
  description: string;
  /** Name of a lucide icon rendered by the client. */
  icon: string;
  /** Short, concrete examples shown as helper text. */
  examples: string;
}

export interface FeatureOption {
  id: FeatureId;
  label: string;
  description: string;
  icon: string;
  /** Business types for which this feature is pre-selected. */
  recommendedFor: BusinessTypeId[];
}

export interface OnboardingCatalog {
  businessTypes: BusinessTypeOption[];
  features: FeatureOption[];
}

/* ───────────────────────── Session ───────────────────────── */

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  givenName: string;
  picture: string | null;
  identity: {
    status: IdentityStatus;
    inquiryId: string | null;
    updatedAt: string | null;
  };
  onboarding: {
    businessType: BusinessTypeId | null;
    features: FeatureId[];
  };
  workspace: {
    provisioned: boolean;
    mode: IntegrationMode;
    businessName: string;
  } | null;
}

export interface SessionResponse {
  user: PublicUser | null;
  integrations: IntegrationStatus;
  nextStep: FlowStep;
}

/* ───────────────────────── Provisioning ───────────────────────── */

export const PROVISION_STAGES = ['workspace', 'accounts', 'transactions', 'bills', 'analysis'] as const;
export type ProvisionStage = (typeof PROVISION_STAGES)[number];

export interface ProvisionStatus {
  state: 'idle' | 'running' | 'done' | 'error';
  stage: ProvisionStage | null;
  completed: ProvisionStage[];
  error: string | null;
  mode: IntegrationMode;
  nextStep: FlowStep;
}

/* ───────────────────────── Dashboard ───────────────────────── */

export type AccountType = 'Checking' | 'Savings' | 'Credit Card';

export interface DashboardAccount {
  id: string;
  nickname: string;
  type: AccountType;
  /** Positive number. For credit cards this is the balance owed. */
  balance: number;
}

export interface DailyPoint {
  date: string;
  inflow: number;
  outflow: number;
  balance: number;
}

export interface WeeklyFlow {
  weekStart: string;
  label: string;
  inflow: number;
  outflow: number;
}

export interface ForecastPoint {
  date: string;
  projected: number;
  low: number;
  high: number;
}

export interface TransactionItem {
  id: string;
  date: string;
  description: string;
  counterparty: string;
  category: string;
  amount: number;
  direction: 'in' | 'out' | 'internal';
  kind: 'deposit' | 'purchase' | 'withdrawal' | 'transfer';
  accountId: string;
}

export interface UpcomingBill {
  id: string;
  payee: string;
  nickname: string;
  amount: number;
  dueDate: string;
  daysUntilDue: number;
  recurring: boolean;
  status: string;
}

export interface Receivable {
  id: string;
  customer: string;
  reference: string;
  amount: number;
  dueDate: string;
  daysUntilDue: number;
  status: 'open' | 'due_soon' | 'overdue';
}

export interface CategorySpend {
  category: string;
  amount: number;
  share: number;
  /** Percent change versus the prior 30 days, null when there is no prior data. */
  change: number | null;
}

export interface VendorSummary {
  id: string;
  name: string;
  category: string;
  spent90d: number;
  payments: number;
  lastPaid: string;
  nextDue: string | null;
}

export interface WorkflowSuggestion {
  id: string;
  title: string;
  description: string;
  trigger: string;
  feature: FeatureId;
}

export interface ReportSummary {
  periodLabel: string;
  revenue: number;
  expenses: number;
  netIncome: number;
  margin: number;
  revenueChange: number | null;
  expensesChange: number | null;
  topCategories: CategorySpend[];
}

export interface CashManagement {
  operatingBalance: number;
  reserveBalance: number;
  reserveTarget: number;
  reserveCoverage: number;
  idleCash: number;
  cardBalance: number;
  suggestion: string;
}

export interface DashboardSummary {
  cashOnHand: number;
  inflow30d: number;
  outflow30d: number;
  net30d: number;
  inflowChange: number | null;
  outflowChange: number | null;
  runwayMonths: number | null;
  billsDue14d: number;
  openReceivables: number;
  overdueReceivables: number;
}

export interface DashboardResponse {
  generatedAt: string;
  dataSource: {
    provider: 'nessie';
    mode: IntegrationMode;
    customerId: string;
  };
  business: {
    name: string;
    ownerName: string;
    businessType: BusinessTypeId;
    businessTypeLabel: string;
    features: FeatureId[];
  };
  accounts: DashboardAccount[];
  summary: DashboardSummary;
  history: DailyPoint[];
  weeklyFlows: WeeklyFlow[];
  recentTransactions: TransactionItem[];
  forecast: ForecastPoint[] | null;
  receivables: Receivable[] | null;
  bills: UpcomingBill[] | null;
  categories: CategorySpend[] | null;
  vendors: VendorSummary[] | null;
  report: ReportSummary | null;
  cashManagement: CashManagement | null;
  workflows: WorkflowSuggestion[] | null;
}

/* ───────────────────────── Errors ───────────────────────── */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/* ───────────────────────── Cash-flow dashboard (mock API) ───────────────────────── */

export const CASH_ACCOUNT_TYPES = ['CHECKING', 'SAVINGS', 'CREDIT', 'MONEY_MARKET', 'PAYMENT_PROCESSOR'] as const;
export type CashAccountType = (typeof CASH_ACCOUNT_TYPES)[number];

export type ConnectionStatus = 'CONNECTED' | 'RECONNECT_REQUIRED' | 'SYNCING';

export interface CashAccount {
  id: string;
  institutionId: string;
  institutionName: string;
  name: string;
  /** Last four digits, or null for processors without an account number. */
  mask: string | null;
  type: CashAccountType;
  currency: 'USD';
  /** Posted (ledger) balance. */
  bookBalance: number;
  /** Book balance less pending outflows. */
  availableBalance: number;
  lastSyncedAt: string;
  connectionStatus: ConnectionStatus;
  /** Alert when the projected balance falls below this; null when no floor is set. */
  minimumBalance: number | null;
}

export const PAYMENT_METHODS = ['ACH', 'WIRE', 'CHECK', 'DEBIT_CARD', 'CREDIT_CARD', 'ZELLE', 'STRIPE', 'PAYPAL', 'CASH', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const TRANSACTION_STATUSES = ['PENDING', 'POSTED', 'SCHEDULED', 'FAILED', 'CANCELLED'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export type FlowDirection = 'INFLOW' | 'OUTFLOW';
export type TransactionSource = 'BANK_SYNC' | 'MANUAL' | 'FORECAST';
export type ForecastSource = 'MANUAL' | 'RECURRING' | 'INVOICE' | 'BILL' | 'MODEL';

export interface CashTransaction {
  id: string;
  accountId: string;
  date: string;
  postedDate: string | null;
  /** Always positive; `direction` carries the sign. */
  amount: number;
  direction: FlowDirection;
  status: TransactionStatus;
  paymentMethod: PaymentMethod;
  merchant: string;
  description: string;
  categoryId: string;
  source: TransactionSource;
  /** Customer for inflows, when known. */
  counterpartyId: string | null;
  note: string | null;
  /** Present on scheduled (forecast) entries only. */
  forecast: { confidence: number; source: ForecastSource } | null;
  /** Set when the charge looks unusual for this vendor; carries the team's decision once made. */
  review: TransactionReview | null;
}

export interface CashCategory {
  id: string;
  name: string;
  parentId: 'income' | 'expenses';
}

export interface CashCounterparty {
  id: string;
  name: string;
}

export type ForecastScenario = 'expected' | 'conservative' | 'optimistic';
export const FORECAST_HORIZONS = [30, 60, 90, 180, 365] as const;
export type ForecastHorizon = (typeof FORECAST_HORIZONS)[number];

export interface CashflowFilters {
  companyId: string;
  /** null = every account. */
  accountIds: string[] | null;
  /** `last30`, `last90`, or a month as `YYYY-MM`. */
  period: string;
  horizon: ForecastHorizon;
  scenario: ForecastScenario;
}

export interface PeriodOption {
  id: string;
  label: string;
}

export interface ResolvedPeriod extends PeriodOption {
  start: string;
  end: string;
  days: number;
  /** Describes the comparison window, e.g. "vs prior 30 days". */
  compareLabel: string;
}

export interface KpiDelta {
  /** Percent change versus the comparison window, null when there is no basis. */
  pct: number | null;
  abs: number;
  prior: number;
}

export interface CashflowKpis {
  totalCash: {
    book: number;
    available: number;
    pending: number;
    changeThisMonth: number;
    monthLabel: string;
    accountCount: number;
  };
  cashIn: { value: number; delta: KpiDelta };
  cashOut: { value: number; delta: KpiDelta };
  net: { value: number; cashIn: number; cashOut: number; delta: KpiDelta };
  runway: {
    state: 'burning' | 'positive';
    /** Months of cash at the current burn; null when cash-flow positive. */
    months: number | null;
    averageMonthlyNet: number;
    basisMonths: number;
  };
}

export interface BalancePoint {
  date: string;
  balance: number;
}

export interface ProjectionPoint {
  date: string;
  projected: number;
  low: number;
  high: number;
}

export interface CashPosition {
  history: BalancePoint[];
  forecast: ProjectionPoint[];
  horizon: ForecastHorizon;
  scenario: ForecastScenario;
  today: BalancePoint;
  lowest: ProjectionPoint;
  end: ProjectionPoint;
  checkpoints: Array<{ days: number; date: string; balance: number }>;
}

export interface MonthlyFlow {
  month: string;
  label: string;
  cashIn: number;
  cashOut: number;
  /** True for the current month (month to date). */
  partial: boolean;
}

export interface UpcomingItem {
  id: string;
  date: string;
  merchant: string;
  description: string;
  amount: number;
  direction: FlowDirection;
  categoryId: string;
  categoryName: string;
  accountId: string;
  confidence: number;
  source: ForecastSource;
}

export interface UpcomingCash {
  windowDays: number;
  windowEnd: string;
  inflows: UpcomingItem[];
  outflows: UpcomingItem[];
  inflowCount: number;
  outflowCount: number;
  expectedIn: number;
  expectedOut: number;
  netImpact: number;
}

export interface BreakdownSlice {
  id: string;
  label: string;
  amount: number;
  /** 0..1 share of the total. */
  share: number;
}

export interface Breakdown {
  cashOut: BreakdownSlice[];
  cashIn: BreakdownSlice[];
  byCustomer: BreakdownSlice[];
  totalOut: number;
  totalIn: number;
}

export type InsightKind = 'low_balance' | 'spend_anomaly' | 'large_payment' | 'trend' | 'concentration' | 'connection' | 'review';
export type InsightTone = 'warning' | 'positive' | 'info' | 'danger';

export interface CashInsight {
  id: string;
  kind: InsightKind;
  tone: InsightTone;
  title: string;
  body: string;
  figures: Array<{ label: string; value: string; emphasis?: boolean }>;
  accountId: string | null;
  date: string | null;
}

export interface CashflowCompany {
  id: string;
  name: string;
  legalName: string;
}

export interface CashflowDashboard {
  generatedAt: string;
  today: string;
  company: CashflowCompany;
  companies: CashflowCompany[];
  filters: CashflowFilters;
  periods: PeriodOption[];
  period: ResolvedPeriod;
  kpis: CashflowKpis;
  cashPosition: CashPosition;
  monthlyFlows: MonthlyFlow[];
  upcoming: UpcomingCash;
  breakdown: Breakdown;
  accounts: CashAccount[];
  categories: CashCategory[];
  insights: CashInsight[];
  reviews: ReviewQueue;
  recentTransactions: CashTransaction[];
  lastSyncedAt: string;
  dataSource: { provider: 'mock'; label: string };
}

export interface TransactionListResponse {
  items: CashTransaction[];
  total: number;
}

export interface NewTransactionInput {
  accountId: string;
  date: string;
  direction: FlowDirection;
  amount: number;
  merchant: string;
  description?: string;
  categoryId: string;
  paymentMethod: PaymentMethod;
  status: 'POSTED' | 'SCHEDULED';
}

export interface UpdateTransactionInput {
  note?: string | null;
  categoryId?: string;
  description?: string;
  merchant?: string;
}

export interface SyncResponse {
  syncedAt: string;
  accounts: CashAccount[];
  /** Pending transactions that posted during this sync. */
  postedCount: number;
}

/* ───────────────────────── Bill review ───────────────────────── */

export type ReviewReason = 'above_typical' | 'below_typical' | 'possible_duplicate';
export type ReviewStatus = 'open' | 'approved' | 'disputed';
export type ReviewDecision = 'approve' | 'dispute' | 'reopen';

export interface TransactionReview {
  status: ReviewStatus;
  reason: ReviewReason;
  /** What this vendor usually bills (median of prior charges, or the matching charge for duplicates). */
  expected: number;
  typicalLow: number;
  typicalHigh: number;
  deviation: number;
  deviationPct: number;
  /** Prior charges the baseline was built from. */
  sampleSize: number;
  /** For possible duplicates: the earlier charge it matches. */
  duplicateOf: string | null;
  flaggedAt: string;
  resolvedAt: string | null;
  note: string | null;
}

export interface ReviewHistoryPoint {
  id: string;
  date: string;
  amount: number;
}

export interface ReviewQueueItem {
  transaction: CashTransaction;
  accountName: string;
  categoryName: string;
  /** The prior charges from this vendor, oldest first. */
  history: ReviewHistoryPoint[];
}

export interface ReviewQueue {
  open: number;
  approved: number;
  disputed: number;
  items: ReviewQueueItem[];
}

/* ───────────────────────── Financing ───────────────────────── */

export type LoanProductType = 'LINE_OF_CREDIT' | 'SBA_7A' | 'TERM_LOAN' | 'REVENUE_BASED' | 'BUSINESS_CARD' | 'EQUIPMENT';
export type CreditTier = 'A' | 'B' | 'C';

export interface LoanPricing {
  kind: 'amortized' | 'revolving' | 'revenue_share' | 'charge_card';
  apr: number | null;
  termMonths: number | null;
  originationPct: number;
  flatFeePct: number | null;
  holdbackPct: number | null;
  annualFee: number;
  /** 0% intro period for cards. */
  introMonths: number | null;
  /** Monthly processor volume the holdback applies to (revenue-based only). */
  remittanceBase: number | null;
}

export interface LoanCost {
  monthlyPayment: number | null;
  totalRepayment: number;
  totalCost: number;
  payoffMonths: number | null;
}

export interface LoanImpact {
  runwayMonthsAdded: number | null;
  lowestProjectedCashAfter: number;
}

export interface LoanApplication {
  id: string;
  amount: number;
  startedAt: string;
  status: 'started';
  nextSteps: string[];
}

export interface LoanOffer {
  id: string;
  lenderId: string;
  lenderName: string;
  product: string;
  type: LoanProductType;
  amount: number;
  minAmount: number;
  maxAmount: number;
  rateLabel: string;
  termLabel: string;
  fundingDays: string;
  pricing: LoanPricing;
  cost: LoanCost;
  impact: LoanImpact;
  fitReason: string;
  highlights: string[];
  requirements: string[];
  recommended: boolean;
  saved: boolean;
  application: LoanApplication | null;
}

export interface CreditProfile {
  tier: CreditTier;
  score: number;
  label: string;
  summary: string;
  factors: Array<{ label: string; value: string; impact: 'positive' | 'neutral' | 'negative' }>;
  annualRevenue: number;
  monthlyRevenue: number;
  totalCash: number;
  cashBufferMonths: number;
  /** Positive when the business is burning cash; 0 when cash-flow positive. */
  monthlyBurn: number;
  runwayMonths: number | null;
  lowestProjectedCash: number;
  monthsToLowest: number;
  existingDebtService: number;
}

export interface LoanOffersResponse {
  generatedAt: string;
  companyId: string;
  headline: string;
  subheadline: string;
  profile: CreditProfile;
  offers: LoanOffer[];
  recommendedOfferId: string | null;
}
