/**
 * Wire shapes for the Cash Flow Copilot backend: the Java ledger service
 * (authoritative financial state) and the Python intelligence service
 * (documents, anomaly scoring, advisor). The Express BFF forwards these to the
 * browser unchanged under `/api/copilot/*`, so the client and server share them.
 */

/* ───────────────────────── Identity ───────────────────────── */

export type CopilotPersonaStatus = 'unverified' | 'pending' | 'approved' | 'declined' | 'failed';

export interface CopilotMe {
  userId: string;
  subject: string;
  email: string | null;
  displayName: string | null;
  personaStatus: CopilotPersonaStatus;
  verified: boolean;
}

/* ───────────────────────── Ledger ───────────────────────── */

export type CashEventDirection = 'IN' | 'OUT';
export type CashEventStatus = 'ACTUAL' | 'EXPECTED' | 'OVERDUE' | 'CANCELLED';
export type CashEventSource = 'NESSIE' | 'DOCUMENT' | 'MANUAL' | 'SYSTEM';

export interface CashEvent {
  id: string;
  eventTime: string;
  amount: number;
  direction: CashEventDirection;
  category: string;
  source: CashEventSource;
  description: string | null;
  recurring: boolean;
  status: CashEventStatus;
  metadata: Record<string, unknown>;
}

export interface ManualCashEventInput {
  eventTime: string;
  amount: number;
  direction: CashEventDirection;
  category: string;
  description?: string;
  recurring?: boolean;
  status?: CashEventStatus;
}

export interface AccountsSummary {
  totalBalance: number;
  accounts: Array<{ id: string; nickname: string; type: string; balance: number }>;
  lastSyncedAt: string | null;
}

export interface NessieSyncResult {
  insertedEvents: number;
  updatedEvents: number;
  syncedAt: string;
}

export interface CashFlowForecast {
  currentCash: number;
  expectedInflow: number;
  expectedOutflow: number;
  timeline: Array<{
    time: string;
    delta: number;
    projectedBalance: number;
    cashEventId: string;
    label?: string;
    direction?: CashEventDirection;
    status?: CashEventStatus;
  }>;
  firstGapDate: string | null;
  firstGapAmount: number | null;
  contributingEventIds: string[];
  horizonDays: number;
  generatedAt: string;
}

export interface CopilotSeriesPoint {
  date: string;
  actualBalance: number | null;
  projectedBalance: number | null;
  inflow: number;
  outflow: number;
}

export interface CopilotDashboard {
  totals: {
    availableCash: number;
    expectedInflow30d: number;
    expectedOutflow30d: number;
    net30d: number;
  };
  projectedGap: {
    present: boolean;
    date: string | null;
    amount: number | null;
    daysFromNow: number | null;
  };
  cashFlowSeries: CopilotSeriesPoint[];
  upcomingObligations: Array<{
    cashEventId: string;
    dueDate: string;
    label: string;
    category: string;
    amount: number;
    status: CashEventStatus;
  }>;
  overdueReceivables: Array<{
    cashEventId: string;
    counterpartyLabel: string;
    amount: number;
    dueDate: string;
    daysOverdue: number;
  }>;
  highRiskInvoices: Array<{
    invoiceId: string;
    vendorLabel: string;
    riskScore: number;
    severity: RiskSeverity;
    reasons: string[];
  }>;
  priorityTasks: Array<{
    id: string;
    title: string;
    status: TodoStatus;
    priority: TodoPriority;
    dueDate: string | null;
    source: TodoSource;
  }>;
  meta: {
    horizonDays: number;
    generatedAt: string;
    lastSyncedAt: string | null;
    demoMode: boolean;
  };
}

/* ───────────────────────── Invoices and risk ───────────────────────── */

export type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface CopilotInvoice {
  id: string;
  vendorKey: string;
  vendorDisplayName: string | null;
  amount: number;
  previousAmount: number | null;
  invoiceDate: string | null;
  dueDate: string | null;
  paidDate: string | null;
  status: string;
  recurring: boolean;
  source: string;
  riskScore: number | null;
  riskSeverity: RiskSeverity | null;
  riskReasons: string[];
}

export interface InvoiceRiskResult {
  riskScore: number;
  severity: RiskSeverity;
  rulesScore: number;
  /** Anomaly percentile from the Isolation Forest; null until the vendor has enough history. */
  mlScore: number | null;
  reasons: string[];
  modelVersion: string;
}

export interface StoredInvoiceRisk extends InvoiceRiskResult {
  invoiceId: string;
  vendorLabel: string;
}

/* ───────────────────────── Documents ───────────────────────── */

export interface ExtractedInvoice {
  vendorKey: string;
  vendorDisplayName: string | null;
  amount: number;
  previousAmount: number | null;
  invoiceDate: string | null;
  dueDate: string | null;
  recurring: boolean;
  category: string;
  direction: 'OUT';
  confidence: number;
  /** Local SHA-256 of the printed invoice reference; the number itself never leaves the extractor. */
  invoiceNumberHash: string | null;
  paymentDestinationFingerprint: string | null;
}

export interface ExtractionResult {
  documentType: string;
  extraction: ExtractedInvoice;
  warnings: string[];
}

/** What `POST /api/copilot/documents` returns once the invoice is in the ledger. */
export interface SavedDocumentResult extends ExtractionResult {
  persisted: true;
  invoice: CopilotInvoice;
  /** Scored automatically after saving; null when the risk engine was unavailable. */
  risk: InvoiceRiskResult | null;
  /** Refreshed after saving; null when the refresh failed (the invoice is still saved). */
  forecast: CashFlowForecast | null;
}

export type DocumentUploadStage = 'uploading' | 'extracting' | 'validating' | 'scoring' | 'saved' | 'error';

export type DocumentUploadEvent =
  | { stage: 'extracting' | 'validating' | 'scoring' }
  | { stage: 'saved'; result: SavedDocumentResult }
  | { stage: 'error'; error: { code: string; message: string; retryable?: boolean } };

/* ───────────────────────── Advisor ───────────────────────── */

/**
 * The allowlisted facts the ledger computes for the reasoning layer (`GET /v1/advisor/context`).
 * Always fetched server-side; the browser never supplies or edits it. Every figure is a
 * deterministic ledger result — the advisor explains these numbers, it never recomputes them.
 */
export interface AdvisorContext {
  /** The ledger's "today" (UTC). */
  asOfDate: string;
  horizonDays: number;
  currentCash: number;
  expectedInflow30d: number;
  expectedOutflow30d: number;
  net30d: number;
  expectedInflow60d: number;
  expectedOutflow60d: number;
  net60d: number;
  firstGapDate: string | null;
  firstGapAmount: number | null;
  daysUntilGap: number | null;
  /** Lowest projected balance inside the horizon. */
  projectedLowPoint: { date: string; balance: number; label: string | null } | null;
  projectedEndBalance: number;
  overdueReceivables: Array<{ counterpartyLabel: string; amount: number; daysOverdue: number }>;
  expectedReceivables: Array<{ counterpartyLabel: string; amount: number; dueDate: string; daysUntilDue: number }>;
  /** `daysUntilDue` is negative for an obligation that is already overdue. */
  upcomingObligations: Array<{ label: string; category: string; amount: number; dueDate: string; daysUntilDue: number; status: CashEventStatus }>;
  invoiceRisks: Array<{ invoiceId: string; vendorLabel: string; riskScore: number; severity: RiskSeverity; reasons: string[] }>;
  openTodos: Array<{ id: string; title: string; status: TodoStatus; priority: TodoPriority; dueDate: string | null }>;
}

export interface ProposedAction {
  title: string;
  rationale: string;
  priority: TodoPriority;
  dueDate: string | null;
  estimatedImpact: number | null;
}

/**
 * Every language the ElevenLabs agent can speak, so text and voice never disagree about what
 * is on offer. `SUPPORTED_LANGUAGES` in the environment is what the services enforce; this list
 * is what the web app shows, and the two are meant to match.
 */
export const ADVISOR_LANGUAGES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'hi', 'ja', 'ko', 'zh', 'ar'] as const;
export type AdvisorLanguage = (typeof ADVISOR_LANGUAGES)[number];

export interface LanguageInfo {
  code: AdvisorLanguage;
  /** The name as a speaker of that language writes it — what belongs in the menu. */
  label: string;
  /** The English name, for tooltips and for anyone scanning the list in English. */
  english: string;
  rtl: boolean;
}

export const LANGUAGES: readonly LanguageInfo[] = [
  { code: 'en', label: 'English', english: 'English', rtl: false },
  { code: 'es', label: 'Espa\u00f1ol', english: 'Spanish', rtl: false },
  { code: 'fr', label: 'Fran\u00e7ais', english: 'French', rtl: false },
  { code: 'de', label: 'Deutsch', english: 'German', rtl: false },
  { code: 'it', label: 'Italiano', english: 'Italian', rtl: false },
  { code: 'pt', label: 'Portugu\u00eas', english: 'Portuguese', rtl: false },
  { code: 'nl', label: 'Nederlands', english: 'Dutch', rtl: false },
  { code: 'pl', label: 'Polski', english: 'Polish', rtl: false },
  { code: 'hi', label: '\u0939\u093f\u0928\u094d\u0926\u0940', english: 'Hindi', rtl: false },
  { code: 'ja', label: '\u65e5\u672c\u8a9e', english: 'Japanese', rtl: false },
  { code: 'ko', label: '\ud55c\uad6d\uc5b4', english: 'Korean', rtl: false },
  { code: 'zh', label: '\u4e2d\u6587', english: 'Chinese', rtl: false },
  { code: 'ar', label: '\u0627\u0644\u0639\u0631\u0628\u064a\u0629', english: 'Arabic', rtl: true },
];

export function isAdvisorLanguage(value: string): value is AdvisorLanguage {
  return (ADVISOR_LANGUAGES as readonly string[]).includes(value);
}

export function languageInfo(code: AdvisorLanguage): LanguageInfo {
  return LANGUAGES.find((l) => l.code === code) ?? (LANGUAGES[0] as LanguageInfo);
}

/* ───────────────────── Interface translation ───────────────────── */

export interface TranslateRequest {
  language: AdvisorLanguage;
  strings: string[];
}

export interface TranslateResponse {
  language: AdvisorLanguage;
  /** `none` means nothing was translated: no Gemini key, so the source text stands. */
  provider: 'gemini' | 'none';
  /** Source string → translation, for every string the request could translate. */
  translations: Record<string, string>;
}

export type AdvisorChannel = 'text' | 'voice';

/** A prior turn sent back for continuity. Facts never come from here; the context is re-fetched every turn. */
export interface AdvisorTurn {
  role: 'user' | 'advisor';
  content: string;
}

/** Which adapter produced a reply, so the UI can label demo answers and Gemini fallbacks honestly. */
export interface AdvisorMeta {
  provider: 'gemini' | 'mock';
  model: string | null;
  language: AdvisorLanguage;
  channel: AdvisorChannel;
  /** Set when Gemini was configured but unavailable and the demo advisor answered instead. */
  fallbackReason: string | null;
}

export interface AdvisorReply {
  answer: string;
  summary: string;
  risks: Array<{ title: string; severity: RiskSeverity; explanation: string }>;
  /** Proposals only: nothing becomes a task until the owner adds it explicitly. */
  proposedActions: ProposedAction[];
  meta?: AdvisorMeta;
}

export interface AdvisorAsk {
  message: string;
  language?: AdvisorLanguage;
  history?: AdvisorTurn[];
}

/** Outcome of scoring every invoice that had never been scored. */
export interface RiskBackfillResult {
  scored: number;
  failed: number;
  /** Left over when there were more than one request may score; call again to continue. */
  remaining: number;
}

/* ───────────────────────── Voice ───────────────────────── */

export interface VoiceSession {
  available: boolean;
  mode: 'voice' | 'text';
  language: string;
  supportedLanguages?: string[];
  /** Why voice is unavailable (no ElevenLabs credentials, for example). */
  reason?: string;
  /** Short-lived signed WebSocket URL for the ElevenLabs browser client. */
  signedUrl?: string;
  agentId?: string;
  /**
   * The client tool the ElevenLabs agent calls with the user's question. The browser answers it
   * through `POST /api/copilot/voice/message`, so a spoken turn runs the same advisor pipeline.
   */
  clientToolName?: string;
}

/* ───────────────────────── Tasks ───────────────────────── */

export type TodoSource = 'MANUAL' | 'ADVISOR' | 'RISK' | 'FORECAST';
export type TodoStatus = 'PROPOSED' | 'APPROVED' | 'DECLINED' | 'IN_PROGRESS' | 'COMPLETED';
export type TodoPriority = 'LOW' | 'MEDIUM' | 'HIGH';

export interface CopilotTodo {
  id: string;
  title: string;
  description: string | null;
  source: TodoSource;
  status: TodoStatus;
  priority: TodoPriority;
  dueDate: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTodoInput {
  title: string;
  description?: string | null;
  source?: TodoSource;
  status?: TodoStatus;
  priority?: TodoPriority;
  dueDate?: string | null;
  recommendationId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateTodoInput {
  title?: string;
  description?: string;
  status?: TodoStatus;
  priority?: TodoPriority;
  dueDate?: string | null;
}

/* ───────────────────────── Health ───────────────────────── */

export interface CopilotHealth {
  /** `service` is the name the process at `url` reports; `ok` is false when it is not the expected one. */
  ledger: { ok: boolean; service: string | null; demoMode: boolean | null; url: string; error: string | null };
  intelligence: {
    ok: boolean;
    service: string | null;
    demoMode: boolean | null;
    url: string;
    error: string | null;
    adapters: { localExtractor: string; advisor: string; voice: string } | null;
  };
}
