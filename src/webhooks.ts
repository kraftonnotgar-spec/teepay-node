import { WebhookVerificationError } from './errors.js';
import { constantTimeEqual, hmacSha256Hex } from './crypto.js';
import type { WebhookEvent } from './types.js';

/** Headers as Node, Express, Fetch/Web `Headers` or a plain object provide them. */
export type WebhookHeaders =
  | { get(name: string): string | null | undefined }
  | Record<string, string | string[] | undefined>;

/** Raw request body exactly as received: a string, Buffer or Uint8Array. */
export type WebhookPayload = string | Uint8Array;

export interface VerifyOptions {
  /** Maximum age (and clock skew) in seconds. Default 300. */
  tolerance?: number;
  /** Current Unix time in seconds; for tests. */
  now?: number;
}

export const SIGNATURE_HEADER = 'X-TeePay-Signature';
export const TIMESTAMP_HEADER = 'X-TeePay-Timestamp';
export const EVENT_ID_HEADER = 'X-TeePay-Event-ID';
export const DEFAULT_TOLERANCE = 300;

function header(headers: WebhookHeaders, name: string): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const getter = (headers as { get?: unknown }).get;
  if (typeof getter === 'function') {
    const value = (getter as (n: string) => unknown).call(headers, name);
    return typeof value === 'string' ? value : undefined;
  }
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() !== wanted) continue;
    if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

function toBytes(payload: WebhookPayload): Uint8Array {
  if (typeof payload === 'string') return new TextEncoder().encode(payload);
  if (payload instanceof Uint8Array) return payload;
  throw new TypeError(
    'Webhook payload must be the raw request body (string, Buffer or Uint8Array), not parsed JSON. ' +
      'In Express use express.raw({ type: "application/json" }) on the webhook route.',
  );
}

/** Computes the `X-TeePay-Signature` value (`v1=<hex>`) for a payload. */
export function signWebhook(payload: WebhookPayload, secret: string, timestamp: number): string {
  const bytes = toBytes(payload);
  return 'v1=' + hmacSha256Hex(secret, [new TextEncoder().encode(`${Math.floor(timestamp)}.`), bytes]);
}

/** Builds signed headers for a payload, for testing your webhook handler. */
export function generateTestHeaders(payload: WebhookPayload, secret: string, timestamp: number = Math.floor(Date.now() / 1000)): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    [TIMESTAMP_HEADER]: String(Math.floor(timestamp)),
    [SIGNATURE_HEADER]: signWebhook(payload, secret, timestamp),
  };
  try {
    const text = typeof payload === 'string' ? payload : new TextDecoder().decode(payload);
    const id = (JSON.parse(text) as { id?: unknown }).id;
    if (typeof id === 'string') headers[EVENT_ID_HEADER] = id;
  } catch {
    // Not JSON: no event ID header.
  }
  return headers;
}

/**
 * Verifies a TeePay webhook and returns the parsed event.
 *
 * Checks `X-TeePay-Signature` (`v1=` HMAC-SHA256 of `<timestamp>.<raw body>` with your `whsec_` secret)
 * in constant time and rejects timestamps outside the tolerance. Throws `WebhookVerificationError`.
 */
export function verifyWebhook(payload: WebhookPayload, headers: WebhookHeaders, secret: string, options: VerifyOptions = {}): WebhookEvent {
  const bytes = toBytes(payload);
  if (typeof secret !== 'string' || secret.length === 0) throw new TypeError('A webhook signing secret is required');
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const timestamp = header(headers, TIMESTAMP_HEADER);
  const received = header(headers, SIGNATURE_HEADER);
  if (!timestamp || !/^\d{1,12}$/.test(timestamp.trim())) throw new WebhookVerificationError('Missing or invalid X-TeePay-Timestamp header');
  if (!received) throw new WebhookVerificationError('Missing X-TeePay-Signature header');
  const ts = Number(timestamp.trim());
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > tolerance) throw new WebhookVerificationError('Webhook timestamp is outside the allowed tolerance');
  const expected = 'v1=' + hmacSha256Hex(secret, [new TextEncoder().encode(`${ts}.`), bytes]);
  const candidates = received.split(',').map(s => s.trim()).filter(s => s.startsWith('v1='));
  let matched = false;
  for (const candidate of candidates) {
    if (constantTimeEqual(expected, candidate)) matched = true;
  }
  if (!matched) throw new WebhookVerificationError('Webhook signature does not match');
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as WebhookEvent;
  } catch {
    throw new WebhookVerificationError('Webhook body is not valid JSON');
  }
}

/** Webhook helpers, available as `teepay.webhooks`. */
export class Webhooks {
  /** Verifies the signature and timestamp and returns the parsed event. */
  verify(payload: WebhookPayload, headers: WebhookHeaders, secret: string, options?: VerifyOptions): WebhookEvent {
    return verifyWebhook(payload, headers, secret, options);
  }
  /** Same as `verify` but returns true/false instead of throwing. */
  isValid(payload: WebhookPayload, headers: WebhookHeaders, secret: string, options?: VerifyOptions): boolean {
    try {
      verifyWebhook(payload, headers, secret, options);
      return true;
    } catch (error) {
      if (error instanceof WebhookVerificationError) return false;
      throw error;
    }
  }
  sign(payload: WebhookPayload, secret: string, timestamp: number): string {
    return signWebhook(payload, secret, timestamp);
  }
  generateTestHeaders(payload: WebhookPayload, secret: string, timestamp?: number): Record<string, string> {
    return generateTestHeaders(payload, secret, timestamp);
  }
}
