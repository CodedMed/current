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
    return { deposits, withdrawals, purchases, bills, transfers };
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
