# Changelog

All notable changes to `@teepay/sdk` are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## 0.1.0 (unreleased)

First release, built against TeePay API version `2026-10-18`.

- Client with `whoami()` and `capabilities()`.
- Resources: `collections`, `checkoutSessions`, `controlNumbers`, `disbursements` (create, retrieve, list, `listAll`; payout `quote`).
- Automatic idempotency keys (header or body, as each endpoint expects), reused across retries.
- Retries with backoff and `Retry-After` for safe requests only; per-attempt timeouts; `AbortSignal` support.
- Typed errors including `AccountRestrictedError` (403 `account_restricted`).
- Webhook verification (`verifyWebhook`, `teepay.webhooks.verify`) with constant-time comparison and timestamp tolerance.
- Response metadata on every result (`lastResponse`: request ID, rate limits, idempotent replay).
- ESM and CommonJS builds with TypeScript declarations; zero runtime dependencies.
