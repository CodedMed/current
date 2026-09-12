import { randomBytes } from 'node:crypto';
import { notFound } from '../../lib/errors.ts';
import { isSettled } from './types.ts';
import type {
  NessieAccount,
  NessieApi,
  NessieBill,
  NessieCustomer,
  NessieDeposit,
  NessieMerchant,
  NessiePurchase,
  NessieTransfer,
  NessieWithdrawal,
  NewAccount,
  NewBill,
  NewCustomer,
  NewDeposit,
  NewMerchant,
  NewPurchase,
  NewTransfer,
  NewWithdrawal,
} from './types.ts';

const objectId = () => randomBytes(12).toString('hex');

/**
 * In-memory implementation of the Nessie surface, used when no API key is
 * configured. It stores exactly what the live API would return and applies
 * executed `balance`-medium transactions to account balances, so the
 * provisioner and dashboard builder are shared unchanged between modes.
 */
export class InMemoryNessieClient implements NessieApi {
  readonly mode = 'sandbox' as const;
  readonly #customers = new Map<string, NessieCustomer>();
  readonly #accounts = new Map<string, NessieAccount>();
  readonly #merchants = new Map<string, NessieMerchant>();
  readonly #deposits = new Map<string, NessieDeposit[]>();
  readonly #withdrawals = new Map<string, NessieWithdrawal[]>();
  readonly #purchases = new Map<string, NessiePurchase[]>();
  readonly #bills = new Map<string, NessieBill[]>();
  readonly #transfers = new Map<string, NessieTransfer[]>();

  async createCustomer(input: NewCustomer): Promise<NessieCustomer> {
    const customer: NessieCustomer = { _id: objectId(), ...input };
    this.#customers.set(customer._id, customer);
    return customer;
  }

  async getCustomer(id: string): Promise<NessieCustomer> {
    return this.#customers.get(id) ?? raise(`customer ${id}`);
  }

  async createAccount(customerId: string, input: NewAccount): Promise<NessieAccount> {
    await this.getCustomer(customerId);
    const account: NessieAccount = {
      _id: objectId(),
      ...input,
      account_number: String(Math.floor(1e15 + Math.random() * 9e15)),
      customer_id: customerId,
    };
    this.#accounts.set(account._id, account);
    return account;
  }

  async listAccounts(customerId: string): Promise<NessieAccount[]> {
    return [...this.#accounts.values()].filter((a) => a.customer_id === customerId).map((a) => ({ ...a }));
  }

  async getAccount(id: string): Promise<NessieAccount> {
    const account = this.#accounts.get(id) ?? raise(`account ${id}`);
    return { ...account };
  }

  async createMerchant(input: NewMerchant): Promise<NessieMerchant> {
    const merchant: NessieMerchant = { _id: objectId(), ...input };
    this.#merchants.set(merchant._id, merchant);
    return merchant;
  }

  async getMerchant(id: string): Promise<NessieMerchant> {
    return this.#merchants.get(id) ?? raise(`merchant ${id}`);
  }

  async createDeposit(accountId: string, input: NewDeposit): Promise<NessieDeposit> {
    const account = this.#accounts.get(accountId) ?? raise(`account ${accountId}`);
    const record: NessieDeposit = { _id: objectId(), type: 'deposit', payee_id: accountId, ...input };
    if (isSettled(record.status)) account.balance = round(account.balance + record.amount);
    push(this.#deposits, accountId, record);
    return record;
  }

  async listDeposits(accountId: string): Promise<NessieDeposit[]> {
    return [...(this.#deposits.get(accountId) ?? [])];
  }

  async createWithdrawal(accountId: string, input: NewWithdrawal): Promise<NessieWithdrawal> {
    const account = this.#accounts.get(accountId) ?? raise(`account ${accountId}`);
    const record: NessieWithdrawal = { _id: objectId(), type: 'withdrawal', payer_id: accountId, ...input };
    if (isSettled(record.status)) account.balance = round(account.balance - record.amount);
    push(this.#withdrawals, accountId, record);
    return record;
  }

  async listWithdrawals(accountId: string): Promise<NessieWithdrawal[]> {
    return [...(this.#withdrawals.get(accountId) ?? [])];
  }

  async createPurchase(accountId: string, input: NewPurchase): Promise<NessiePurchase> {
    const account = this.#accounts.get(accountId) ?? raise(`account ${accountId}`);
    await this.getMerchant(input.merchant_id);
    const record: NessiePurchase = { _id: objectId(), type: 'merchant', payer_id: accountId, ...input };
    if (isSettled(record.status)) account.balance = round(account.balance - record.amount);
    push(this.#purchases, accountId, record);
    return record;
  }

  async listPurchases(accountId: string): Promise<NessiePurchase[]> {
    return [...(this.#purchases.get(accountId) ?? [])];
  }

  async createBill(accountId: string, input: NewBill): Promise<NessieBill> {
    await this.getAccount(accountId);
    const record: NessieBill = {
      _id: objectId(),
      ...input,
      creation_date: new Date().toISOString().slice(0, 10),
      upcoming_payment_date: input.payment_date,
      account_id: accountId,
    };
    push(this.#bills, accountId, record);
    return record;
  }

  async listBills(accountId: string): Promise<NessieBill[]> {
    return [...(this.#bills.get(accountId) ?? [])];
  }

  async createTransfer(accountId: string, input: NewTransfer): Promise<NessieTransfer> {
    const payer = this.#accounts.get(accountId) ?? raise(`account ${accountId}`);
    const record: NessieTransfer = { _id: objectId(), type: 'p2p', payer_id: accountId, ...input };
    if (isSettled(record.status)) payer.balance = round(payer.balance - record.amount);
    push(this.#transfers, accountId, record);
    return record;
  }

  async listTransfers(accountId: string): Promise<NessieTransfer[]> {
    return [...(this.#transfers.get(accountId) ?? [])];
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function raise(what: string): never {
  throw notFound(`Nessie fixture: ${what} does not exist.`);
}
