/**
 * Risk checking is automatic, so the batch route carries the guarantees the per-row button used
 * to: every unscored invoice gets scored, one failure does not lose the others, and a second
 * call does no work.
 */
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import express from 'express';
import type { InvoiceRiskResult, RiskBackfillResult } from '../../../shared/copilot.ts';
import { loadConfig } from '../../config.ts';
import { errorHandler } from '../../lib/errors.ts';
import type { UserRecord } from '../../store/userStore.ts';
import type { CopilotIdentityBridge } from './identityBridge.ts';
import type { IntelligenceClient } from './intelligenceClient.ts';
import type { LedgerClient, LedgerInvoice } from './ledgerClient.ts';
import { createCopilotRouter } from './routes.ts';

function invoice(id: string, scored: boolean): LedgerInvoice {
  return {
    id,
    vendorKey: 'cloud_provider',
    vendorDisplayName: 'Cloud Provider',
    amount: 1300,
    invoiceDate: '2026-09-10',
    dueDate: '2026-09-17',
    paidDate: null,
    status: 'PENDING',
    source: 'SEED',
    recurring: true,
    category: 'cloud_services',
    riskScore: scored ? 0.4 : null,
    riskSeverity: scored ? 'MEDIUM' : null,
    riskReasons: [],
    invoiceNumberHash: `sha256:${id}`,
    paymentDestinationFingerprint: 'sha256:dest',
    createdAt: '2026-09-10T00:00:00Z',
  } as unknown as LedgerInvoice;
}

const risk: InvoiceRiskResult = { score: 0.8, severity: 'HIGH', reasons: [], modelVersion: 'test' } as unknown as InvoiceRiskResult;

function harness() {
  const scored: string[] = [];
  let invoices: LedgerInvoice[] = [];
  let failOn = new Set<string>();

  const ledger = {
    baseUrl: 'http://ledger.test',
    invoices: async () => invoices,
    storeRiskResult: async (_subject: string, id: string) => {
      scored.push(id);
    },
  } as unknown as LedgerClient;

  const intelligence = {
    baseUrl: 'http://intel.test',
    // The invoice under review carries no id, so the number hash is what identifies it here.
    scoreInvoice: async (input: { invoiceNumberHash: string | null }) => {
      const id = input.invoiceNumberHash?.replace('sha256:', '') ?? '';
      if (failOn.has(id)) throw new Error('scoring blew up');
      return risk;
    },
  } as unknown as IntelligenceClient;

  const identity = { prepare: async () => 'google:sandbox-abc', mirror: async () => ({}) } as unknown as CopilotIdentityBridge;
  const config = loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 'x'.repeat(32), DEMO_MODE: 'true' });

  const user: UserRecord = {
    id: 'u1',
    provider: 'google',
    providerSubject: 'sandbox-abc',
    email: 'owner@example.com',
    name: 'Jordan Rivera',
    givenName: 'Jordan',
    familyName: 'Rivera',
    picture: null,
    createdAt: '2026-09-12T00:00:00Z',
    identity: { mode: 'sandbox', status: 'approved', inquiryId: null, detail: null, updatedAt: null },
    onboarding: { businessType: 'consulting', features: ['forecasting'], completedAt: null },
    workspace: null,
  };

  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.user = user;
    next();
  });
  app.use('/api/copilot', createCopilotRouter({ config, ledger, intelligence, identity }));
  app.use(errorHandler);

  return {
    app,
    scored,
    setInvoices: (next: LedgerInvoice[]) => {
      invoices = next;
    },
    setFailing: (ids: string[]) => {
      failOn = new Set(ids);
    },
  };
}

describe('POST /api/copilot/invoices/risk/backfill', () => {
  const h = harness();
  let base = '';
  let server: ReturnType<typeof h.app.listen>;

  before(async () => {
    server = h.app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());
  beforeEach(() => {
    h.scored.length = 0;
    h.setFailing([]);
  });

  const backfill = async (): Promise<RiskBackfillResult> => {
    const res = await fetch(`${base}/api/copilot/invoices/risk/backfill`, { method: 'POST' });
    assert.equal(res.status, 200);
    return (await res.json()) as RiskBackfillResult;
  };

  it('scores every invoice that has never been scored, and leaves the rest alone', async () => {
    h.setInvoices([invoice('a', false), invoice('b', true), invoice('c', false)]);

    const result = await backfill();

    assert.deepEqual(result, { scored: 2, failed: 0, remaining: 0 });
    assert.deepEqual([...h.scored].sort(), ['a', 'c']);
  });

  it('does nothing when everything is already scored', async () => {
    h.setInvoices([invoice('a', true), invoice('b', true)]);

    const result = await backfill();

    assert.deepEqual(result, { scored: 0, failed: 0, remaining: 0 });
    assert.deepEqual(h.scored, []);
  });

  it('keeps going when one invoice fails to score', async () => {
    h.setInvoices([invoice('a', false), invoice('b', false), invoice('c', false)]);
    h.setFailing(['b']);

    const result = await backfill();

    assert.equal(result.scored, 2);
    assert.equal(result.failed, 1);
    assert.deepEqual([...h.scored].sort(), ['a', 'c']);
  });

  it('reports what is left when there are more than one pass can score', async () => {
    h.setInvoices(Array.from({ length: 155 }, (_, i) => invoice(`i${i}`, false)));

    const result = await backfill();

    assert.equal(result.scored, 150);
    assert.equal(result.remaining, 5);
  });
});
