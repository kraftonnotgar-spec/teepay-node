# TeePay Node.js SDK

Official TypeScript/JavaScript SDK for the [TeePay API](https://docs.teepay.me): mobile money push
payments, hosted checkout sessions, Control Numbers, payouts and webhook verification.

- Zero runtime dependencies, Node.js 18+ (uses the global `fetch`)
- ESM and CommonJS builds with full TypeScript types
- Automatic idempotency keys, safe retries with backoff, timeouts and typed errors

## Install

```bash
npm install @teepay/sdk
```

## Quickstart

Create a secret API key in the TeePay dashboard (**Developers → API keys**) and keep it on your server.

```ts
import TeePay from '@teepay/sdk';
// CommonJS: const { TeePay } = require('@teepay/sdk');

const teepay = new TeePay(process.env.TEEPAY_API_KEY); // tp_test_… or tp_live_…

const caps = await teepay.capabilities();
console.log(caps.features.collection_create, caps.supported_countries);
```

### Mobile money push (USSD prompt)

```ts
const payment = await teepay.collections.create(
  {
    money: { amount_minor: '500000', currency: 'TZS' }, // TZS 5,000.00 in minor units
    customer: { country: 'TZ', phone: '+255712345678', name: 'Asha Juma' },
    description: 'Order 1001',
  },
  { idempotencyKey: 'order-1001' },
);

// 202 Accepted: the prompt was sent, the customer has not paid yet.
console.log(payment.public_reference, payment.status); // "TP8K2M4QZ1" "pending"

const current = await teepay.collections.retrieve(payment.public_reference!);
if (current.status === 'succeeded') {
  // fulfil the order
}
```

### Hosted checkout session

```ts
const session = await teepay.checkoutSessions.create(
  {
    title: 'Order 1001',
    amount_minor: '500000',
    currency: 'TZS',
    reference: 'order-1001',
    metadata: { cart: 'c-77' },
  },
  { idempotencyKey: 'checkout-order-1001' },
);

// Redirect the customer to TeePay's hosted page.
res.redirect(303, session.checkout_url!);
```

`status` becomes `paid` only after TeePay verified the payment. Never trust a browser redirect alone:
confirm with `teepay.checkoutSessions.retrieve(id)` or the `payment.completed` webhook.

### Verify webhooks

TeePay signs each webhook with your `whsec_…` secret. Verify the **raw** request body before trusting it:

```ts
import express from 'express';
import { verifyWebhook, WebhookVerificationError } from '@teepay/sdk';

const app = express();

app.post('/webhooks/teepay', express.raw({ type: 'application/json' }), (req, res) => {
  let event;
  try {
    event = verifyWebhook(req.body, req.headers, process.env.TEEPAY_WEBHOOK_SECRET!);
  } catch (error) {
    if (error instanceof WebhookVerificationError) return res.sendStatus(400);
    throw error;
  }
  if (event.event === 'payment.completed') {
    // look up your order by event.data.reference; process each event.id once
  }
  res.sendStatus(200);
});
```

`verifyWebhook(payload, headers, secret, { tolerance })` checks `X-TeePay-Signature` (`v1=` HMAC-SHA256 of
`<timestamp>.<raw body>`) in constant time and rejects timestamps more than 300 seconds away. It
accepts a `string`, `Buffer` or `Uint8Array` body and Node, Express or Fetch `Headers`. The same function
is available as `teepay.webhooks.verify(...)`; `teepay.webhooks.isValid(...)` returns a boolean.
For tests, `generateTestHeaders(body, secret)` signs a payload.

## Resources

| Method | Endpoint |
|---|---|
| `teepay.whoami()` | `GET /v1/whoami` |
| `teepay.capabilities()` | `GET /v1/capabilities` |
| `teepay.collections.create(params, opts?)` | `POST /v1/collections` |
| `teepay.collections.retrieve(reference)` | `GET /v1/collections/{reference}` |
| `teepay.collections.list(params?)` / `listAll(params?)` | `GET /v1/collections` |
| `teepay.checkoutSessions.create(params, opts?)` | `POST /v1/checkout-sessions` |
| `teepay.checkoutSessions.retrieve(id)` | `GET /v1/checkout-sessions/{id}` |
| `teepay.checkoutSessions.list(params?)` / `listAll(params?)` | `GET /v1/checkout-sessions` |
| `teepay.controlNumbers.create(params, opts?)` | `POST /v1/control-numbers` |
| `teepay.controlNumbers.retrieve(id)` | `GET /v1/control-numbers/{id}` |
| `teepay.controlNumbers.list(params?)` / `listAll(params?)` | `GET /v1/control-numbers` |
| `teepay.disbursements.quote(params)` | `POST /v1/disbursements/quote` |
| `teepay.disbursements.create({ quote_id, idempotency_key? })` | `POST /v1/disbursements` |
| `teepay.disbursements.retrieve(reference)` | `GET /v1/disbursements/{reference}` |
| `teepay.disbursements.list(params?)` / `listAll(params?)` | `GET /v1/disbursements` |

Field names are exactly the API's (`amount_minor`, `public_reference`, …). `listAll` is an async
iterator that follows `next_cursor`:

```ts
for await (const payment of teepay.collections.listAll({ status: 'succeeded' })) {
  console.log(payment.public_reference);
}
```

Every result carries response metadata in a non-enumerable `lastResponse` property:
`status`, `requestId`, `idempotentReplayed`, `rateLimit` (`{ limit, remaining, reset }`) and `apiVersion`.

## Idempotency

`collections.create`, `checkoutSessions.create` and `controlNumbers.create` send an `Idempotency-Key`
header; `disbursements.create` sends `idempotency_key` in the body. If you do not pass one the SDK
generates one, and reuses it for its own retries of that call.

For real integrations **derive the key from your own record** (for example `order-1001`) so a retry
after a crash or timeout can never create a second payment:

```ts
await teepay.collections.create(params, { idempotencyKey: `order-${order.id}` });
await teepay.disbursements.create({ quote_id: quote.id, idempotency_key: `payout-${payout.id}` });
```

Same key and same body returns the original result (`lastResponse.idempotentReplayed` on checkout
sessions). Same key with a different body throws `ConflictError` (`idempotency_conflict`). A Control
Number `202` (number not issued yet) or a payout `202` (outcome uncertain) must be retried with the
**same** key or read back, never with a new one.

## Errors

```ts
import {
  TeePayError, ApiError, AuthenticationError, PermissionError, AccountRestrictedError,
  NotFoundError, ConflictError, ValidationError, RateLimitError, ConnectionError, TimeoutError,
} from '@teepay/sdk';

try {
  await teepay.collections.create(params);
} catch (error) {
  if (error instanceof AccountRestrictedError) {
    // 403 account_restricted: the account is restricted, contact TeePay support
  } else if (error instanceof ValidationError) {
    console.log(error.code); // invalid_request, unsupported_market, invalid_amount, ...
  } else if (error instanceof RateLimitError) {
    console.log('retry after', error.retryAfter, 'seconds');
  } else if (error instanceof ConnectionError) {
    // no response: retry with the SAME idempotency key or read the resource
  } else if (error instanceof ApiError) {
    console.log(error.status, error.code, error.requestId);
  }
}
```

| Class | When |
|---|---|
| `AuthenticationError` | 401 `invalid_credential` |
| `PermissionError` | 403 `scope_denied`, `access_denied`, `developer_access_denied`, payout `payout_not_authorized` |
| `AccountRestrictedError` | 403 `account_restricted` (also a `PermissionError`) |
| `NotFoundError` | 404 |
| `ConflictError` | 409 `idempotency_conflict`, `payout_quote_expired_or_changed` |
| `ValidationError` | 400/422 (`invalid_request`, `unsupported_market`, `invalid_amount`, …) |
| `RateLimitError` | 429 `rate_limited`, with `retryAfter` |
| `ApiError` | Any other HTTP error (5xx); base class of all of the above |
| `ConnectionError` / `TimeoutError` | No HTTP response |
| `WebhookVerificationError` | Bad webhook signature or timestamp |

Every `ApiError` has `status`, `code`, `message`, `requestId`, `headers`, `body` and `retryAfter`.
A `5xx` or timeout on a create call does **not** mean the payment failed.

## Retries and timeouts

```ts
const teepay = new TeePay(process.env.TEEPAY_API_KEY, {
  timeout: 30_000, // ms per attempt (default 30000)
  maxRetries: 2,   // default 2
});
await teepay.whoami({ timeout: 5_000, maxRetries: 0 }); // per call
```

The SDK retries only when repeating is safe: `GET` requests and creates that carry an idempotency key,
on connection errors, timeouts, `408`, `429`, `500`, `502`, `503` and `504`. It honours `Retry-After`
(and gives up if it is over 60 seconds), otherwise uses exponential backoff with jitter. A payout quote
(no key) is only retried on `429`. `4xx` errors are never retried.

## Sandbox and live

| Key prefix | `teepay.environment` | Use it for |
|---|---|---|
| `tp_test_` | `sandbox` | Authentication, scopes, capability discovery and error handling |
| `tp_live_` | `live` | Real payments and payouts |

Both use `https://api.teepay.me`; the key decides the environment. Money movement (mobile money push,
checkout sessions, Control Numbers, payouts) currently runs in live only: check
`teepay.capabilities()` instead of hard-coding what your key can do.

Other options: `baseUrl`, `apiVersion` (pins the `TeePay-Version` header, e.g. `'2026-10-18'`) and
`fetch` (custom implementation).

## Keep your key on the server

API keys move money. Never put them in a browser, mobile app or public repository. The SDK throws if it
detects a browser (`window` and `document`); `dangerouslyAllowBrowser: true` overrides this for trusted
internal tools only. The key is never logged and is redacted from `console.log(teepay)` and
`JSON.stringify(teepay)`. Your frontend should call your own server, which creates the checkout
session and returns `checkout_url`.

The SDK does not log anything. Strict JSON: the API rejects unknown fields and object keys that are not
lowercase (including `metadata` keys); the SDK checks keys before sending and throws a `TypeError`.

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
