/**
 * Runs only when DATABASE_URL points at a reachable PostgreSQL (the repo's
 * `npm test` loads .env, so a developer with `scripts/db.sh up` exercises it;
 * CI without a database skips). Rows are namespaced and removed afterwards.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { Logger } from '../lib/logger.ts';
import { PostgresOverlayRepository } from '../modules/cashflow/nessie/overlayStore.ts';
import { connectDatabase, type Pool } from './postgres.ts';
import { PostgresUserRepository } from './postgresUserStore.ts';
import type { AuthProfile } from './userStore.ts';

const url = process.env.DATABASE_URL?.trim();
const quiet: Logger = { info() {}, warn() {}, error() {} };
const run = randomUUID().slice(0, 8);
const subject = (n: string) => `test-${run}-${n}`;

function profile(n: string, email = `${n}@example.test`): AuthProfile {
  return { provider: 'google', subject: subject(n), email, emailVerified: true, name: 'Test User', givenName: 'Test', familyName: 'User', picture: null };
}

describe('PostgresUserRepository', { skip: url ? false : 'DATABASE_URL not set' }, () => {
  let pool: Pool;
  let users: PostgresUserRepository;

  before(async () => {
    pool = await connectDatabase(url!, quiet);
    users = new PostgresUserRepository(pool);
  });
  after(async () => {
    await pool.query(`DELETE FROM keel.users WHERE provider_subject LIKE $1`, [`test-${run}-%`]);
    await pool.end();
  });

  it('creates a user on first sign-in and finds the same row on the next one', async () => {
    const first = await users.upsertFromProfile(profile('a'), 'sandbox');
    await users.update(first.id, (u) => {
      u.identity.status = 'approved';
      u.onboarding.businessType = 'retail';
    });

    const again = await users.upsertFromProfile(profile('a', 'renamed@example.test'), 'sandbox');
    assert.equal(again.id, first.id);
    assert.equal(again.email, 'renamed@example.test', 'profile columns refresh');
    assert.equal(again.identity.status, 'approved', 'identity is not reset by a returning sign-in');
    assert.equal(again.onboarding.businessType, 'retail');
    assert.equal(again.createdAt, first.createdAt);
  });

  it('persists nested mutations so a fresh repository instance (a restarted process) sees them', async () => {
    const user = await users.upsertFromProfile(profile('b'), 'sandbox');
    await users.update(user.id, (u) => {
      u.identity = { mode: 'live', status: 'pending', inquiryId: `inq_${run}`, detail: null, updatedAt: '2026-09-12T00:00:00.000Z' };
      u.workspace = {
        mode: 'live',
        businessName: 'Juniper Kitchen & Bar',
        nessieCustomerId: 'cust_1',
        accountIds: ['acc_1', 'acc_2'],
        merchants: { m1: { name: 'Sysco', category: 'food' } },
        balancesApplied: false,
        provisionedAt: '2026-09-12T00:00:00.000Z',
      };
    });

    const fresh = new PostgresUserRepository(pool);
    const loaded = await fresh.get(user.id);
    assert.ok(loaded);
    assert.equal(loaded.workspace?.businessName, 'Juniper Kitchen & Bar');
    assert.deepEqual(loaded.workspace?.accountIds, ['acc_1', 'acc_2']);
    assert.equal(loaded.workspace?.merchants.m1?.name, 'Sysco');
    assert.equal(loaded.identity.inquiryId, `inq_${run}`);

    const byInquiry = await fresh.findByInquiryId(`inq_${run}`);
    assert.equal(byInquiry?.id, user.id, 'webhooks resolve the inquiry to the user');
    assert.equal(await fresh.findByProviderSubject('google', subject('nobody')), null);
  });

  it('round-trips workspace overlays through jsonb', async () => {
    const user = await users.upsertFromProfile(profile('c'), 'sandbox');
    const overlays = new PostgresOverlayRepository(pool);
    const empty = await overlays.load(user.id);
    assert.equal(empty.edits.size, 0);
    // (not deepEqual: node's strict assert would narrow `financing` to the literal's type)
    assert.equal(empty.financing.saved.length, 0);
    assert.equal(Object.keys(empty.financing.applications).length, 0);

    empty.edits.set('txn_1', { categoryId: 'software', note: 'Checked against the contract' });
    empty.reviews.set('txn_2', {
      status: 'approved',
      reason: 'above_typical',
      expected: 1395,
      typicalLow: 1116,
      typicalHigh: 1674,
      deviation: 825,
      deviationPct: 59,
      sampleSize: 8,
    } as never);
    empty.financing.saved.push('capone-term');
    empty.financing.applications['capone-term'] = { id: 'capone-term', amount: 25000, startedAt: '2026-09-12T00:00:00.000Z', status: 'started', nextSteps: [] };
    await overlays.save(user.id, empty);
    await overlays.save(user.id, empty); // idempotent upsert

    const back = await new PostgresOverlayRepository(pool).load(user.id);
    assert.deepEqual(back.edits.get('txn_1'), { categoryId: 'software', note: 'Checked against the contract' });
    assert.equal(back.reviews.get('txn_2')?.status, 'approved');
    assert.deepEqual(back.financing.saved, ['capone-term']);
    assert.equal(back.financing.applications['capone-term']?.amount, 25000);
  });
});
