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
