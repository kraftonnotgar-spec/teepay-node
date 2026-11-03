import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const NAMES = ['TeePay', 'TeePayError', 'ApiError', 'AuthenticationError', 'PermissionError', 'AccountRestrictedError', 'NotFoundError',
  'ConflictError', 'ValidationError', 'RateLimitError', 'ConnectionError', 'TimeoutError', 'WebhookVerificationError', 'verifyWebhook',
  'signWebhook', 'generateTestHeaders', 'Webhooks', 'VERSION', 'API_VERSION'];

test('package exports resolve for import (ESM)', async () => {
  const mod = await import('@teepay/sdk');
  for (const name of NAMES) assert.ok(mod[name], name);
  assert.equal(mod.default, mod.TeePay);
  assert.equal(mod.VERSION, '0.1.0');
});

test('package exports resolve for require (CJS)', () => {
  const mod = require('@teepay/sdk');
  for (const name of NAMES) assert.ok(mod[name], name);
  assert.equal(mod.default, mod.TeePay);
  const client = new mod.TeePay('tp_test_0123456789abcdef0123456789abcdef.x');
  assert.equal(client.environment, 'sandbox');
  assert.ok(new mod.AccountRestrictedError({ status: 403, code: 'account_restricted', message: 'm', requestId: null, headers: new Headers(), body: null }) instanceof mod.PermissionError);
});

test('package.json version matches VERSION', async () => {
  const pkg = require('../package.json');
  const mod = await import('@teepay/sdk');
  assert.equal(pkg.version, mod.VERSION);
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), [], 'zero runtime dependencies');
});
