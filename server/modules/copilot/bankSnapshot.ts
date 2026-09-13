import { createHash } from 'node:crypto';
import type { NessieSnapshot } from '../nessie/types.ts';
import { isSettled } from '../nessie/types.ts';
import type { WorkspaceState } from '../../store/userStore.ts';

/**
 * The bank snapshot as the ledger service accepts it (`POST /v1/bank/snapshot`): the Nessie
 * records the BFF already fetched for the user's workspace, with merchant names resolved and
 * balances derived the same way the Keel dashboard derives them. Dates are calendar dates; card
 * balances are the amount owed (positive), which the ledger signs.
 */
export interface BankSnapshotPush {
  customerId: string;
  accounts: Array<{ id: string; type: string; nickname: string; balance: number }>;
  deposits: BankMovement[];
  withdrawals: BankMovement[];
  purchases: Array<BankMovement & { merchantName: string | null; merchantCategory: string | null }>;
  bills: Array<{ id: string; accountId: string; payee: string; nickname: string; paymentDate: string; status: string; amount: number; recurring: boolean }>;
}

export interface BankMovement {
  id: string;
  accountId: string;
  date: string;
  status: string;
  amount: number;
  description: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Net settled movement on an account, for banks that leave balances untouched by seeded history. */
function netSettled(accountId: string, s: NessieSnapshot): number {
  let net = 0;
  for (const d of s.deposits) if (d.payee_id === accountId && isSettled(d.status)) net += d.amount;
  for (const w of s.withdrawals) if (w.payer_id === accountId && isSettled(w.status)) net -= w.amount;
  for (const p of s.purchases) if (p.payer_id === accountId && isSettled(p.status)) net -= p.amount;
  for (const t of s.transfers) {
    if (!isSettled(t.status)) continue;
    if (t.payer_id === accountId) net -= t.amount;
    if (t.payee_id === accountId) net += t.amount;
  }
  return net;
}

export function toBankSnapshot(workspace: WorkspaceState, snapshot: NessieSnapshot): BankSnapshotPush {
  return {
    customerId: workspace.nessieCustomerId,
    accounts: snapshot.accounts.map((a) => ({
      id: a._id,
      type: a.type,
      nickname: a.nickname,
      // Same rule as the Keel ledger: cards report what is owed; deposit accounts may need the
      // seeded history applied when the bank did not move balances itself.
      balance: round2(a.type === 'Credit Card' || workspace.balancesApplied ? a.balance : a.balance + netSettled(a._id, snapshot)),
    })),
    deposits: snapshot.deposits.map((d) => ({
      id: d._id,
      accountId: d.payee_id,
      date: d.transaction_date.slice(0, 10),
      status: d.status,
      amount: round2(d.amount),
      description: d.description ?? '',
    })),
    withdrawals: snapshot.withdrawals.map((w) => ({
      id: w._id,
      accountId: w.payer_id,
      date: w.transaction_date.slice(0, 10),
      status: w.status,
      amount: round2(w.amount),
      description: w.description ?? '',
    })),
    purchases: snapshot.purchases.map((p) => {
      const merchant = snapshot.merchants[p.merchant_id];
      return {
        id: p._id,
        accountId: p.payer_id,
        date: p.purchase_date.slice(0, 10),
        status: p.status,
        amount: round2(p.amount),
        description: p.description ?? '',
        merchantName: merchant?.name ?? null,
        merchantCategory: merchant?.category ?? null,
      };
    }),
    bills: snapshot.bills.map((b) => ({
      id: b._id,
      accountId: b.account_id,
      payee: b.payee,
      nickname: b.nickname,
      paymentDate: (b.upcoming_payment_date ?? b.payment_date).slice(0, 10),
      status: b.status,
      amount: round2(b.payment_amount),
      recurring: b.status === 'recurring',
    })),
  };
}

/** Stable fingerprint so an unchanged snapshot is not pushed again. */
export function bankSnapshotKey(push: BankSnapshotPush): string {
  return createHash('sha256').update(JSON.stringify(push)).digest('hex');
}
