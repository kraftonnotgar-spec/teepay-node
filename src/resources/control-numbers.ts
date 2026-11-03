import { HttpClient, minorString, segment } from '../core.js';
import type {
  ControlNumber, ControlNumberCreateParams, ControlNumberCreated, ControlNumberList, ControlNumberListParams,
  ControlNumberWithPayments, RequestOptions, WithResponse,
} from '../types.js';
import { paginate } from './paging.js';

/** Tanzanian Control Numbers and the verified payments received on them. */
export class ControlNumbers {
  constructor(private readonly http: HttpClient) {}

  /**
   * Issues a Control Number. `POST /v1/control-numbers`.
   * `lastResponse.status` 201 includes the number; 202 means pending: call again with the SAME idempotency key.
   */
  async create(params: ControlNumberCreateParams, options?: RequestOptions): Promise<WithResponse<ControlNumberCreated>> {
    const body = {
      ...params,
      amount_minor: minorString(params?.amount_minor, 'amount_minor'),
      maximum_minor: minorString(params?.maximum_minor, 'maximum_minor'),
    };
    return this.http.request({ method: 'POST', path: '/v1/control-numbers', body, idempotency: 'header', options });
  }

  /** One Control Number with its payments. `GET /v1/control-numbers/{id}`. */
  async retrieve(id: string, options?: RequestOptions): Promise<WithResponse<ControlNumberWithPayments>> {
    return this.http.request({ method: 'GET', path: `/v1/control-numbers/${segment(id, 'id')}`, options });
  }

  /** A page of Control Numbers (items are in `data`). `GET /v1/control-numbers`. */
  async list(params: ControlNumberListParams = {}, options?: RequestOptions): Promise<WithResponse<ControlNumberList>> {
    return this.http.request({ method: 'GET', path: '/v1/control-numbers', query: { cursor: params.cursor }, options });
  }

  /** Every Control Number across pages. */
  listAll(params: ControlNumberListParams = {}, options?: RequestOptions): AsyncGenerator<ControlNumber, void, undefined> {
    return paginate((p: ControlNumberListParams, o) => this.list(p, o), page => page.data, params, options);
  }
}
