import { TeePay } from './client.js';

export { TeePay, API_VERSION, DEFAULT_BASE_URL, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT } from './client.js';
export type { TeePayOptions } from './client.js';
export type { FetchLike } from './core.js';
export {
  TeePayError,
  ApiError,
  AuthenticationError,
  PermissionError,
  AccountRestrictedError,
  NotFoundError,
  ConflictError,
  ValidationError,
  RateLimitError,
  ConnectionError,
  TimeoutError,
  WebhookVerificationError,
} from './errors.js';
export {
  verifyWebhook,
  signWebhook,
  generateTestHeaders,
  Webhooks,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  EVENT_ID_HEADER,
  DEFAULT_TOLERANCE,
} from './webhooks.js';
export type { WebhookHeaders, WebhookPayload, VerifyOptions } from './webhooks.js';
export { Collections } from './resources/collections.js';
export { Disbursements } from './resources/disbursements.js';
export { ControlNumbers } from './resources/control-numbers.js';
export { CheckoutSessions } from './resources/checkout-sessions.js';
export { VERSION } from './version.js';
export type * from './types.js';

export default TeePay;
