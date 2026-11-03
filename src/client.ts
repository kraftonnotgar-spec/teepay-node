import { HttpClient, type FetchLike } from './core.js';
import { TeePayError } from './errors.js';
import { CheckoutSessions } from './resources/checkout-sessions.js';
import { Collections } from './resources/collections.js';
import { ControlNumbers } from './resources/control-numbers.js';
import { Disbursements } from './resources/disbursements.js';
import type { Capabilities, Environment, RequestOptions, Whoami, WithResponse } from './types.js';
import { Webhooks } from './webhooks.js';

export const DEFAULT_BASE_URL = 'https://api.teepay.me';
export const DEFAULT_TIMEOUT = 30_000;
export const DEFAULT_MAX_RETRIES = 2;
/** The API version this SDK release was built against. */
export const API_VERSION = '2026-10-18';

export interface TeePayOptions {
  /** Secret API key (`tp_test_…` or `tp_live_…`). Defaults to `process.env.TEEPAY_API_KEY`. */
  apiKey?: string;
  /** Default `https://api.teepay.me`. */
  baseUrl?: string;
  /** Per-attempt timeout in milliseconds. Default 30000. */
  timeout?: number;
  /** Automatic retries for safe requests. Default 2. */
  maxRetries?: number;
  /** Pin the API version (sends `TeePay-Version`). Not sent by default. */
  apiVersion?: string;
  /** Custom fetch implementation (defaults to the global `fetch`). */
  fetch?: FetchLike;
  /**
   * The SDK refuses to run in a browser because your secret key would be exposed to anyone.
   * Set this only for trusted, non-public environments (e.g. an internal Electron tool).
   */
  dangerouslyAllowBrowser?: boolean;
}

const KEY_PATTERN = /^tp_(test|live)_\S+$/;

function isBrowser(): boolean {
  const g = globalThis as { window?: unknown; document?: unknown };
  return typeof g.window !== 'undefined' && typeof g.document !== 'undefined';
}

function envKey(): string | undefined {
  try {
    return typeof process !== 'undefined' ? process.env?.TEEPAY_API_KEY : undefined;
  } catch {
    return undefined;
  }
}

/**
 * TeePay API client.
 *
 * ```ts
 * const teepay = new TeePay(process.env.TEEPAY_API_KEY);
 * const session = await teepay.checkoutSessions.create({ title: 'Order 1001', amount_minor: '500000', currency: 'TZS' });
 * ```
 */
export class TeePay {
  /** `sandbox` for `tp_test_` keys, `live` for `tp_live_` keys. */
  readonly environment: Environment;
  readonly baseUrl: string;
  readonly collections: Collections;
  readonly disbursements: Disbursements;
  readonly controlNumbers: ControlNumbers;
  readonly checkoutSessions: CheckoutSessions;
  readonly webhooks: Webhooks;
  readonly #http: HttpClient;

  constructor(apiKeyOrOptions?: string | TeePayOptions, maybeOptions: TeePayOptions = {}) {
    const options: TeePayOptions =
      typeof apiKeyOrOptions === 'string' ? { ...maybeOptions, apiKey: apiKeyOrOptions } : { ...(apiKeyOrOptions ?? {}) };
    if (isBrowser() && !options.dangerouslyAllowBrowser) {
      throw new TeePayError(
        'The TeePay SDK must run on your server: using it in a browser would expose your secret API key. ' +
          'Create payments from your backend and send the customer to checkout_url instead.',
      );
    }
    const apiKey = options.apiKey ?? envKey();
    if (!apiKey) throw new TeePayError('No TeePay API key provided. Pass it to new TeePay(...) or set TEEPAY_API_KEY.');
    if (typeof apiKey !== 'string' || !KEY_PATTERN.test(apiKey)) {
      throw new TeePayError('Invalid TeePay API key format: keys start with tp_test_ or tp_live_.');
    }
    const fetchImpl = options.fetch ?? (typeof fetch === 'function' ? (fetch.bind(globalThis) as FetchLike) : undefined);
    if (!fetchImpl) throw new TeePayError('No global fetch found. Use Node.js 18+ or pass options.fetch.');
    this.environment = apiKey.startsWith('tp_live_') ? 'live' : 'sandbox';
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    try {
      new URL(this.baseUrl);
    } catch {
      throw new TeePayError('baseUrl must be an absolute URL, e.g. https://api.teepay.me');
    }
    this.#http = new HttpClient({
      apiKey,
      baseUrl: this.baseUrl,
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      maxRetries: Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES),
      apiVersion: options.apiVersion,
      fetch: fetchImpl,
    });
    this.collections = new Collections(this.#http);
    this.disbursements = new Disbursements(this.#http);
    this.controlNumbers = new ControlNumbers(this.#http);
    this.checkoutSessions = new CheckoutSessions(this.#http);
    this.webhooks = new Webhooks();
  }

  /** The application, environment, scopes and key prefix of the key in use. `GET /v1/whoami`. */
  async whoami(options?: RequestOptions): Promise<WithResponse<Whoami>> {
    return this.#http.request({ method: 'GET', path: '/v1/whoami', options });
  }

  /** Features and markets this key can use right now. `GET /v1/capabilities`. */
  async capabilities(options?: RequestOptions): Promise<WithResponse<Capabilities>> {
    return this.#http.request({ method: 'GET', path: '/v1/capabilities', options });
  }

  /** Never reveal the key when the client is logged or serialised. */
  toJSON(): Record<string, string> {
    return { environment: this.environment, baseUrl: this.baseUrl, apiKey: '[redacted]' };
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `TeePay { environment: '${this.environment}', baseUrl: '${this.baseUrl}', apiKey: '[redacted]' }`;
  }
}
