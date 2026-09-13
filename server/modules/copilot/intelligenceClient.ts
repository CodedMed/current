import type { AdvisorContext, AdvisorReply, AdvisorTurn, ExtractionResult, InvoiceRiskResult, TranslateResponse, VoiceSession } from '../../../shared/copilot.ts';
import type { CopilotConfig } from '../../config.ts';
import { callUpstream, type UpstreamRequest } from './upstream.ts';

export interface IntelligenceHealth {
  status: string;
  service: string;
  demoMode: boolean;
  adapters: { localExtractor: string; advisor: string; voice: string };
}

/** The invoice fields the risk engine compares against vendor history. */
export interface InvoiceUnderReview {
  vendorKey: string;
  vendorDisplayName: string | null;
  amount: number;
  invoiceDate: string | null;
  dueDate: string | null;
  invoiceNumberHash: string | null;
  paymentDestinationFingerprint: string | null;
}

export interface HistoricalInvoice {
  amount: number;
  invoiceDate: string | null;
  paidDate: string | null;
  invoiceNumberHash: string | null;
  paymentDestinationFingerprint: string | null;
}

/**
 * Typed client for the Python intelligence service. It holds no financial
 * state: documents come back as validated structure, invoices as anomaly
 * scores, questions as advisor replies. Persistence goes through the ledger.
 */
export class IntelligenceClient {
  readonly baseUrl: string;
  readonly #token: string;

  constructor(config: CopilotConfig) {
    this.baseUrl = config.intelligenceUrl;
    this.#token = config.internalServiceToken;
  }

  #call<T>(request: UpstreamRequest): Promise<T> {
    return callUpstream<T>('intelligence', this.baseUrl, { 'X-Internal-Service-Token': this.#token }, request);
  }

  /** Unauthenticated liveness check; reports which adapter backs each integration. */
  health(): Promise<IntelligenceHealth> {
    return callUpstream<IntelligenceHealth>('intelligence', this.baseUrl, {}, { path: '/health', timeoutMs: 5_000 });
  }

  /**
   * Streams the upload straight through. Express never writes the bytes to disk
   * and the service deletes its temp copy before responding; only the validated
   * extraction comes back.
   */
  extractDocument(file: File): Promise<ExtractionResult> {
    const form = new FormData();
    form.append('file', file, file.name);
    // Local OCR + a local model can take a while on a laptop.
    return this.#call({ method: 'POST', path: '/v1/documents/extract', body: form, timeoutMs: 180_000 });
  }

  scoreInvoice(invoice: InvoiceUnderReview, history: HistoricalInvoice[]): Promise<InvoiceRiskResult> {
    return this.#call({ method: 'POST', path: '/v1/risk/invoice', json: { invoice, history } });
  }

  /** `history` is continuity only (the last few turns); the facts are always the fresh ledger context. */
  advise(message: string, language: string, context: AdvisorContext, history: AdvisorTurn[] = []): Promise<AdvisorReply> {
    return this.#call({ method: 'POST', path: '/v1/advisor/chat', json: { message, language, history, context }, timeoutMs: 90_000 });
  }

  /**
   * Interface translation. Strings the model could not translate are absent from the result,
   * and the caller keeps the English source for those.
   */
  translate(language: string, strings: string[]): Promise<TranslateResponse> {
    return this.#call({ method: 'POST', path: '/v1/i18n/translate', json: { language, strings }, timeoutMs: 60_000 });
  }

  voiceSession(language: string): Promise<VoiceSession> {
    return this.#call({ method: 'POST', path: '/v1/voice/session', json: { language } });
  }

  /** A spoken turn runs the same advisor logic as text; only the transport differs. */
  voiceMessage(message: string, language: string, context: AdvisorContext, history: AdvisorTurn[] = []): Promise<AdvisorReply> {
    return this.#call({ method: 'POST', path: '/v1/voice/message', json: { message, language, history, context }, timeoutMs: 90_000 });
  }
}
