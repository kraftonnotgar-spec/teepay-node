import { ConnectionError, TeePayError, TimeoutError, errorFromResponse, parseRetryAfter } from './errors.js';
import type { RequestOptions, ResponseMeta, WithResponse } from './types.js';
import { VERSION } from './version.js';
import { randomUUID } from './crypto.js';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface HttpConfig {
  apiKey: string;
  baseUrl: string;
  timeout: number;
  maxRetries: number;
  apiVersion?: string;
  fetch: FetchLike;
}

export interface CallSpec {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  /** `header`: send Idempotency-Key header. `body`: key lives in body.idempotency_key (already set). */
  idempotency?: 'header' | 'body';
  options?: RequestOptions;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRY_AFTER = 60;

/** Generates an idempotency key such as `sdk-0b9c…` (40 characters, letters, digits and `-`). */
export function generateIdempotencyKey(): string {
  return 'sdk-' + randomUUID();
}

/** Encodes one path segment; empty values are rejected locally. */
export function segment(value: string, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
  return encodeURIComponent(value);
}

/**
 * Prepares a request body: drops null/undefined fields and rejects object keys that are not
 * all-lowercase (the API rejects them, including inside `metadata`).
 */
export function cleanBody(value: unknown, path = ''): unknown {
  if (Array.isArray(value)) return value.filter(v => v !== undefined && v !== null).map((v, i) => cleanBody(v, `${path}[${i}]`));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined || item === null) continue;
      const where = path ? `${path}.${key}` : key;
      if (key !== key.toLowerCase()) {
        throw new TypeError(`TeePay rejects JSON keys that are not lowercase: "${where}". Use lowercase keys (including metadata keys).`);
      }
      out[key] = cleanBody(item, where);
    }
    return out;
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}

/** Converts integer minor amounts to the decimal strings the API expects. */
export function minorString(value: unknown, name: string): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError(`${name} must be an integer number of minor units (or a string of digits)`);
    return String(value);
  }
  return value;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ConnectionError('Request was aborted'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ConnectionError('Request was aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function backoff(attempt: number): number {
  const cap = Math.min(8, 0.5 * 2 ** attempt);
  return Math.random() * cap * 1000;
}

function intHeader(headers: Headers, name: string): number | null {
  const v = headers.get(name);
  if (v == null || !/^\s*-?\d+\s*$/.test(v)) return null;
  return Number(v);
}

export function responseMeta(response: Response): ResponseMeta {
  const h = response.headers;
  const limit = intHeader(h, 'ratelimit-limit');
  const remaining = intHeader(h, 'ratelimit-remaining');
  const reset = intHeader(h, 'ratelimit-reset');
  return {
    status: response.status,
    headers: h,
    requestId: h.get('x-request-id'),
    idempotentReplayed: (h.get('idempotent-replayed') ?? '').toLowerCase() === 'true',
    rateLimit: limit != null && remaining != null && reset != null ? { limit, remaining, reset } : null,
    apiVersion: h.get('teepay-version'),
  };
}

function attachMeta<T>(value: T, meta: ResponseMeta): WithResponse<T> {
  const target = (value && typeof value === 'object' ? value : {}) as object;
  Object.defineProperty(target, 'lastResponse', { value: meta, enumerable: false, configurable: true, writable: false });
  return target as WithResponse<T>;
}

function userAgent(): string {
  const node = typeof process !== 'undefined' && process.versions?.node ? ` node/${process.versions.node}` : '';
  return `teepay-node/${VERSION}${node}`;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class HttpClient {
  constructor(private readonly config: HttpConfig) {}

  buildUrl(path: string, query?: Record<string, unknown>): string {
    const url = new URL(path, this.config.baseUrl.replace(/\/+$/, '') + '/');
    // Keep the base URL's own path prefix (if any) in front of /v1.
    const base = new URL(this.config.baseUrl);
    url.pathname = base.pathname.replace(/\/+$/, '') + path;
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async request<T>(spec: CallSpec): Promise<WithResponse<T>> {
    const options = spec.options ?? {};
    const maxRetries = options.maxRetries ?? this.config.maxRetries;
    const timeout = options.timeout ?? this.config.timeout;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
      Accept: 'application/json',
      'User-Agent': userAgent(),
    };
    if (this.config.apiVersion) headers['TeePay-Version'] = this.config.apiVersion;
    let body: string | undefined;
    if (spec.method === 'POST') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(cleanBody(spec.body ?? {}));
    }
    if (spec.idempotency === 'header') {
      headers['Idempotency-Key'] = options.idempotencyKey ?? generateIdempotencyKey();
    }
    // Repeating is safe for reads and for writes that carry an idempotency key.
    const safeToRepeat = spec.method === 'GET' || spec.idempotency !== undefined;
    const url = this.buildUrl(spec.path, spec.query);

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeout);
      const onUserAbort = () => controller.abort();
      options.signal?.addEventListener('abort', onUserAbort, { once: true });
      let response: Response;
      try {
        if (options.signal?.aborted) throw new ConnectionError('Request was aborted');
        response = await this.config.fetch(url, { method: spec.method, headers, body, signal: controller.signal });
      } catch (cause) {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onUserAbort);
        if (options.signal?.aborted) throw new ConnectionError('Request was aborted', { cause });
        const error = timedOut
          ? new TimeoutError(`Request to TeePay timed out after ${timeout} ms`, { cause })
          : new ConnectionError('Could not connect to TeePay. Check your network and try again.', { cause });
        if (safeToRepeat && attempt < maxRetries) {
          await sleep(backoff(attempt), options.signal);
          continue;
        }
        throw error;
      }
      let parsed: unknown;
      try {
        parsed = await readBody(response);
      } catch (cause) {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onUserAbort);
        const error = timedOut
          ? new TimeoutError(`Request to TeePay timed out after ${timeout} ms`, { cause })
          : new ConnectionError('The connection to TeePay closed while reading the response.', { cause });
        if (safeToRepeat && attempt < maxRetries) {
          await sleep(backoff(attempt), options.signal);
          continue;
        }
        throw error;
      }
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onUserAbort);
      const meta = responseMeta(response);

      if (response.ok) {
        if (parsed !== null && typeof parsed !== 'object') {
          throw new TeePayError(`TeePay returned an unexpected non-JSON response (HTTP ${response.status}).`);
        }
        return attachMeta(parsed as T, meta);
      }

      const error = errorFromResponse(response.status, response.headers, parsed);
      const retryable = safeToRepeat ? RETRYABLE.has(response.status) : response.status === 429;
      if (retryable && attempt < maxRetries) {
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
        if (retryAfter != null && retryAfter > MAX_RETRY_AFTER) throw error;
        await sleep(retryAfter != null ? retryAfter * 1000 : backoff(attempt), options.signal);
        continue;
      }
      throw error;
    }
  }
}
