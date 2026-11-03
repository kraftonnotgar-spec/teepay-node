import { HttpClient, minorString, segment } from '../core.js';
import type { Collection, CollectionCreateParams, RequestOptions, Transaction, TransactionListParams, TransactionPage, WithResponse } from '../types.js';
import { paginate } from './paging.js';

/** Mobile money push payments (USSD prompt) and collection reads. */
export class Collections {
  constructor(private readonly http: HttpClient) {}

  /**
   * Sends a USSD payment prompt to the customer's phone. `POST /v1/collections`.
   * A 202 means accepted, not paid: read the collection or wait for the webhook.
   */
  async create(params: CollectionCreateParams, options?: RequestOptions): Promise<WithResponse<Collection>> {
    const body = params?.money
      ? { ...params, money: { ...params.money, amount_minor: minorString(params.money.amount_minor, 'money.amount_minor') } }
      : params;
    return this.http.request({ method: 'POST', path: '/v1/collections', body, idempotency: 'header', options });
  }

  /** One collection by its `public_reference`. `GET /v1/collections/{reference}`. */
  async retrieve(reference: string, options?: RequestOptions): Promise<WithResponse<Transaction>> {
    return this.http.request({ method: 'GET', path: `/v1/collections/${segment(reference, 'reference')}`, options });
  }

  /** A page of collections, newest first. `GET /v1/collections`. */
  async list(params: TransactionListParams = {}, options?: RequestOptions): Promise<WithResponse<TransactionPage>> {
    const { limit, cursor, status, currency } = params;
    return this.http.request({ method: 'GET', path: '/v1/collections', query: { limit, cursor, status, currency }, options });
  }

  /** Every collection across pages, e.g. `for await (const c of teepay.collections.listAll())`. */
  listAll(params: TransactionListParams = {}, options?: RequestOptions): AsyncGenerator<Transaction, void, undefined> {
    return paginate((p: TransactionListParams, o) => this.list(p, o), page => page.items, params, options);
  }
}
