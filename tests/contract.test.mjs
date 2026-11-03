// Contract test: every public OpenAPI operation is covered by an SDK method that sends the right
// method, path, idempotency and a body accepted by the operation's request schema.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { TeePay } from '../dist/esm/index.js';
import { TEST_KEY, spec, startMockServer } from './helpers/mock-server.mjs';

const ID = '7c0e5d2a-1b3f-4c8e-9a6d-2f4b8e1c0d9a';

/** operationId -> [method, path, how to call it] */
const OPERATIONS = {
  'get-api-key': ['GET', '/v1/whoami', t => t.whoami()],
  'get-capabilities': ['GET', '/v1/capabilities', t => t.capabilities()],
  'create-collection': ['POST', '/v1/collections', t => t.collections.create({ money: { amount_minor: 500000, currency: 'TZS' }, customer: { country: 'TZ', phone: '+255712345678', name: 'Asha Juma', email: 'asha@example.com' }, description: 'Order 1001' })],
  'list-collections': ['GET', '/v1/collections', t => t.collections.list({ limit: 25, status: 'succeeded', currency: 'TZS' })],
  'get-collection': ['GET', '/v1/collections/{reference}', t => t.collections.retrieve('TP8K2M4QZ1')],
  'create-payout-quote': ['POST', '/v1/disbursements/quote', t => t.disbursements.quote({ money: { amount: 2500000, currency: 'TZS' }, destination: { channel: 'mobile', name: 'Juma Ali', phone: '255712345678' }, narration: 'Supplier payment October' })],
  'create-payout': ['POST', '/v1/disbursements', t => t.disbursements.create({ quote_id: 'q_4f2c8a1b' })],
  'list-payouts': ['GET', '/v1/disbursements', t => t.disbursements.list({ limit: 10 })],
  'get-payout': ['GET', '/v1/disbursements/{reference}', t => t.disbursements.retrieve('TPPO7Q2X9D')],
  'create-control-number': ['POST', '/v1/control-numbers', t => t.controlNumbers.create({ kind: 'bill', customer: { name: 'Asha Juma', phone: '0712345678' }, description: 'School fees, term 1', amount_minor: '5000000', payment_mode: 'EXACT' })],
  'list-control-numbers': ['GET', '/v1/control-numbers', t => t.controlNumbers.list({ cursor: '22222222-2222-4222-8222-222222222222' })],
  'get-control-number': ['GET', '/v1/control-numbers/{id}', t => t.controlNumbers.retrieve('22222222-2222-4222-8222-222222222222')],
  'create-checkout-session': ['POST', '/v1/checkout-sessions', t => t.checkoutSessions.create({ title: 'Order 1001', description: '2 x Coffee bag', amount_minor: 500000, currency: 'TZS', expires_in: 86400, reference: 'order-1001', metadata: { cart: 'c-77' } })],
  'list-checkout-sessions': ['GET', '/v1/checkout-sessions', t => t.checkoutSessions.list({ limit: 20 })],
  'get-checkout-session': ['GET', '/v1/checkout-sessions/{id}', t => t.checkoutSessions.retrieve(ID)],
};

// GET /v1/disbursements shares the collections list handler, which accepts these query
// parameters, but the OpenAPI contract does not declare them (see docs: pagination).
const UNDECLARED_BUT_ACCEPTED = { 'list-payouts': ['limit', 'cursor', 'status', 'currency'] };

function specOperations(document) {
  const ops = [];
  for (const [path, item] of Object.entries(document.paths)) {
    for (const [method, op] of Object.entries(item)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      ops.push({ method: method.toUpperCase(), path, operationId: op.operationId, op });
    }
  }
  return ops;
}

/** Minimal JSON Schema check for the keywords the request schemas use. */
function validate(schema, value, where = '$') {
  const errors = [];
  if (!schema) return errors;
  if (schema.oneOf) {
    const matches = schema.oneOf.filter(s => validate(s, value, where).length === 0).length;
    if (matches !== 1) errors.push(`${where}: matches ${matches} of oneOf`);
    return errors;
  }
  if ('const' in schema && value !== schema.const) errors.push(`${where}: expected const ${schema.const}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${where}: not in enum`);
  const type = schema.type;
  if (type === 'object' || schema.properties) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [...errors, `${where}: expected object`];
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${where}.${key}: required`);
    for (const [key, item] of Object.entries(value)) {
      const sub = schema.properties?.[key];
      if (sub) errors.push(...validate(sub, item, `${where}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${where}.${key}: not allowed`);
      else if (typeof schema.additionalProperties === 'object') errors.push(...validate(schema.additionalProperties, item, `${where}.${key}`));
      if (schema.propertyNames?.pattern && !new RegExp(schema.propertyNames.pattern).test(key)) errors.push(`${where}.${key}: bad name`);
      if (key !== key.toLowerCase()) errors.push(`${where}.${key}: key must be lowercase`);
    }
    return errors;
  }
  if (type === 'string') {
    if (typeof value !== 'string') return [...errors, `${where}: expected string`];
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${where}: pattern`);
    if (schema.maxLength != null && value.length > schema.maxLength) errors.push(`${where}: maxLength`);
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${where}: minLength`);
  }
  if (type === 'integer' && !Number.isInteger(value)) errors.push(`${where}: expected integer`);
  return errors;
}

let mock;
before(async () => {
  mock = await startMockServer();
});
after(async () => {
  await mock.close();
});

test('vendored spec contains only public /v1 operations', () => {
  const ops = specOperations(spec);
  assert.equal(ops.length, 15);
  for (const op of ops) assert.ok(op.path.startsWith('/v1/'), op.path);
  assert.deepEqual(Object.keys(spec.components.securitySchemes), ['BearerAuth']);
});

test('every public operation is mapped to an SDK method, and nothing extra', () => {
  const ids = specOperations(spec).map(o => o.operationId).sort();
  assert.deepEqual(Object.keys(OPERATIONS).sort(), ids);
  for (const { operationId, method, path } of specOperations(spec)) {
    assert.deepEqual(OPERATIONS[operationId].slice(0, 2), [method, path], operationId);
  }
});

const upstream = process.env.TEEPAY_OPENAPI ?? new URL('../../../teepay/docs-site/openapi/teepay.json', import.meta.url);
test('vendored spec matches the published TeePay spec', { skip: !existsSync(upstream) && 'published spec not available' }, () => {
  const live = JSON.parse(readFileSync(upstream, 'utf8'));
  const key = o => `${o.method} ${o.path} ${o.operationId}`;
  assert.deepEqual(specOperations(spec).map(key).sort(), specOperations(live).map(key).sort());
});

for (const { operationId, method, path, op } of specOperations(spec)) {
  test(`${operationId}: ${method} ${path}`, async () => {
    mock.reset();
    const teepay = new TeePay(TEST_KEY, { baseUrl: mock.url });
    const result = await OPERATIONS[operationId][2](teepay);
    assert.equal(mock.requests.length, 1);
    const req = mock.requests[0];
    assert.equal(req.method, method);
    assert.match(req.path, new RegExp('^' + path.replace(/\{[^}]+\}/g, '[^/]+') + '$'));
    assert.equal(req.headers.authorization, `Bearer ${TEST_KEY}`);

    const headerKey = (op.parameters ?? []).find(p => p.in === 'header' && p.name === 'Idempotency-Key');
    if (headerKey) {
      assert.ok(req.headers['idempotency-key'], 'Idempotency-Key header required');
      const s = headerKey.schema;
      assert.match(req.headers['idempotency-key'], new RegExp(s.pattern));
      assert.ok(req.headers['idempotency-key'].length >= s.minLength && req.headers['idempotency-key'].length <= s.maxLength);
    } else {
      assert.equal(req.headers['idempotency-key'], undefined);
    }

    const bodySchema = op.requestBody?.content?.['application/json']?.schema;
    if (bodySchema) {
      assert.equal(req.headers['content-type'], 'application/json');
      assert.deepEqual(validate(bodySchema, req.body), []);
    } else {
      assert.equal(req.rawBody, '');
    }

    for (const [name, value] of Object.entries(req.query)) {
      const param = (op.parameters ?? []).find(p => p.in === 'query' && p.name === name) ?? (UNDECLARED_BUT_ACCEPTED[operationId] ?? []).includes(name);
      assert.ok(param, `undocumented query parameter ${name}`);
    }
    const success = Object.keys(op.responses).filter(s => s.startsWith('2')).map(Number);
    assert.ok(success.includes(result.lastResponse.status), `${result.lastResponse.status} not in ${success}`);
  });
}
