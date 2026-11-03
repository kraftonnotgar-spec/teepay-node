import { HttpClient, minorString, segment } from '../core.js';
import type {
  CheckoutSession, CheckoutSessionCreateParams, CheckoutSessionList, CheckoutSessionListParams, RequestOptions, WithResponse,
} from '../types.js';
import { paginate } from './paging.js';

/** TeePay hosted checkout pages created from your server. */
export class CheckoutSessions {
  constructor(private readonly http: HttpClient) {}

  /**
   * Creates a hosted checkout; redirect the customer to `checkout_url`. `POST /v1/checkout-sessions`.
   * Repeating the same key and body returns the same session (`lastResponse.idempotentReplayed`).
   */
  async create(params: CheckoutSessionCreateParams, options?: RequestOptions): Promise<WithResponse<CheckoutSession>> {
    const body = { ...params, amount_minor: minorString(params?.amount_minor, 'amount_minor') };
    return this.http.request({ method: 'POST', path: '/v1/checkout-sessions', body, idempotency: 'header', options });
  }

  /** One checkout session. `GET /v1/checkout-sessions/{id}`. */
  async retrieve(id: string, options?: RequestOptions): Promise<WithResponse<CheckoutSession>> {
    return this.http.request({ method: 'GET', path: `/v1/checkout-sessions/${segment(id, 'id')}`, options });
  }

  /** A page of checkout sessions, newest first. `GET /v1/checkout-sessions`. */
  async list(params: CheckoutSessionListParams = {}, options?: RequestOptions): Promise<WithResponse<CheckoutSessionList>> {
    const { limit, cursor } = params;
    return this.http.request({ method: 'GET', path: '/v1/checkout-sessions', query: { limit, cursor }, options });
  }

  /** Every checkout session across pages. */
  listAll(params: CheckoutSessionListParams = {}, options?: RequestOptions): AsyncGenerator<CheckoutSession, void, undefined> {
    return paginate((p: CheckoutSessionListParams, o) => this.list(p, o), page => page.items, params, options);
  }
}
