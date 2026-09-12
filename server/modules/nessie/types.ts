import type { AccountType, IntegrationMode } from '../../../shared/types.ts';

/**
 * Shapes as returned by the Nessie API (Capital One hackathon API).
 * Object ids are 24-character hex strings.
 */

export interface NessieAddress {
  street_number: string;
  street_name: string;
  city: string;
  state: string;
  zip: string;
}

export interface NessieCustomer {
  _id: string;
  first_name: string;
  last_name: string;
  address: NessieAddress;
}

export interface NessieAccount {
  _id: string;
  type: AccountType;
  nickname: string;
  rewards: number;
  balance: number;
  account_number?: string;
  customer_id: string;
}

export interface NessieMerchant {
  _id: string;
  name: string;
  category: string;
  address?: NessieAddress;
  geocode?: { lat: number; lng: number };
}

export type NessieTransactionStatus = 'pending' | 'cancelled' | 'executed';

export interface NessieDeposit {
  _id: string;
  type: 'deposit';
  transaction_date: string;
  status: NessieTransactionStatus;
  payee_id: string;
  medium: 'balance' | 'rewards';
  amount: number;
  description: string;
}

export interface NessieWithdrawal {
  _id: string;
  type: 'withdrawal';
  transaction_date: string;
  status: NessieTransactionStatus;
  payer_id: string;
  medium: 'balance' | 'rewards';
  amount: number;
  description: string;
}

export interface NessiePurchase {
  _id: string;
  type: 'merchant';
  merchant_id: string;
  payer_id: string;
  purchase_date: string;
  amount: number;
  status: NessieTransactionStatus;
  medium: 'balance' | 'rewards';
  description: string;
}

export interface NessieBill {
  _id: string;
  status: 'pending' | 'cancelled' | 'recurring' | 'completed';
  payee: string;
  nickname: string;
  creation_date?: string;
  payment_date: string;
  recurring_date: number;
  upcoming_payment_date?: string;
  payment_amount: number;
  account_id: string;
}

export interface NessieTransfer {
  _id: string;
  type: 'p2p';
  transaction_date: string;
  status: NessieTransactionStatus;
  medium: 'balance' | 'rewards';
  payer_id: string;
  payee_id: string;
  amount: number;
  description: string;
}

/* ───── Create payloads ───── */

export interface NewCustomer {
  first_name: string;
  last_name: string;
  address: NessieAddress;
}

export interface NewAccount {
  type: AccountType;
  nickname: string;
  rewards: number;
  balance: number;
}

export interface NewMerchant {
  name: string;
  category: string;
  address: NessieAddress;
  geocode: { lat: number; lng: number };
}

export interface NewDeposit {
  medium: 'balance';
  transaction_date: string;
  status: NessieTransactionStatus;
  amount: number;
  description: string;
}

export interface NewWithdrawal {
  medium: 'balance';
  transaction_date: string;
  status: NessieTransactionStatus;
  amount: number;
  description: string;
}

export interface NewPurchase {
  merchant_id: string;
  medium: 'balance';
  purchase_date: string;
  amount: number;
  status: NessieTransactionStatus;
  description: string;
}

export interface NewBill {
  status: 'pending' | 'recurring';
  payee: string;
  nickname: string;
  payment_date: string;
  recurring_date: number;
  payment_amount: number;
}

export interface NewTransfer {
  medium: 'balance';
  payee_id: string;
  amount: number;
  transaction_date: string;
  status: NessieTransactionStatus;
  description: string;
}

/**
 * The surface the rest of the app depends on. `HttpNessieClient` talks to the
 * real API; `InMemoryNessieClient` is a faithful stand-in when no key is set.
 */
export interface NessieApi {
  readonly mode: IntegrationMode;
  createCustomer(input: NewCustomer): Promise<NessieCustomer>;
  getCustomer(id: string): Promise<NessieCustomer>;
  createAccount(customerId: string, input: NewAccount): Promise<NessieAccount>;
  listAccounts(customerId: string): Promise<NessieAccount[]>;
  getAccount(id: string): Promise<NessieAccount>;
  createMerchant(input: NewMerchant): Promise<NessieMerchant>;
  getMerchant(id: string): Promise<NessieMerchant>;
  createDeposit(accountId: string, input: NewDeposit): Promise<NessieDeposit>;
  listDeposits(accountId: string): Promise<NessieDeposit[]>;
  createWithdrawal(accountId: string, input: NewWithdrawal): Promise<NessieWithdrawal>;
  listWithdrawals(accountId: string): Promise<NessieWithdrawal[]>;
  createPurchase(accountId: string, input: NewPurchase): Promise<NessiePurchase>;
  listPurchases(accountId: string): Promise<NessiePurchase[]>;
  createBill(accountId: string, input: NewBill): Promise<NessieBill>;
  listBills(accountId: string): Promise<NessieBill[]>;
  createTransfer(accountId: string, input: NewTransfer): Promise<NessieTransfer>;
  listTransfers(accountId: string): Promise<NessieTransfer[]>;
}

/** Everything the dashboard builder needs, fetched in one pass. */
export interface NessieSnapshot {
  customer: NessieCustomer;
  accounts: NessieAccount[];
  deposits: NessieDeposit[];
  withdrawals: NessieWithdrawal[];
  purchases: NessiePurchase[];
  bills: NessieBill[];
  transfers: NessieTransfer[];
  merchants: Record<string, { name: string; category: string }>;
}
