import assert from 'node:assert/strict';
import { it } from 'node:test';
import { InMemoryUserRepository } from '../../../store/userStore.ts';
import { InMemoryNessieClient } from '../../nessie/fixtureClient.ts';
import { NessieCashflowStore } from './nessieStore.ts';
import { InMemoryOverlayRepository } from './overlayStore.ts';

it('refreshes downstream financial data after a bank transaction is saved and before returning', async () => {
  const bank = new InMemoryNessieClient();
  const users = new InMemoryUserRepository();
  const user = await users.upsertFromProfile({
    provider: 'google', subject: 'bank-mutation-test', email: 'owner@example.com', emailVerified: true,
    name: 'Demo Owner', givenName: 'Demo', familyName: 'Owner', picture: null,
  }, 'sandbox');
  const customer = await bank.createCustomer({
    first_name: 'Demo', last_name: 'Owner',
    address: { street_number: '1', street_name: 'Main', city: 'Austin', state: 'TX', zip: '78701' },
  });
  const account = await bank.createAccount(customer._id, { type: 'Checking', nickname: 'Operating', balance: 1000, rewards: 0 });
  await users.update(user.id, (owner) => {
    owner.workspace = {
      mode: 'sandbox', businessName: 'Demo business', nessieCustomerId: customer._id, accountIds: [account._id],
      merchants: {}, balancesApplied: true, provisionedAt: new Date().toISOString(),
    };
  });

  let enterRefresh!: () => void;
  let releaseRefresh!: () => void;
  const entered = new Promise<void>((resolve) => { enterRefresh = resolve; });
  const refreshed = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  const store = new NessieCashflowStore(bank, users, new InMemoryOverlayRepository(), {
    onTransactionAdded: async (owner) => {
      assert.equal(owner.id, user.id);
      assert.equal((await bank.getAccount(account._id)).balance, 1250);
      enterRefresh();
      await refreshed;
    },
  });
  const dashboard = await store.dashboard(user.id, {
    companyId: customer._id, accountIds: null, period: 'last30', horizon: 30, scenario: 'expected',
  });
  let returned = false;
  const adding = store.addTransaction(user.id, customer._id, {
    accountId: account._id, date: new Date().toISOString().slice(0, 10), direction: 'INFLOW', amount: 250,
    merchant: 'Client', categoryId: dashboard.categories[0]!.id, paymentMethod: 'ACH', status: 'POSTED',
  }).then((transaction) => { returned = true; return transaction; });
  await entered;
  assert.equal(returned, false);
  releaseRefresh();
  assert.equal((await adding).amount, 250);
});
