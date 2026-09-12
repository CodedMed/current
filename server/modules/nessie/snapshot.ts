import { mapWithConcurrency } from '../../lib/http.ts';
import type { WorkspaceState } from '../../store/userStore.ts';
import type { NessieAccount, NessieApi, NessieSnapshot } from './types.ts';

function uniqueById<T extends { _id: string }>(items: T[]): T[] {
  const seen = new Map<string, T>();
  for (const item of items) if (!seen.has(item._id)) seen.set(item._id, item);
  return [...seen.values()];
}

/**
 * Reads everything the dashboard needs for a workspace in one pass. Merchant
 * names come from the provisioning record when available and are fetched from
 * the API otherwise, so accounts with real (non-seeded) activity still resolve.
 */
export async function fetchSnapshot(api: NessieApi, workspace: WorkspaceState): Promise<NessieSnapshot> {
  const customer = await api.getCustomer(workspace.nessieCustomerId);

  let accounts: NessieAccount[] = await api.listAccounts(workspace.nessieCustomerId);
  if (accounts.length === 0) {
    accounts = await mapWithConcurrency(workspace.accountIds, 3, (id) => api.getAccount(id));
  }

  const perAccount = await mapWithConcurrency(accounts, 3, async (account) => {
    const [deposits, withdrawals, purchases, bills, transfers] = await Promise.all([
      api.listDeposits(account._id),
      api.listWithdrawals(account._id),
      api.listPurchases(account._id),
      api.listBills(account._id),
      api.listTransfers(account._id),
    ]);
    // Nessie's list responses do not always carry the owning account; stamp it from the request.
    const id = account._id;
    return {
      deposits: deposits.map((d) => ({ ...d, payee_id: d.payee_id ?? id })),
      withdrawals: withdrawals.map((w) => ({ ...w, payer_id: w.payer_id ?? id })),
      purchases: purchases.map((p) => ({ ...p, payer_id: p.payer_id ?? id })),
      bills: bills.map((b) => ({ ...b, account_id: b.account_id ?? id })),
      transfers: transfers.map((t) => ({ ...t, payer_id: t.payer_id ?? id })),
    };
  });

  const purchases = uniqueById(perAccount.flatMap((p) => p.purchases));
  const merchants: Record<string, { name: string; category: string }> = { ...workspace.merchants };
  const unknownMerchantIds = [...new Set(purchases.map((p) => p.merchant_id))].filter((id) => !merchants[id]);
  await mapWithConcurrency(unknownMerchantIds, 4, async (id) => {
    try {
      const merchant = await api.getMerchant(id);
      merchants[id] = { name: merchant.name, category: merchant.category || 'Other' };
    } catch {
      merchants[id] = { name: 'Unknown merchant', category: 'Other' };
    }
  });

  return {
    customer,
    accounts,
    deposits: uniqueById(perAccount.flatMap((p) => p.deposits)),
    withdrawals: uniqueById(perAccount.flatMap((p) => p.withdrawals)),
    purchases,
    bills: uniqueById(perAccount.flatMap((p) => p.bills)),
    transfers: uniqueById(perAccount.flatMap((p) => p.transfers)),
    merchants,
  };
}
