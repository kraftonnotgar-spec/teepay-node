// Request and response types for the TeePay public API (version 2026-10-18).
// Field names are the API's own snake_case names.

/** Metadata about the HTTP response, attached as the non-enumerable `lastResponse` property. */
export interface ResponseMeta {
  status: number;
  headers: Headers;
  /** `X-Request-ID`; quote it to TeePay support. */
  requestId: string | null;
  /** True when the API replayed an earlier result for the same idempotency key. */
  idempotentReplayed: boolean;
  rateLimit: RateLimitInfo | null;
  /** `TeePay-Version` response header. */
  apiVersion: string | null;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  /** Seconds until the window resets. */
  reset: number;
}

/** A value returned by the SDK, carrying response metadata in `lastResponse`. */
export type WithResponse<T> = T & { readonly lastResponse: ResponseMeta };

/** Options accepted by every API method. */
export interface RequestOptions {
  /** Overrides the auto-generated idempotency key on create calls. Derive it from your own record, e.g. `order-1001`. */
  idempotencyKey?: string;
  /** Timeout for this call in milliseconds. */
  timeout?: number;
  /** Retries for this call. */
  maxRetries?: number;
  /** Cancels the request. */
  signal?: AbortSignal;
}

/** Integer minor units. Strings are sent as-is; integers (number or bigint) are converted to strings. */
export type MinorAmount = string | number | bigint;

export type Environment = 'sandbox' | 'live';

export type Scope =
  | 'integration:read'
  | 'collection:read'
  | 'collection:create'
  | 'disbursement:read'
  | 'disbursement:create'
  | 'control_number:read'
  | 'control_number:create'
  | 'checkout:read'
  | 'checkout:create';

// ---------- Integration ----------

export interface Whoami {
  application_reference: string;
  environment: Environment;
  scopes: Scope[];
  credential_prefix: string;
}

export interface CapabilityFeatures {
  integration_read: true;
  collection_read: boolean;
  disbursement_read: boolean;
  collection_create: boolean;
  disbursement_create: boolean;
  payments: boolean;
  checkout_sessions: boolean;
  payment_links: false;
  payment_pages: false;
  invoice_payments: false;
  payouts: boolean;
  beneficiaries: false;
  balances: false;
  refunds: false;
  webhook_endpoints: false;
  control_number_read: boolean;
  control_number_create: boolean;
  checkout_session_read: boolean;
}

export interface Capabilities {
  api_version: string;
  environment: Environment;
  release_stage: 'read_only' | 'owned_payouts' | 'owned_collections';
  features: CapabilityFeatures;
  /** ISO 3166-1 alpha-2 countries this key can create collections in now. */
  supported_countries: string[];
  /** ISO 4217 currencies this key can collect in now. */
  supported_currencies: string[];
}

// ---------- Money and transactions ----------

/** Response money: `amount_minor` is a JSON number in responses. */
export interface Money {
  amount_minor: number;
  currency: string;
}

export type TransactionStatus = 'created' | 'pending' | 'processing' | 'succeeded' | 'failed' | 'reversed' | 'refunded';

export interface Collection {
  id: string;
  /** Use this reference to read the payment. */
  public_reference?: string;
  operation: 'charge';
  status: TransactionStatus;
  /** Present only for failed payments the customer cancelled or that expired. */
  status_detail?: 'cancelled' | 'expired';
  money: Money;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  public_reference?: string;
  operation: 'charge' | 'payout';
  status: TransactionStatus;
  status_detail?: string;
  money: Money;
  created_at: string;
  updated_at: string;
  customer_name?: string;
  customer_phone?: string;
  method?: string;
  channel?: string;
  source?: string;
  fee?: Money;
  net?: Money;
}

export interface TransactionPage {
  items: Transaction[];
  next_cursor: string | null;
}

// ---------- Collections ----------

export interface CollectionCreateParams {
  money: {
    /** Integer minor units, e.g. `"500000"` is TZS 5,000.00. */
    amount_minor: MinorAmount;
    /** One of `supported_currencies` from capabilities. */
    currency: string;
  };
  customer: {
    /** Payer wallet country, one of `supported_countries`. */
    country: string;
    /** Mobile money number in international format, e.g. `+255712345678`. */
    phone: string;
    name?: string;
    email?: string;
  };
  description?: string;
}

export interface TransactionListParams {
  /** 1 to 100, default 25. */
  limit?: number;
  cursor?: string;
  status?: TransactionStatus;
  currency?: string;
}

// ---------- Disbursements (payouts) ----------

export type PayoutDestination =
  | { channel: 'mobile'; name: string; /** `255` followed by 9 digits. */ phone: string }
  | { channel: 'bank'; name: string; bank: string; /** Digits only, up to 34. */ account: string };

export interface DisbursementQuoteParams {
  money: {
    /** Integer minor units (a JSON number for this endpoint). */
    amount: number;
    currency: 'TZS';
  };
  destination: PayoutDestination;
  narration: string;
}

export interface DisbursementQuote {
  id: string;
  expires_at: string;
  currency: string;
  amount_minor: string;
  merchant_fee_minor: string;
  provider_fee_minor: string;
  /** What leaves your balance: amount plus your fee. */
  total_minor: string;
}

export interface DisbursementCreateParams {
  quote_id: string;
  /** Stable key for this payout. Generated when omitted; prefer one derived from your own record. */
  idempotency_key?: string;
}

export interface Disbursement {
  id: string;
  public_reference: string;
  status: TransactionStatus;
  money: Money;
  fee_minor: string;
  total_minor: string;
  created_at: string;
  updated_at: string;
  destination: {
    channel: string;
    name: string;
    phone_last4?: string;
    bank?: string;
    account_last4?: string;
  };
}

// ---------- Control Numbers ----------

export interface ControlNumberCreateParams {
  kind: 'bill' | 'customer';
  customer: { name?: string; phone?: string; email?: string };
  description?: string;
  amount_minor?: MinorAmount;
  maximum_minor?: MinorAmount;
  payment_mode?: 'EXACT' | 'ALLOW_PARTIAL_AND_OVER_PAYMENT';
}

/** 201: `number` is set. 202: issuance pending, `number` is null; retry with the same idempotency key. */
export interface ControlNumberCreated {
  id: string;
  object: 'control_number';
  status: string;
  number: string | null;
  currency: 'TZS';
}

export interface ControlNumber {
  id: string;
  object: 'control_number';
  number: string;
  kind: 'bill' | 'customer';
  currency: 'TZS';
  amount_minor: string | null;
  collected_minor: string;
  remaining_minor: string | null;
  status: string;
  payment_count: number;
  created_at: string;
}

export interface ControlNumberPayment {
  id: string;
  /** Only `verified` payments are money received. */
  status: 'verified' | 'pending_verification' | 'under_review';
  received_at: string;
  reference?: string;
  amount_minor?: string;
  fee_minor?: string;
  paid_at?: string;
}

export interface ControlNumberWithPayments extends ControlNumber {
  payments: ControlNumberPayment[];
}

export interface ControlNumberListParams {
  cursor?: string;
}

export interface ControlNumberList {
  object: 'list';
  /** Control Numbers use `data`, not `items`. */
  data: ControlNumber[];
  next_cursor: string | null;
  can_create?: boolean;
}

// ---------- Checkout sessions ----------

export interface CheckoutSessionCreateParams {
  title: string;
  /** Integer minor units, e.g. `"500000"` is TZS 5,000.00. */
  amount_minor: MinorAmount;
  currency: string;
  description?: string;
  /** Seconds, 3600 to 604800 (default 86400). */
  expires_in?: number;
  payment_profile_id?: string;
  /** Your order ID, echoed back. */
  reference?: string;
  /** Up to 10 string values. Keys must be lowercase. */
  metadata?: Record<string, string>;
}

export type CheckoutSessionStatus = 'open' | 'processing' | 'paid' | 'expired' | 'unavailable';

export interface CheckoutSession {
  id: string;
  object: 'checkout_session';
  /** `paid` only after TeePay verified and ledger-posted the payment. */
  status: CheckoutSessionStatus;
  title: string;
  description: string;
  currency: string;
  amount_minor: string;
  /** Hosted checkout URL to redirect the customer to. */
  checkout_url: string | null;
  payment_profile_id: string | null;
  reference: string | null;
  metadata: Record<string, string>;
  payment: { reference: string } | null;
  environment: Environment;
  created_at: string;
  expires_at: string | null;
}

export interface CheckoutSessionListParams {
  /** 1 to 50, default 20. */
  limit?: number;
  cursor?: string;
}

export interface CheckoutSessionList {
  object: 'list';
  items: CheckoutSession[];
  next_cursor: string | null;
}

// ---------- Webhooks ----------

export type WebhookEventType =
  | 'payment.completed'
  | 'payment.failed'
  | 'payment.voided'
  | 'payment.expired'
  | 'payout.completed'
  | 'payout.failed'
  | 'payout.reversed';

export interface WebhookEvent {
  id: string;
  event: WebhookEventType | (string & {});
  environment: Environment;
  created_at: string;
  data: {
    reference: string;
    transaction_id?: string;
    status: string;
    occurred_at?: string;
    money?: { currency: string; amount_minor: string };
    source?: { type: string; id: string; control_number?: string } | null;
    [key: string]: unknown;
  };
}
