import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { inspect } from 'node:util';
import TeePayDefault, {
  AccountRestrictedError, ApiError, AuthenticationError, ConflictError, ConnectionError, NotFoundError, PermissionError,
  RateLimitError, TeePay, TeePayError, TimeoutError, ValidationError,
} from '../dist/esm/index.js';
import { LIVE_KEY, TEST_KEY, fixtures, startMockServer } from './helpers/mock-server.mjs';

let mock;
let teepay;
const E = fixtures.errors;
const fast = (spec) => ({ ...spec, headers: { ...(spec.headers ?? {}), 'Retry-After': '0' } });

before(async () => {
  mock = await startMockServer();
});
after(async () => {
  await mock.close();
});
beforeEach(() => {
  mock.reset();
  teepay = new TeePay(TEST_KEY, { baseUrl: mock.url });
});

describe('construction', () => {
  test('default export is the TeePay class', () => {
    assert.equal(TeePayDefault, TeePay);
  });

  test('accepts a key string or an options object', () => {
    assert.equal(new TeePay(TEST_KEY).environment, 'sandbox');
    assert.equal(new TeePay({ apiKey: LIVE_KEY }).environment, 'live');
    assert.equal(new TeePay(TEST_KEY).baseUrl, 'https://api.teepay.me');
  });

  test('reads TEEPAY_API_KEY when no key is passed', () => {
    const previous = process.env.TEEPAY_API_KEY;
    process.env.TEEPAY_API_KEY = LIVE_KEY;
    try {
      assert.equal(new TeePay().environment, 'live');
    } finally {
      if (previous === undefined) delete process.env.TEEPAY_API_KEY;
      else process.env.TEEPAY_API_KEY = previous;
    }
  });

  test('rejects a missing or malformed key without echoing it', () => {
    const previous = process.env.TEEPAY_API_KEY;
    delete process.env.TEEPAY_API_KEY;
    try {
      assert.throws(() => new TeePay(), TeePayError);
    } finally {
      if (previous !== undefined) process.env.TEEPAY_API_KEY = previous;
    }
    try {
      new TeePay('sk_secret_value_123');
      assert.fail('should throw');
    } catch (error) {
      assert.ok(error instanceof TeePayError);
      assert.ok(!String(error.message).includes('sk_secret_value_123'));
    }
  });

  test('rejects a bad baseUrl', () => {
    assert.throws(() => new TeePay(TEST_KEY, { baseUrl: 'not a url' }), TeePayError);
  });

  test('never exposes the key in inspect, JSON or keys', () => {
    const text = inspect(teepay, { depth: 5, showHidden: true });
    assert.ok(!text.includes('s3cr3tvalue'), text);
    assert.ok(!JSON.stringify(teepay).includes('s3cr3tvalue'));
    assert.ok(!Object.keys(teepay).some(k => String(teepay[k]).includes('s3cr3tvalue')));
  });

  test('refuses to run in a browser unless explicitly allowed', () => {
    globalThis.window = {};
    globalThis.document = {};
    try {
      assert.throws(() => new TeePay(LIVE_KEY), /server/);
      assert.equal(new TeePay(TEST_KEY, { dangerouslyAllowBrowser: true }).environment, 'sandbox');
    } finally {
      delete globalThis.window;
      delete globalThis.document;
    }
  });
});

describe('requests', () => {
  test('authenticates with a bearer header only', async () => {
    const who = await teepay.whoami();
    assert.deepEqual({ ...who }, fixtures.operations['get-api-key'].body);
    const req = mock.requests[0];
    assert.equal(req.method, 'GET');
    assert.equal(req.path, '/v1/whoami');
    assert.equal(req.headers.authorization, `Bearer ${TEST_KEY}`);
    assert.equal(req.headers['x-api-key'], undefined);
    assert.equal(req.headers.accept, 'application/json');
    assert.match(req.headers['user-agent'], /^teepay-node\/0\.1\.0 node\//);
    assert.equal(req.headers['teepay-version'], undefined);
    assert.equal(req.headers['idempotency-key'], undefined);
  });

  test('sends TeePay-Version only when pinned', async () => {
    const pinned = new TeePay(TEST_KEY, { baseUrl: mock.url, apiVersion: '2026-10-18' });
    await pinned.capabilities();
    assert.equal(mock.requests[0].headers['teepay-version'], '2026-10-18');
  });

  test('attaches response metadata as a non-enumerable lastResponse', async () => {
    const caps = await teepay.capabilities();
    assert.equal(caps.features.collection_create, true);
    assert.deepEqual(caps.supported_countries, ['TZ']);
    assert.equal(Object.keys(caps).includes('lastResponse'), false);
    assert.equal(JSON.stringify(caps).includes('lastResponse'), false);
    assert.equal(caps.lastResponse.status, 200);
    assert.equal(caps.lastResponse.requestId, 'req_mock_1');
    assert.equal(caps.lastResponse.apiVersion, '2026-10-18');
    assert.deepEqual(caps.lastResponse.rateLimit, { limit: 120, remaining: 119, reset: 30 });
    assert.equal(caps.lastResponse.idempotentReplayed, false);
  });

  test('collections.create sends the body, an auto idempotency key and returns 202 state', async () => {
    const payment = await teepay.collections.create({
      money: { amount_minor: '500000', currency: 'TZS' },
      customer: { country: 'TZ', phone: '+255712345678', name: 'Asha Juma', email: undefined },
      description: 'Order 1001',
    });
    assert.equal(payment.public_reference, 'TP8K2M4QZ1');
    assert.equal(payment.status, 'pending');
    assert.equal(payment.lastResponse.status, 202);
    const req = mock.requests[0];
    assert.equal(req.method, 'POST');
    assert.equal(req.path, '/v1/collections');
    assert.equal(req.headers['content-type'], 'application/json');
    assert.match(req.headers['idempotency-key'], /^sdk-[A-Za-z0-9-]{36}$/);
    assert.ok(req.headers['idempotency-key'].length <= 120);
    assert.deepEqual(req.body, {
      money: { amount_minor: '500000', currency: 'TZS' },
      customer: { country: 'TZ', phone: '+255712345678', name: 'Asha Juma' },
      description: 'Order 1001',
    });
  });

  test('auto keys differ between calls; a caller key overrides', async () => {
    const params = { money: { amount_minor: '1000', currency: 'TZS' }, customer: { country: 'TZ', phone: '+255712345678' } };
    await teepay.collections.create(params);
    await teepay.collections.create(params);
    await teepay.collections.create(params, { idempotencyKey: 'order-1001' });
    const keys = mock.requests.map(r => r.headers['idempotency-key']);
    assert.notEqual(keys[0], keys[1]);
    assert.equal(keys[2], 'order-1001');
  });

  test('integer amounts are converted to strings for string-minor fields', async () => {
    await teepay.collections.create({ money: { amount_minor: 500000, currency: 'TZS' }, customer: { country: 'TZ', phone: '+255712345678' } });
    await teepay.checkoutSessions.create({ title: 'Order', amount_minor: 750000n, currency: 'TZS' });
    await teepay.controlNumbers.create({ kind: 'bill', customer: { name: 'A' }, amount_minor: 5000000, maximum_minor: 6000000 });
    assert.equal(mock.requests[0].body.money.amount_minor, '500000');
    assert.equal(mock.requests[1].body.amount_minor, '750000');
    assert.equal(mock.requests[2].body.amount_minor, '5000000');
    assert.equal(mock.requests[2].body.maximum_minor, '6000000');
    await assert.rejects(teepay.checkoutSessions.create({ title: 'x', amount_minor: 1.5, currency: 'TZS' }), TypeError);
  });

  test('rejects non-lowercase JSON keys locally (the API would reject them)', async () => {
    await assert.rejects(
      teepay.checkoutSessions.create({ title: 'x', amount_minor: '100', currency: 'TZS', metadata: { OrderId: '1' } }),
      (error) => error instanceof TypeError && /metadata\.OrderId/.test(error.message),
    );
    assert.equal(mock.requests.length, 0);
  });

  test('checkoutSessions.create returns the hosted URL and reports replays', async () => {
    mock.enqueue({ ...fixtures.operations['create-checkout-session'], headers: { 'Idempotent-Replayed': 'true' } });
    const session = await teepay.checkoutSessions.create(
      { title: 'Order 1001', description: '2 x Coffee bag', amount_minor: '500000', currency: 'TZS', expires_in: 86400, reference: 'order-1001', metadata: { cart: 'c-77' } },
      { idempotencyKey: 'order-1001' },
    );
    assert.equal(session.checkout_url, 'https://pay.teepay.me/c/7c0e5d2a-1b3f-4c8e-9a6d-2f4b8e1c0d9a');
    assert.equal(session.lastResponse.status, 201);
    assert.equal(session.lastResponse.idempotentReplayed, true);
    assert.equal(mock.requests[0].headers['idempotency-key'], 'order-1001');
    assert.deepEqual(mock.requests[0].body.metadata, { cart: 'c-77' });
  });

  test('controlNumbers.create surfaces 202 pending', async () => {
    mock.enqueue({ status: 202, body: { id: '22222222-2222-4222-8222-222222222222', object: 'control_number', status: 'pending', number: null, currency: 'TZS' } });
    const pending = await teepay.controlNumbers.create({ kind: 'customer', customer: { name: 'Asha' } }, { idempotencyKey: 'cn-0001-key' });
    assert.equal(pending.lastResponse.status, 202);
    assert.equal(pending.number, null);
    const issued = await teepay.controlNumbers.create({ kind: 'customer', customer: { name: 'Asha' } }, { idempotencyKey: 'cn-0001-key' });
    assert.equal(issued.number, '991234567890');
    assert.equal(mock.requests[0].headers['idempotency-key'], mock.requests[1].headers['idempotency-key']);
  });

  test('disbursements: quote has no key, create puts the key in the body', async () => {
    const quote = await teepay.disbursements.quote({
      money: { amount: 2500000, currency: 'TZS' },
      destination: { channel: 'mobile', name: 'Juma Ali', phone: '255712345678' },
      narration: 'Supplier payment October',
    });
    assert.equal(quote.total_minor, '2550000');
    assert.equal(mock.requests[0].headers['idempotency-key'], undefined);
    assert.equal(mock.requests[0].body.money.amount, 2500000);

    const payout = await teepay.disbursements.create({ quote_id: quote.id, idempotency_key: 'payout-2026-10-0001' });
    assert.equal(payout.public_reference, 'TPPO7Q2X9D');
    assert.deepEqual(mock.requests[1].body, { quote_id: 'q_4f2c8a1b', idempotency_key: 'payout-2026-10-0001' });
    assert.equal(mock.requests[1].headers['idempotency-key'], undefined);

    await teepay.disbursements.create({ quote_id: quote.id });
    assert.match(mock.requests[2].body.idempotency_key, /^sdk-/);
    await teepay.disbursements.create({ quote_id: quote.id }, { idempotencyKey: 'payout-from-opts' });
    assert.equal(mock.requests[3].body.idempotency_key, 'payout-from-opts');
  });

  test('retrieve encodes path parameters and rejects empty ones', async () => {
    await teepay.collections.retrieve('TP8K2M4QZ1');
    await teepay.disbursements.retrieve('a/b?c');
    assert.equal(mock.requests[0].path, '/v1/collections/TP8K2M4QZ1');
    assert.equal(mock.requests[1].rawPath, '/v1/disbursements/a%2Fb%3Fc');
    await assert.rejects(teepay.collections.retrieve(''), TypeError);
    await assert.rejects(teepay.checkoutSessions.retrieve(undefined), TypeError);
  });

  test('list sends only documented, non-empty query parameters', async () => {
    await teepay.collections.list({ limit: 50, status: 'succeeded', currency: 'TZS', cursor: undefined });
    await teepay.checkoutSessions.list({ limit: 10, cursor: 'abc' });
    await teepay.controlNumbers.list();
    await teepay.disbursements.list({ limit: 5 });
    assert.deepEqual(mock.requests[0].query, { limit: '50', status: 'succeeded', currency: 'TZS' });
    assert.deepEqual(mock.requests[1].query, { limit: '10', cursor: 'abc' });
    assert.deepEqual(mock.requests[2].query, {});
    assert.deepEqual(mock.requests[3].query, { limit: '5' });
  });

  test('listAll follows next_cursor across pages (items and data fields)', async () => {
    const page = (ids, next) => ({ status: 200, body: { items: ids.map(id => ({ ...fixtures.operations['list-collections'].body.items[0], id })), next_cursor: next } });
    mock.enqueue(page(['a', 'b'], 'c1'), page(['c'], 'c2'), page(['d'], null));
    const ids = [];
    for await (const item of teepay.collections.listAll({ limit: 2 })) ids.push(item.id);
    assert.deepEqual(ids, ['a', 'b', 'c', 'd']);
    assert.deepEqual(mock.requests.map(r => r.query.cursor ?? null), [null, 'c1', 'c2']);
    assert.ok(mock.requests.every(r => r.query.limit === '2'));

    mock.reset();
    const numbers = [];
    for await (const n of teepay.controlNumbers.listAll()) numbers.push(n.number);
    assert.deepEqual(numbers, ['991234567890']);

    const sessions = [];
    for await (const s of teepay.checkoutSessions.listAll()) sessions.push(s.status);
    assert.deepEqual(sessions, ['paid']);
    const payouts = [];
    for await (const p of teepay.disbursements.listAll()) payouts.push(p.operation);
    assert.deepEqual(payouts, ['payout']);
  });
});

describe('errors', () => {
  const cases = [
    ['invalid_credential', AuthenticationError, 401],
    ['scope_denied', PermissionError, 403],
    ['access_denied', PermissionError, 403],
    ['account_restricted', AccountRestrictedError, 403],
    ['not_found', NotFoundError, 404],
    ['idempotency_conflict', ConflictError, 409],
    ['invalid_request', ValidationError, 422],
    ['unsupported_market', ValidationError, 422],
  ];
  for (const [code, Class, status] of cases) {
    test(`${status} ${code} -> ${Class.name}`, async () => {
      mock.enqueue(E[code]);
      try {
        await teepay.collections.retrieve('TP1');
        assert.fail('should throw');
      } catch (error) {
        assert.ok(error instanceof Class, error.name);
        assert.ok(error instanceof ApiError);
        assert.ok(error instanceof TeePayError);
        assert.equal(error.name, Class.name);
        assert.equal(error.status, status);
        assert.equal(error.code, code);
        assert.equal(error.message, E[code].body.error.message);
        assert.equal(error.requestId, E[code].body.error.request_id);
        assert.ok(!String(error.message + error.stack).includes('s3cr3tvalue'));
      }
      assert.equal(mock.requests.length, 1, '4xx is never retried');
    });
  }

  test('AccountRestrictedError is also a PermissionError', async () => {
    mock.enqueue(E.account_restricted);
    await assert.rejects(teepay.whoami(), PermissionError);
  });

  test('payout errors with only a code, or a bare string, are parsed', async () => {
    mock.enqueue(E.payout_code_only);
    await assert.rejects(teepay.disbursements.create({ quote_id: 'q1', idempotency_key: 'payout-0001' }), (e) => {
      return e instanceof ConflictError && e.code === 'payout_quote_expired_or_changed' && e.message.length > 0 && e.requestId === 'req_mock_1';
    });
    mock.enqueue(E.payout_string_error);
    await assert.rejects(teepay.disbursements.quote({ money: { amount: 1, currency: 'TZS' }, destination: { channel: 'mobile', name: 'x', phone: '255712345678' }, narration: 'n' }), (e) => {
      return e instanceof ValidationError && e.code === 'invalid_request' && /invalid/.test(e.message);
    });
    mock.enqueue(E.funds_under_review);
    await assert.rejects(teepay.disbursements.create({ quote_id: 'q1', idempotency_key: 'payout-0002' }), (e) => e instanceof ValidationError && e.code === 'funds_under_review');
  });

  test('non-JSON error bodies still produce typed errors', async () => {
    mock.enqueue({ status: 502, rawBody: '<html>bad gateway</html>', headers: { 'Content-Type': 'text/html' } });
    const client = new TeePay(TEST_KEY, { baseUrl: mock.url, maxRetries: 0 });
    await assert.rejects(client.whoami(), (e) => e instanceof ApiError && e.status === 502 && e.code === 'internal_error' && e.body === '<html>bad gateway</html>');
  });

  test('RateLimitError exposes retryAfter', async () => {
    const client = new TeePay(TEST_KEY, { baseUrl: mock.url, maxRetries: 0 });
    mock.enqueue(E.rate_limited);
    await assert.rejects(client.whoami(), (e) => e instanceof RateLimitError && e.retryAfter === 1 && e.status === 429);
  });

  test('500 and 503 are ApiError', async () => {
    const client = new TeePay(TEST_KEY, { baseUrl: mock.url, maxRetries: 0 });
    mock.enqueue(E.internal_error, E.unavailable);
    await assert.rejects(client.whoami(), (e) => e instanceof ApiError && e.status === 500 && e.code === 'internal_error');
    await assert.rejects(client.whoami(), (e) => e instanceof ApiError && e.status === 503 && e.retryAfter === 0);
  });
});

describe('retries and timeouts', () => {
  test('GET retries 503 then succeeds', async () => {
    mock.enqueue(E.unavailable, E.unavailable);
    const who = await teepay.whoami();
    assert.equal(who.environment, 'sandbox');
    assert.equal(mock.requests.length, 3);
  });

  test('POST with idempotency key retries 429/500/503 with the SAME key', async () => {
    mock.enqueue(fast(E.rate_limited), fast(E.internal_error));
    const payment = await teepay.collections.create({ money: { amount_minor: '500000', currency: 'TZS' }, customer: { country: 'TZ', phone: '+255712345678' } });
    assert.equal(payment.status, 'pending');
    assert.equal(mock.requests.length, 3);
    const keys = new Set(mock.requests.map(r => r.headers['idempotency-key']));
    assert.equal(keys.size, 1);
  });

  test('disbursement create retries with the same body key', async () => {
    mock.enqueue(fast(E.unavailable));
    await teepay.disbursements.create({ quote_id: 'q1' });
    assert.equal(mock.requests.length, 2);
    assert.equal(mock.requests[0].body.idempotency_key, mock.requests[1].body.idempotency_key);
  });

  test('POST without a key (quote) is not retried on 5xx but is on 429', async () => {
    const params = { money: { amount: 1000, currency: 'TZS' }, destination: { channel: 'bank', name: 'x', bank: 'CRDB', account: '0123' }, narration: 'n' };
    mock.enqueue(fast(E.unavailable));
    await assert.rejects(teepay.disbursements.quote(params), ApiError);
    assert.equal(mock.requests.length, 1);
    mock.reset();
    mock.enqueue(fast(E.rate_limited));
    const quote = await teepay.disbursements.quote(params);
    assert.equal(quote.id, 'q_4f2c8a1b');
    assert.equal(mock.requests.length, 2);
  });

  test('gives up after maxRetries and throws the last error', async () => {
    const client = new TeePay(TEST_KEY, { baseUrl: mock.url, maxRetries: 1 });
    mock.enqueue(fast(E.unavailable), fast(E.unavailable), fast(E.unavailable));
    await assert.rejects(client.whoami(), (e) => e.status === 503);
    assert.equal(mock.requests.length, 2);
  });

  test('per-request maxRetries overrides the client', async () => {
    mock.enqueue(fast(E.unavailable));
    await assert.rejects(teepay.whoami({ maxRetries: 0 }), ApiError);
    assert.equal(mock.requests.length, 1);
  });

  test('Retry-After over 60 seconds is not waited for', async () => {
    mock.enqueue({ ...E.rate_limited, headers: { 'Retry-After': '3600' } });
    const started = Date.now();
    await assert.rejects(teepay.whoami(), RateLimitError);
    assert.ok(Date.now() - started < 2000);
    assert.equal(mock.requests.length, 1);
  });

  test('timeouts raise TimeoutError and are retried for safe requests', async () => {
    const client = new TeePay(TEST_KEY, { baseUrl: mock.url, timeout: 150, maxRetries: 1 });
    mock.enqueue({ hang: true }, { hang: true });
    await assert.rejects(client.capabilities(), (e) => e instanceof TimeoutError && e instanceof ConnectionError);
    assert.equal(mock.requests.length, 2);
  });

  test('timeouts on a POST without a key are not retried', async () => {
    const client = new TeePay(TEST_KEY, { baseUrl: mock.url, timeout: 150, maxRetries: 2 });
    mock.enqueue({ hang: true });
    await assert.rejects(client.disbursements.quote({ money: { amount: 1, currency: 'TZS' }, destination: { channel: 'mobile', name: 'x', phone: '255712345678' }, narration: 'n' }), TimeoutError);
    assert.equal(mock.requests.length, 1);
  });

  test('connection errors raise ConnectionError, and are retried for safe requests', async () => {
    mock.enqueue({ destroy: true });
    const caps = await teepay.capabilities();
    assert.equal(caps.environment, 'live');
    assert.equal(mock.requests.length, 2);

    const dead = new TeePay(TEST_KEY, { baseUrl: 'http://127.0.0.1:1', maxRetries: 0 });
    await assert.rejects(dead.whoami(), (e) => e instanceof ConnectionError && !(e instanceof TimeoutError) && !e.message.includes('s3cr3tvalue'));
  });

  test('a user AbortSignal cancels without retrying', async () => {
    const controller = new AbortController();
    mock.enqueue({ hang: true });
    const pending = teepay.whoami({ signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(pending, ConnectionError);
    assert.equal(mock.requests.length, 1);
  });

  test('custom fetch is used', async () => {
    const calls = [];
    const client = new TeePay(TEST_KEY, {
      fetch: async (url, init) => {
        calls.push([url, init.method]);
        return new Response(JSON.stringify(fixtures.operations['get-api-key'].body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });
    const who = await client.whoami();
    assert.equal(who.application_reference, 'app_7d2c91');
    assert.deepEqual(calls, [['https://api.teepay.me/v1/whoami', 'GET']]);
  });
});
