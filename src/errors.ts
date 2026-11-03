import type { ResponseMeta } from './types.js';

/** Base class for every error thrown by the TeePay SDK. */
export class TeePayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface ApiErrorInit {
  status: number;
  code: string;
  message: string;
  requestId: string | null;
  headers: Headers;
  body: unknown;
  retryAfter?: number | null;
}

/** The API answered with a non-2xx status. */
export class ApiError extends TeePayError {
  /** HTTP status code. */
  readonly status: number;
  /** Stable machine-readable code, e.g. `invalid_request`. */
  readonly code: string;
  /** Request ID to quote to TeePay support. */
  readonly requestId: string | null;
  /** Response headers. */
  readonly headers: Headers;
  /** Parsed response body (or raw text when it was not JSON). */
  readonly body: unknown;
  /** Seconds from `Retry-After`, when the API sent it. */
  readonly retryAfter: number | null;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
    this.headers = init.headers;
    this.body = init.body;
    this.retryAfter = init.retryAfter ?? null;
  }
}

/** 401: missing, invalid, revoked, expired or wrong-environment API key. */
export class AuthenticationError extends ApiError {}
/** 403: the key lacks the scope, or the account cannot use this feature now. */
export class PermissionError extends ApiError {}
/** 403 `account_restricted`: the account is restricted. Contact TeePay support. */
export class AccountRestrictedError extends PermissionError {}
/** 404: the resource does not exist for this account. */
export class NotFoundError extends ApiError {}
/** 409: idempotency key reused with a different request, or a payout quote expired/changed. */
export class ConflictError extends ApiError {}
/** 400/422: the request was rejected as invalid. */
export class ValidationError extends ApiError {}
/** 429: too many requests. `retryAfter` tells you how long to wait. */
export class RateLimitError extends ApiError {}

/** The request did not get an HTTP response (DNS, TLS, reset, abort). */
export class ConnectionError extends TeePayError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    if (options && 'cause' in options) (this as { cause?: unknown }).cause = options.cause;
  }
}
/** The request exceeded the configured timeout. */
export class TimeoutError extends ConnectionError {}

/** A webhook failed signature or timestamp verification. */
export class WebhookVerificationError extends TeePayError {}

const GENERIC: Record<number, [string, string]> = {
  400: ['invalid_request', 'The request is invalid.'],
  401: ['invalid_credential', 'A valid API credential is required.'],
  403: ['access_denied', 'You do not have access to this resource.'],
  404: ['not_found', 'The requested resource could not be found.'],
  405: ['method_not_allowed', 'This endpoint does not support the requested HTTP method.'],
  409: ['conflict', 'The request conflicts with an earlier request.'],
  422: ['invalid_request', 'The request is invalid. Check the fields and query parameters.'],
  429: ['rate_limited', 'Too many requests. Wait for the Retry-After delay before trying again.'],
  500: ['internal_error', 'An unexpected error occurred. Contact support with the request ID.'],
  503: ['unavailable', 'The service is temporarily unavailable. Please try again shortly.'],
};

/** Parses a `Retry-After` header given in seconds. */
export function parseRetryAfter(value: string | null): number | null {
  if (value == null || !/^\s*\d+(\.\d+)?\s*$/.test(value)) return null;
  return Number(value);
}

/** Builds the typed error for an HTTP error response. Accepts every error shape the API emits. */
export function errorFromResponse(status: number, headers: Headers, body: unknown): ApiError {
  let code: string | undefined;
  let message: string | undefined;
  let requestId: string | null = headers.get('x-request-id');
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as { error: unknown }).error;
    if (typeof error === 'string') {
      code = error;
    } else if (error && typeof error === 'object') {
      const e = error as Record<string, unknown>;
      if (typeof e.code === 'string') code = e.code;
      if (typeof e.message === 'string' && e.message) message = e.message;
      if (typeof e.request_id === 'string' && e.request_id) requestId = e.request_id;
    }
  }
  const generic = GENERIC[status] ?? (status >= 500 ? GENERIC[500] : ['api_error', `TeePay returned HTTP ${status}.`]);
  const init: ApiErrorInit = {
    status,
    code: code ?? generic[0],
    message: message ?? generic[1],
    requestId: requestId || null,
    headers,
    body,
    retryAfter: parseRetryAfter(headers.get('retry-after')),
  };
  if (status === 401) return new AuthenticationError(init);
  if (status === 403) return init.code === 'account_restricted' ? new AccountRestrictedError(init) : new PermissionError(init);
  if (status === 404) return new NotFoundError(init);
  if (status === 409) return new ConflictError(init);
  if (status === 400 || status === 422) return new ValidationError(init);
  if (status === 429) return new RateLimitError(init);
  return new ApiError(init);
}

// Re-export for convenience so `ResponseMeta` is reachable from errors consumers.
export type { ResponseMeta };
