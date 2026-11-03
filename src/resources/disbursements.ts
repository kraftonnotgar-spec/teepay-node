import { HttpClient, generateIdempotencyKey, segment } from '../core.js';
import type {
  Disbursement, DisbursementCreateParams, DisbursementQuote, DisbursementQuoteParams, RequestOptions,
  Transaction, TransactionListParams, TransactionPage, WithResponse,
} from '../types.js';
import { paginate } from './paging.js';

/** Quoted payouts (disbursements) from your TeePay balance. */
export class Disbursements {
  constructor(private readonly http: HttpClient) {}

  /** Prices a payout. A quote never moves money and expires after two minutes. `POST /v1/disbursements/quote`. */
  async quote(params: DisbursementQuoteParams, options?: RequestOptions): Promise<WithResponse<DisbursementQuote>> {
    return this.http.request({ method: 'POST', path: '/v1/disbursements/quote', body: params, options });
  }

  /**
   * Confirms a quote and sends the payout. `POST /v1/disbursements`.
   * The idempotency key goes in the body (`idempotency_key`) and is generated when omitted.
   * A 202 means the outcome is uncertain: read the payout, never retry with a new key.
   */
  async create(params: DisbursementCreateParams, options?: RequestOptions): Promise<WithResponse<Disbursement>> {
    const idempotency_key = params?.idempotency_key ?? options?.idempotencyKey ?? generateIdempotencyKey();
    return this.http.request({ method: 'POST', path: '/v1/disbursements', body: { ...params, idempotency_key }, idempotency: 'body', options });
  }

  /** One payout by its TeePay reference. `GET /v1/disbursements/{reference}`. */
  async retrieve(reference: string, options?: RequestOptions): Promise<WithResponse<Transaction>> {
    return this.http.request({ method: 'GET', path: `/v1/disbursements/${segment(reference, 'reference')}`, options });
  }

  /** A page of payouts, newest first. `GET /v1/disbursements`. */
  async list(params: TransactionListParams = {}, options?: RequestOptions): Promise<WithResponse<TransactionPage>> {
    const { limit, cursor, status, currency } = params;
    return this.http.request({ method: 'GET', path: '/v1/disbursements', query: { limit, cursor, status, currency }, options });
  }

  /** Every payout across pages. */
  listAll(params: TransactionListParams = {}, options?: RequestOptions): AsyncGenerator<Transaction, void, undefined> {
    return paginate((p: TransactionListParams, o) => this.list(p, o), page => page.items, params, options);
  }
}
