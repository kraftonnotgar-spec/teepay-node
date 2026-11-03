import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TeePay, WebhookVerificationError, generateTestHeaders, signWebhook, verifyWebhook } from '../dist/esm/index.js';
import { TEST_KEY, fixtures } from './helpers/mock-server.mjs';

const w = fixtures.webhook;
const headers = { 'X-TeePay-Event-ID': '0f8d7c2e-5b1a-5e3f-9c4d-7a6b2e1f0c9d', 'X-TeePay-Timestamp': String(w.timestamp), 'X-TeePay-Signature': w.signature };
const now = w.timestamp + 10;

describe('webhooks', () => {
  test('verifies the documented fixture and returns the parsed event', () => {
    const event = verifyWebhook(w.body, headers, w.secret, { now });
    assert.equal(event.event, 'payment.completed');
    assert.equal(event.data.reference, 'TP8K2M4QZ1');
    assert.equal(event.data.source.type, 'checkout_session');
  });

  test('accepts Buffer, Uint8Array, lowercase Node headers and Fetch Headers', () => {
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    assert.equal(verifyWebhook(Buffer.from(w.body), lower, w.secret, { now }).id, '0f8d7c2e-5b1a-5e3f-9c4d-7a6b2e1f0c9d');
    assert.ok(verifyWebhook(new TextEncoder().encode(w.body), new Headers(headers), w.secret, { now }));
    const arrays = { 'x-teepay-timestamp': [String(w.timestamp)], 'x-teepay-signature': [w.signature] };
    assert.ok(verifyWebhook(w.body, arrays, w.secret, { now }));
  });

  test('client.webhooks.verify and isValid', () => {
    const teepay = new TeePay(TEST_KEY);
    assert.equal(teepay.webhooks.verify(w.body, headers, w.secret, { now }).event, 'payment.completed');
    assert.equal(teepay.webhooks.isValid(w.body, headers, w.secret, { now }), true);
    assert.equal(teepay.webhooks.isValid(w.body + ' ', headers, w.secret, { now }), false);
  });

  test('signature matches the documented scheme', () => {
    assert.equal(signWebhook(w.body, w.secret, w.timestamp), w.signature);
  });

  test('rejects a tampered body, wrong secret and wrong scheme', () => {
    assert.throws(() => verifyWebhook(w.body.replace('500000', '900000'), headers, w.secret, { now }), WebhookVerificationError);
    assert.throws(() => verifyWebhook(w.body, headers, 'whsec_other', { now }), WebhookVerificationError);
    assert.throws(() => verifyWebhook(w.body, { ...headers, 'X-TeePay-Signature': w.signature.replace('v1=', 'v0=') }, w.secret, { now }), WebhookVerificationError);
    assert.throws(() => verifyWebhook(w.body, { ...headers, 'X-TeePay-Signature': 'v1=' + 'a'.repeat(64) }, w.secret, { now }), WebhookVerificationError);
  });

  test('rejects old, future, missing and malformed timestamps', () => {
    assert.throws(() => verifyWebhook(w.body, headers, w.secret, { now: w.timestamp + 301 }), /tolerance/);
    assert.throws(() => verifyWebhook(w.body, headers, w.secret, { now: w.timestamp - 301 }), /tolerance/);
    assert.ok(verifyWebhook(w.body, headers, w.secret, { now: w.timestamp + 301, tolerance: 600 }));
    const { 'X-TeePay-Timestamp': _t, ...noTs } = headers;
    assert.throws(() => verifyWebhook(w.body, noTs, w.secret, { now }), WebhookVerificationError);
    assert.throws(() => verifyWebhook(w.body, { ...headers, 'X-TeePay-Timestamp': '12a' }, w.secret, { now }), WebhookVerificationError);
    const { 'X-TeePay-Signature': _s, ...noSig } = headers;
    assert.throws(() => verifyWebhook(w.body, noSig, w.secret, { now }), /Signature/);
  });

  test('accepts any matching v1 entry in a comma-separated header', () => {
    const multi = { ...headers, 'X-TeePay-Signature': `v1=${'0'.repeat(64)}, ${w.signature}` };
    assert.ok(verifyWebhook(w.body, multi, w.secret, { now }));
  });

  test('refuses parsed objects: the raw body is required', () => {
    assert.throws(() => verifyWebhook(JSON.parse(w.body), headers, w.secret, { now }), /raw request body/);
    assert.throws(() => verifyWebhook(w.body, headers, '', { now }), TypeError);
  });

  test('generateTestHeaders round-trips with the current time', () => {
    const body = JSON.stringify({ id: 'evt_1', event: 'payout.completed', environment: 'live', created_at: 'x', data: { reference: 'R', status: 'completed' } });
    const signed = generateTestHeaders(body, w.secret);
    assert.equal(signed['X-TeePay-Event-ID'], 'evt_1');
    assert.equal(verifyWebhook(body, signed, w.secret).event, 'payout.completed');
  });

  test('a valid signature over non-JSON is reported as a verification error', () => {
    const signed = generateTestHeaders('not json', w.secret, w.timestamp);
    assert.throws(() => verifyWebhook('not json', signed, w.secret, { now }), /not valid JSON/);
  });
});
