import { Readable } from 'node:stream';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  ADVISOR_LANGUAGES,
  type AdvisorReply,
  type CashFlowForecast,
  type CopilotHealth,
  type CopilotInvoice,
  type CopilotMe,
  type DocumentUploadEvent,
  type InvoiceRiskResult,
  type SavedDocumentResult,
} from '../../../shared/copilot.ts';
import type { AppConfig } from '../../config.ts';
import { HttpError, badRequest, notFound } from '../../lib/errors.ts';
import { currentUser, requireUser, requireVerified } from '../../lib/guards.ts';
import { createLogger } from '../../lib/logger.ts';
import type { CopilotIdentityBridge } from './identityBridge.ts';
import type { HistoricalInvoice, IntelligenceClient } from './intelligenceClient.ts';
import type { LedgerClient, LedgerInvoice } from './ledgerClient.ts';
import { EXPECTED_SERVICE_NAMES, UpstreamError } from './upstream.ts';

const log = createLogger('copilot');

export interface CopilotRouterDeps {
  config: AppConfig;
  ledger: LedgerClient;
  intelligence: IntelligenceClient;
  identity: CopilotIdentityBridge;
}

/* ───────────────────────── Validation ───────────────────────── */

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const UPLOAD_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);

const horizonQuery = z.object({ horizonDays: z.coerce.number().int().min(1).max(365).optional() });
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.');
const language = z.enum(ADVISOR_LANGUAGES).catch('en');

/** Prior turns come back from the browser for continuity only; they can never carry facts. */
const historyTurn = z.object({
  role: z.enum(['user', 'advisor']),
  content: z.string().trim().min(1).max(4000),
});
const askBody = z.object({
  message: z.string().trim().min(1, 'A question is required.').max(2000),
  language,
  history: z.array(historyTurn).max(12).optional(),
});
const voiceSessionBody = z.object({ language });

const cashEventsQuery = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
const manualCashEventBody = z.object({
  eventTime: z.iso.datetime({ offset: true }),
  amount: z.number().min(0).max(100_000_000),
  direction: z.enum(['IN', 'OUT']),
  category: z.string().trim().min(1).max(100),
  description: z.string().trim().max(200).optional(),
  recurring: z.boolean().optional(),
  status: z.enum(['ACTUAL', 'EXPECTED', 'OVERDUE', 'CANCELLED']).optional(),
});

const todoSource = z.enum(['MANUAL', 'ADVISOR', 'RISK', 'FORECAST']);
const todoStatus = z.enum(['PROPOSED', 'APPROVED', 'DECLINED', 'IN_PROGRESS', 'COMPLETED']);
const todoPriority = z.enum(['LOW', 'MEDIUM', 'HIGH']);
const createTodoBody = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  source: todoSource.optional(),
  status: todoStatus.optional(),
  priority: todoPriority.optional(),
  dueDate: isoDay.nullable().optional(),
  recommendationId: z.uuid().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
const updateTodoBody = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    status: todoStatus.optional(),
    priority: todoPriority.optional(),
    dueDate: isoDay.nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to update.');

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid request.';
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw badRequest(firstIssue(parsed.error));
  return parsed.data;
}

/* ───────────────────────── Helpers ───────────────────────── */

function subjectOf(res: Response): string {
  const subject = res.locals.copilotSubject;
  if (!subject) throw new Error('Copilot subject missing after the prepare middleware.');
  return subject;
}

/** The hashes are only needed server-side for risk scoring; the browser never needs them. */
function toPublicInvoice(invoice: LedgerInvoice): CopilotInvoice {
  const { paymentDestinationFingerprint: _fingerprint, invoiceNumberHash: _number, ...rest } = invoice;
  return rest;
}

/**
 * History is every other invoice from the same vendor dated on or before the one under review:
 * later invoices are not "history" for an older one, and same-day entries stay in so a duplicate
 * can be recognised. Both hashes travel with each entry — the fingerprint feeds the
 * destination-changed rule, the number hash the duplicate rule.
 */
function toHistory(invoice: LedgerInvoice, all: LedgerInvoice[]): HistoricalInvoice[] {
  return all
    .filter(
      (candidate) =>
        candidate.id !== invoice.id &&
        candidate.vendorKey === invoice.vendorKey &&
        (candidate.invoiceDate === null || invoice.invoiceDate === null || candidate.invoiceDate <= invoice.invoiceDate),
    )
    .map((candidate) => ({
      amount: candidate.amount,
      invoiceDate: candidate.invoiceDate,
      paidDate: candidate.paidDate,
      invoiceNumberHash: candidate.invoiceNumberHash,
      paymentDestinationFingerprint: candidate.paymentDestinationFingerprint,
    }));
}

/**
 * Reads the multipart upload without touching disk. The bytes are validated,
 * handed straight to the intelligence service, and dropped; Express keeps no
 * copy and never logs the contents.
 */
async function readUpload(req: Request): Promise<File> {
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.startsWith('multipart/form-data')) {
    throw badRequest('Send the document as multipart/form-data with a "file" field.');
  }
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) {
    throw new HttpError(413, 'DOCUMENT_UNSUPPORTED', 'Choose a PDF, PNG, or JPEG up to 10 MB.');
  }
  let form: FormData;
  try {
    form = await new Response(Readable.toWeb(req) as ReadableStream, { headers: { 'content-type': contentType } }).formData();
  } catch {
    throw badRequest('The upload could not be read as multipart/form-data.');
  }
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) throw badRequest('Choose a document to upload.');
  if (file.size > MAX_UPLOAD_BYTES || !UPLOAD_TYPES.has(file.type)) {
    throw new HttpError(415, 'DOCUMENT_UNSUPPORTED', 'Choose a PDF, PNG, or JPEG up to 10 MB.');
  }
  return file;
}

function errorEvent(err: unknown): DocumentUploadEvent {
  if (err instanceof HttpError) {
    return { stage: 'error', error: { code: err.code, message: err.message, retryable: err instanceof UpstreamError ? err.retryable : undefined } };
  }
  log.error('Document upload failed', { message: err instanceof Error ? err.message : String(err) });
  return { stage: 'error', error: { code: 'internal_error', message: 'The document could not be processed.' } };
}

/**
 * BFF for the Cash Flow Copilot backend. Mirrors the Next.js BFF from the MVP
 * one-to-one, with Express's session and Persona decision as the identity
 * source. Every route needs a signed-in, identity-verified user; the browser
 * never reaches the services or their token.
 */
export function createCopilotRouter({ config, ledger, intelligence, identity }: CopilotRouterDeps): Router {
  const router = Router();

  /** Liveness of both services and which adapters back them; readable before verification. */
  router.get('/health', requireUser, async (_req, res) => {
    const [ledgerHealth, intelligenceHealth] = await Promise.allSettled([ledger.health(), intelligence.health()]);
    // A process that answers but is not ours (another project on the same port) is not "ok".
    const wrongApp = (url: string, service: string | undefined, expected: string) =>
      `A different application ("${service ?? 'unknown'}") answers at ${url}; expected ${expected}. Point the service URL at the right port.`;
    const ledgerService = ledgerHealth.status === 'fulfilled' ? (ledgerHealth.value.service ?? null) : null;
    const intelligenceService = intelligenceHealth.status === 'fulfilled' ? (intelligenceHealth.value.service ?? null) : null;
    const ledgerOk = ledgerHealth.status === 'fulfilled' && ledgerService === EXPECTED_SERVICE_NAMES.ledger;
    const intelligenceOk = intelligenceHealth.status === 'fulfilled' && intelligenceService === EXPECTED_SERVICE_NAMES.intelligence;
    const body: CopilotHealth = {
      ledger: {
        ok: ledgerOk,
        service: ledgerService,
        demoMode: ledgerOk ? ledgerHealth.value.demoMode : null,
        url: ledger.baseUrl,
        error:
          ledgerHealth.status === 'rejected'
            ? String(ledgerHealth.reason?.message ?? ledgerHealth.reason)
            : ledgerOk
              ? null
              : wrongApp(ledger.baseUrl, ledgerService ?? undefined, EXPECTED_SERVICE_NAMES.ledger),
      },
      intelligence: {
        ok: intelligenceOk,
        service: intelligenceService,
        demoMode: intelligenceOk ? intelligenceHealth.value.demoMode : null,
        url: intelligence.baseUrl,
        error:
          intelligenceHealth.status === 'rejected'
            ? String(intelligenceHealth.reason?.message ?? intelligenceHealth.reason)
            : intelligenceOk
              ? null
              : wrongApp(intelligence.baseUrl, intelligenceService ?? undefined, EXPECTED_SERVICE_NAMES.intelligence),
        adapters: intelligenceOk ? intelligenceHealth.value.adapters : null,
      },
    };
    res.set('Cache-Control', 'no-store');
    res.json(body);
  });

  /** The ledger's view of the signed-in user, after mirroring the current Persona decision. */
  router.get('/me', requireUser, async (_req, res) => {
    const me: CopilotMe = await identity.mirror(currentUser(res));
    res.set('Cache-Control', 'no-store');
    res.json(me);
  });

  // Everything below is financial data: identity must be verified, and the
  // decision mirrored to the ledger (which enforces it again on its side).
  router.use(requireVerified(config));
  router.use(async (_req, res, next) => {
    res.locals.copilotSubject = await identity.prepare(currentUser(res));
    next();
  });

  /* ── bank data ── */

  /**
   * Re-syncs bank data. A user with a workspace gets its current snapshot pushed to the ledger
   * (live or sandbox alike); without one the ledger pulls the demo customer from its fixture.
   */
  router.post('/nessie/sync', async (_req, res) => {
    const user = currentUser(res);
    const pushed = await identity.pushWorkspace(user, { force: true });
    res.json(pushed ?? (await ledger.syncNessie(subjectOf(res))));
  });

  router.get('/accounts/summary', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await ledger.accountsSummary(subjectOf(res)));
  });

  /* ── ledger ── */

  router.get('/dashboard', async (req, res) => {
    const { horizonDays } = parse(horizonQuery, req.query);
    res.set('Cache-Control', 'no-store');
    res.json(await ledger.dashboard(subjectOf(res), horizonDays));
  });

  router.get('/forecast', async (req, res) => {
    const { horizonDays } = parse(horizonQuery, req.query);
    res.set('Cache-Control', 'no-store');
    res.json(await ledger.forecast(subjectOf(res), horizonDays));
  });

  router.get('/cash-events', async (req, res) => {
    const { from, to } = parse(cashEventsQuery, req.query);
    res.set('Cache-Control', 'no-store');
    res.json(await ledger.cashEvents(subjectOf(res), from, to));
  });

  router.post('/cash-events/manual', async (req, res) => {
    const input = parse(manualCashEventBody, req.body);
    res.status(201).json(await ledger.createManualCashEvent(subjectOf(res), input));
  });

  /* ── invoices and risk ── */

  router.get('/invoices', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json((await ledger.invoices(subjectOf(res))).map(toPublicInvoice));
  });

  router.get('/invoices/:id', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(toPublicInvoice(await ledger.invoice(subjectOf(res), String(req.params.id))));
  });

  /** Scores an invoice against its vendor history and stores the result on the ledger. */
  async function scoreAndStore(subject: string, invoice: LedgerInvoice, all: LedgerInvoice[]): Promise<InvoiceRiskResult> {
    const risk = await intelligence.scoreInvoice(
      {
        vendorKey: invoice.vendorKey,
        vendorDisplayName: invoice.vendorDisplayName,
        amount: invoice.amount,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        invoiceNumberHash: invoice.invoiceNumberHash,
        paymentDestinationFingerprint: invoice.paymentDestinationFingerprint,
      },
      toHistory(invoice, all),
    );
    await ledger.storeRiskResult(subject, invoice.id, risk);
    return risk;
  }

  router.post('/invoices/:id/risk', async (req, res) => {
    const subject = subjectOf(res);
    const id = String(req.params.id);
    const all = await ledger.invoices(subject);
    const invoice = all.find((candidate) => candidate.id === id);
    if (!invoice) throw notFound('Invoice not found.');
    res.json(await scoreAndStore(subject, invoice, all));
  });

  /* ── documents ── */

  /**
   * Upload → local extraction → ledger persistence → risk score → forecast refresh.
   * With `Accept: application/x-ndjson` the stages stream as they happen so the UI
   * can show "Extracting locally…" from real events rather than a timer.
   */
  router.post('/documents', async (req, res) => {
    const subject = subjectOf(res);
    const file = await readUpload(req);

    const run = async (progress: (stage: 'extracting' | 'validating' | 'scoring') => void): Promise<SavedDocumentResult> => {
      progress('extracting');
      const extraction = await intelligence.extractDocument(file);

      progress('validating');
      const invoice = await ledger.createInvoice(subject, extraction.extraction);

      // From here on the invoice is saved; later failures must not make it look unsaved
      // and invite a duplicate upload, so they degrade to warnings.
      progress('scoring');
      let risk: InvoiceRiskResult | null = null;
      try {
        risk = await scoreAndStore(subject, invoice, await ledger.invoices(subject));
      } catch (err) {
        log.warn('Risk scoring after upload failed', { message: err instanceof Error ? err.message : String(err) });
        extraction.warnings.push('Invoice saved. Risk scoring is unavailable right now; score it from the invoices list later.');
      }

      let forecast: CashFlowForecast | null = null;
      try {
        forecast = await ledger.forecast(subject);
      } catch {
        extraction.warnings.push('Invoice saved. Open the dashboard to refresh the forecast.');
      }

      return { ...extraction, persisted: true, invoice: toPublicInvoice(invoice), risk, forecast };
    };

    if (!req.headers.accept?.includes('application/x-ndjson')) {
      res.json(await run(() => {}));
      return;
    }

    res.status(200);
    res.set({ 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const send = (event: DocumentUploadEvent) => {
      if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
    };
    try {
      const result = await run((stage) => send({ stage }));
      send({ stage: 'saved', result });
    } catch (err) {
      send(errorEvent(err));
    } finally {
      res.end();
    }
  });

  /* ── advisor ── */

  /**
   * The context always comes from the ledger. A browser cannot choose the facts the model reasons
   * over: any `context` in the request body is ignored. Replies are proposals; nothing here writes
   * to the ledger — a recommendation becomes a task only through an explicit `POST /todos`.
   */
  router.post('/advisor', async (req, res) => {
    const { message, language: lang, history } = parse(askBody, req.body);
    const subject = subjectOf(res);
    const context = await ledger.advisorContext(subject);
    const reply: AdvisorReply = await intelligence.advise(message, lang, context, history ?? []);
    res.set('Cache-Control', 'no-store');
    res.json(reply);
  });

  router.post('/voice/session', async (req, res) => {
    const { language: lang } = parse(voiceSessionBody, req.body ?? {});
    res.json(await intelligence.voiceSession(lang));
  });

  /**
   * A spoken turn: same ledger context, same advisor logic, different transport. The browser calls
   * this from the ElevenLabs client tool with the transcribed question; the agent speaks the answer.
   */
  router.post('/voice/message', async (req, res) => {
    const { message, language: lang, history } = parse(askBody, req.body);
    const subject = subjectOf(res);
    const context = await ledger.advisorContext(subject);
    res.set('Cache-Control', 'no-store');
    res.json(await intelligence.voiceMessage(message, lang, context, history ?? []));
  });

  /* ── tasks ── */

  router.get('/todos', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await ledger.todos(subjectOf(res)));
  });

  router.post('/todos', async (req, res) => {
    const input = parse(createTodoBody, req.body);
    res.status(201).json(await ledger.createTodo(subjectOf(res), input));
  });

  router.patch('/todos/:id', async (req, res) => {
    const patch = parse(updateTodoBody, req.body);
    res.json(await ledger.updateTodo(subjectOf(res), String(req.params.id), patch));
  });

  router.delete('/todos/:id', async (req, res) => {
    await ledger.deleteTodo(subjectOf(res), String(req.params.id));
    res.json({ deleted: true });
  });

  return router;
}
