import type { NessieConfig } from '../../config.ts';
import { IntegrationError } from '../../lib/errors.ts';
import { requestJson } from '../../lib/http.ts';
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

interface CreatedEnvelope<T> {
  code: number;
  message: string;
  objectCreated: T;
}

interface NessieErrorBody {
  code?: number;
  message?: string;
  culprit?: string[];
}

/**
 * HTTP client for the live Nessie API. The API key is appended server-side as
 * the `key` query parameter and never leaves this process.
 */
export class HttpNessieClient implements NessieApi {
  readonly mode = 'live' as const;
  readonly #config: NessieConfig;

  constructor(config: NessieConfig) {
    this.#config = config;
  }

  createCustomer(input: NewCustomer) {
    return this.#create<NessieCustomer>('/customers', input);
  }
  getCustomer(id: string) {
    return this.#get<NessieCustomer>(`/customers/${id}`);
  }
  createAccount(customerId: string, input: NewAccount) {
    return this.#create<NessieAccount>(`/customers/${customerId}/accounts`, input);
  }
  listAccounts(customerId: string) {
    return this.#get<NessieAccount[]>(`/customers/${customerId}/accounts`);
  }
  getAccount(id: string) {
    return this.#get<NessieAccount>(`/accounts/${id}`);
  }
  createMerchant(input: NewMerchant) {
    return this.#create<NessieMerchant>('/merchants', input);
  }
  getMerchant(id: string) {
    return this.#get<NessieMerchant>(`/merchants/${id}`);
  }
  createDeposit(accountId: string, input: NewDeposit) {
    return this.#create<NessieDeposit>(`/accounts/${accountId}/deposits`, input);
  }
  listDeposits(accountId: string) {
    return this.#get<NessieDeposit[]>(`/accounts/${accountId}/deposits`);
  }
  createWithdrawal(accountId: string, input: NewWithdrawal) {
    return this.#create<NessieWithdrawal>(`/accounts/${accountId}/withdrawals`, input);
  }
  listWithdrawals(accountId: string) {
    return this.#get<NessieWithdrawal[]>(`/accounts/${accountId}/withdrawals`);
  }
  createPurchase(accountId: string, input: NewPurchase) {
    return this.#create<NessiePurchase>(`/accounts/${accountId}/purchases`, input);
  }
  listPurchases(accountId: string) {
    return this.#get<NessiePurchase[]>(`/accounts/${accountId}/purchases`);
  }
  createBill(accountId: string, input: NewBill) {
    return this.#create<NessieBill>(`/accounts/${accountId}/bills`, input);
  }
  listBills(accountId: string) {
    return this.#get<NessieBill[]>(`/accounts/${accountId}/bills`);
  }
  createTransfer(accountId: string, input: NewTransfer) {
    return this.#create<NessieTransfer>(`/accounts/${accountId}/transfers`, input);
  }
  listTransfers(accountId: string) {
    return this.#get<NessieTransfer[]>(`/accounts/${accountId}/transfers`);
  }

  #url(path: string): string {
    const url = new URL(path, this.#config.baseUrl);
    url.searchParams.set('key', this.#config.apiKey);
    return url.toString();
  }

  async #get<T>(path: string): Promise<T> {
    const res = await this.#send<T>('GET', path);
    if (!res.ok || res.body === null) throw this.#error(path, res.status, res.body, res.text);
    return res.body;
  }

  async #create<T>(path: string, payload: unknown): Promise<T> {
    const res = await this.#send<CreatedEnvelope<T>>('POST', path, payload);
    if (!res.ok || !res.body?.objectCreated) throw this.#error(path, res.status, res.body, res.text);
    return res.body.objectCreated;
  }

  async #send<T>(method: 'GET' | 'POST', path: string, payload?: unknown) {
    const attempt = () => requestJson<T>(this.#url(path), { method, body: payload, timeoutMs: 25_000 });
    try {
      let res = await attempt();
      // The hackathon API is occasionally flaky under bursts; one retry on 5xx or 429.
      if (res.status >= 500 || res.status === 429) {
        await new Promise((r) => setTimeout(r, 600));
        res = await attempt();
      }
      return res;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new IntegrationError('nessie', 'Could not reach the Nessie API. Check your network and try again.', null, message);
    }
  }

  #error(path: string, status: number, body: unknown, text: string): IntegrationError {
    const parsed = (body ?? {}) as NessieErrorBody;
    const hint =
      status === 401 || status === 403
        ? 'Nessie rejected the API key.'
        : status === 404
          ? 'Nessie could not find that record.'
          : status === 400
            ? 'Nessie rejected the request.'
            : 'Nessie returned an unexpected response.';
    const detail = parsed.message ? ` ${parsed.message}${parsed.culprit?.length ? ` (${parsed.culprit.join(', ')})` : ''}` : '';
    return new IntegrationError('nessie', `${hint}${detail}`, status, { path, body: text.slice(0, 300) });
  }
}
