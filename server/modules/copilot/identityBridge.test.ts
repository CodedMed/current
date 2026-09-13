/**
 * The bridge keeps the ledger in step with Express: one mirror, one bank snapshot push, the right
 * kind of demo seed, and recovery when the ledger has lost the user.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { CopilotMe, NessieSyncResult } from '../../../shared/copilot.ts';
import { loadConfig } from '../../config.ts';
import type { UserRecord } from '../../store/userStore.ts';
import type { NessieSnapshot } from '../nessie/types.ts';
import { CopilotIdentityBridge } from './identityBridge.ts';
import type { LedgerClient } from './ledgerClient.ts';

const config = loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 'x'.repeat(32), DEMO_MODE: 'true', CASHFLOW_SOURCE: 'nessie' });

function user(withWorkspace: boolean): UserRecord {
  return {
    id: 'u1',
    provider: 'google',
    providerSubject: 'sub-1',
    email: 'owner@example.com',
    name: 'Jordan Rivera',
    givenName: 'Jordan',
    familyName: 'Rivera',
    picture: null,
    createdAt: '2026-09-12T00:00:00Z',
    identity: { mode: 'sandbox', status: 'approved', inquiryId: 'inq_1', detail: null, updatedAt: null },
    onboarding: { businessType: 'restaurant', features: ['expenses'], completedAt: null },
    workspace: withWorkspace
      ? { mode: 'sandbox', businessName: 'Juniper Kitchen', nessieCustomerId: 'cust-1', accountIds: ['acc-1'], merchants: {}, balancesApplied: true, provisionedAt: '2026-09-12T00:00:00Z' }
      : null,
  };
}

function snapshot(balance = 1000): NessieSnapshot {
  return {
    customer: { _id: 'cust-1', first_name: 'J', last_name: 'R', address: { street_number: '1', street_name: 'Main', city: 'Houston', state: 'TX', zip: '77001' } },
    accounts: [{ _id: 'acc-1', type: 'Checking', nickname: 'Operating', rewards: 0, balance, customer_id: 'cust-1' }],
    deposits: [],
    withdrawals: [],
    purchases: [],
    bills: [],
    transfers: [],
    merchants: {},
  };
}

function fakeLedger() {
  const calls = { mirror: 0, seed: [] as boolean[], push: 0 };
  let ledgerUserId = 'L1';
  let personaStatus: CopilotMe['personaStatus'] = 'unverified';
  const me = (): CopilotMe => ({ userId: ledgerUserId, subject: 'google:sub-1', email: null, displayName: null, personaStatus, verified: personaStatus === 'approved' });
  const ledger = {
    me: async () => me(),
    syncPersonaStatus: async (_subject: string, status: CopilotMe['personaStatus']) => {
      calls.mirror += 1;
      personaStatus = status;
      return me();
    },
    seedDemo: async (_subject: string, includeBankData: boolean) => {
      calls.seed.push(includeBankData);
      return { seeded: true, bankEvents: includeBankData ? 15 : 0, ledgerEvents: 0, invoices: 12, todos: includeBankData ? 2 : 0 };
    },
    pushBankSnapshot: async (): Promise<NessieSyncResult> => {
      calls.push += 1;
      return { insertedEvents: 3, updatedEvents: 0, syncedAt: '2026-09-12T00:00:00Z' };
    },
  } as unknown as LedgerClient;
  return {
    ledger,
    calls,
    /** Simulates the ledger restarting on an empty embedded database. */
    reset: () => {
      ledgerUserId = 'L2';
      personaStatus = 'unverified';
    },
  };
}

describe('CopilotIdentityBridge', () => {
  let fake: ReturnType<typeof fakeLedger>;
  let snapshotReads: number;
  let source: (u: UserRecord) => Promise<NessieSnapshot>;

  beforeEach(() => {
    fake = fakeLedger();
    snapshotReads = 0;
    source = async () => {
      snapshotReads += 1;
      return snapshot();
    };
  });

  it('pushes a workspace user’s snapshot once and seeds only the vendor history', async () => {
    const bridge = new CopilotIdentityBridge(fake.ledger, config, { snapshot: source });
    assert.equal(await bridge.prepare(user(true)), 'google:sub-1');
    await bridge.prepare(user(true));
    assert.equal(fake.calls.mirror, 1);
    assert.equal(fake.calls.push, 1);
    assert.equal(snapshotReads, 1);
    assert.deepEqual(fake.calls.seed, [false]);
  });

  it('gives a user without a workspace the whole demo business and pushes nothing', async () => {
    const bridge = new CopilotIdentityBridge(fake.ledger, config, { snapshot: source });
    await bridge.prepare(user(false));
    assert.equal(fake.calls.push, 0);
    assert.deepEqual(fake.calls.seed, [true]);
  });

  it('seeds only once when dashboard and forecast prepare a new user concurrently', async () => {
    const bridge = new CopilotIdentityBridge(fake.ledger, config, { snapshot: source });
    await Promise.all([bridge.prepare(user(true)), bridge.prepare(user(true)), bridge.prepare(user(true))]);
    assert.deepEqual(fake.calls.seed, [false]);
    assert.equal(fake.calls.push, 1);
  });

  it('does not re-push an unchanged snapshot but does push a changed or forced one', async () => {
    const bridge = new CopilotIdentityBridge(fake.ledger, config, { snapshot: source });
    await bridge.prepare(user(true));
    assert.equal(await bridge.pushWorkspace(user(true), { snapshot: snapshot() }), null);
    assert.equal(fake.calls.push, 1);
    assert.ok(await bridge.pushWorkspace(user(true), { snapshot: snapshot(2000) }));
    assert.equal(fake.calls.push, 2);
    assert.ok(await bridge.pushWorkspace(user(true), { snapshot: snapshot(2000), force: true }));
    assert.equal(fake.calls.push, 3);
  });

  it('re-mirrors, re-pushes and re-seeds when the ledger has lost the user', async () => {
    const bridge = new CopilotIdentityBridge(fake.ledger, config, { snapshot: source });
    await bridge.prepare(user(true));
    fake.reset();
    await bridge.prepare(user(true));
    assert.equal(fake.calls.mirror, 2);
    assert.equal(fake.calls.push, 2);
    assert.deepEqual(fake.calls.seed, [false, false]);
  });

  it('a forced refresh waits for an older in-flight push and then reads the latest balance', async () => {
    let releaseSnapshot!: (value: NessieSnapshot) => void;
    const firstRead = new Promise<NessieSnapshot>((resolve) => { releaseSnapshot = resolve; });
    const balances: number[] = [];
    fake.ledger.pushBankSnapshot = async (_subject, payload) => {
      balances.push(payload.accounts[0]!.balance);
      return { insertedEvents: 0, updatedEvents: 1, syncedAt: '2026-09-12T00:00:00Z' };
    };
    const bridge = new CopilotIdentityBridge(fake.ledger, config, {
      snapshot: async () => ++snapshotReads === 1 ? firstRead : snapshot(2500),
    });
    const initial = bridge.pushWorkspace(user(true));
    const refresh = bridge.pushWorkspace(user(true), { force: true });
    releaseSnapshot(snapshot(1000));
    await Promise.all([initial, refresh]);
    assert.equal(snapshotReads, 2);
    assert.deepEqual(balances, [1000, 2500]);
  });

  it('keeps answering when the bank snapshot cannot be read', async () => {
    const bridge = new CopilotIdentityBridge(fake.ledger, config, {
      snapshot: async () => {
        throw new Error('Nessie is down');
      },
    });
    await bridge.prepare(user(true));
    assert.equal(fake.calls.push, 0);
    assert.deepEqual(fake.calls.seed, [false]);
  });
});
