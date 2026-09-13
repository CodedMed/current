import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NessieSnapshot } from '../nessie/types.ts';
import type { WorkspaceState } from '../../store/userStore.ts';
import { bankSnapshotKey, toBankSnapshot } from './bankSnapshot.ts';

function workspace(balancesApplied: boolean): WorkspaceState {
  return {
    mode: 'sandbox',
    businessName: 'Juniper Kitchen',
    nessieCustomerId: 'cust-1',
    accountIds: ['acc-op', 'acc-card'],
    merchants: { m1: { name: 'Sysco', category: 'Food & Beverage' } },
    balancesApplied,
    provisionedAt: '2026-09-12T00:00:00.000Z',
  };
}

function snapshot(): NessieSnapshot {
  return {
    customer: { _id: 'cust-1', first_name: 'Jordan', last_name: 'Rivera', address: { street_number: '1', street_name: 'Main', city: 'Houston', state: 'TX', zip: '77001' } },
    accounts: [
      { _id: 'acc-op', type: 'Checking', nickname: 'Operating', rewards: 0, balance: 1000, customer_id: 'cust-1' },
      { _id: 'acc-card', type: 'Credit Card', nickname: 'Card', rewards: 0, balance: 300, customer_id: 'cust-1' },
    ],
    deposits: [
      { _id: 'dep-1', type: 'deposit', transaction_date: '2026-09-10', status: 'completed', payee_id: 'acc-op', medium: 'balance', amount: 500, description: 'Client payment · Acme' },
      { _id: 'dep-2', type: 'deposit', transaction_date: '2026-09-30', status: 'pending', payee_id: 'acc-op', medium: 'balance', amount: 4000, description: 'Invoice 1041 · Client A · net 30' },
    ],
    withdrawals: [{ _id: 'wd-1', type: 'withdrawal', transaction_date: '2026-09-08', status: 'completed', payer_id: 'acc-op', medium: 'balance', amount: 200, description: 'Payroll · Gusto' }],
    purchases: [{ _id: 'pur-1', type: 'merchant', merchant_id: 'm1', payer_id: 'acc-card', purchase_date: '2026-09-09', amount: 50, status: 'completed', medium: 'balance', description: 'Weekly produce' }],
    bills: [{ _id: 'bill-1', status: 'recurring', payee: 'Harbor Property Group', nickname: 'Office rent', payment_date: '2026-08-01', recurring_date: 1, upcoming_payment_date: '2026-10-01', payment_amount: 2200, account_id: 'acc-op' }],
    transfers: [],
    merchants: { m1: { name: 'Sysco', category: 'Food & Beverage' } },
  };
}

describe('toBankSnapshot', () => {
  it('derives deposit-account balances from settled history when the bank did not apply it, and leaves cards as owed', () => {
    const push = toBankSnapshot(workspace(false), snapshot());
    assert.equal(push.customerId, 'cust-1');
    assert.deepEqual(push.accounts.map((a) => [a.id, a.balance]), [['acc-op', 1300], ['acc-card', 300]]);
  });

  it('keeps the bank balances when the bank applied the history itself', () => {
    const push = toBankSnapshot(workspace(true), snapshot());
    assert.deepEqual(push.accounts.map((a) => a.balance), [1000, 300]);
  });

  it('carries merchant names, calendar dates and the bill schedule the ledger normalises', () => {
    const push = toBankSnapshot(workspace(true), snapshot());
    assert.deepEqual(push.purchases[0], { id: 'pur-1', accountId: 'acc-card', date: '2026-09-09', status: 'completed', amount: 50, description: 'Weekly produce', merchantName: 'Sysco', merchantCategory: 'Food & Beverage' });
    assert.equal(push.deposits[1]?.status, 'pending');
    assert.equal(push.withdrawals[0]?.description, 'Payroll · Gusto');
    assert.deepEqual(push.bills[0], { id: 'bill-1', accountId: 'acc-op', payee: 'Harbor Property Group', nickname: 'Office rent', paymentDate: '2026-10-01', status: 'recurring', amount: 2200, recurring: true });
  });

  it('fingerprints the snapshot so an unchanged one is not pushed twice', () => {
    const a = bankSnapshotKey(toBankSnapshot(workspace(true), snapshot()));
    const b = bankSnapshotKey(toBankSnapshot(workspace(true), snapshot()));
    assert.equal(a, b);
    const changed = snapshot();
    changed.deposits[0]!.amount = 501;
    assert.notEqual(bankSnapshotKey(toBankSnapshot(workspace(true), changed)), a);
  });
});
