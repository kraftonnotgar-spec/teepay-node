// Local TeePay API mock: replays responses from tests/fixtures/fixtures.json and records every request.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

export const fixtures = JSON.parse(readFileSync(new URL('../fixtures/fixtures.json', import.meta.url), 'utf8'));
export const spec = JSON.parse(readFileSync(new URL('../fixtures/openapi.public.json', import.meta.url), 'utf8'));

function templateToRegex(path) {
  return new RegExp('^' + path.replace(/\{[^}]+\}/g, '[^/]+') + '$');
}

const routes = Object.entries(fixtures.operations).map(([operationId, op]) => ({
  operationId,
  method: op.method,
  regex: templateToRegex(op.path),
  op,
}));

export async function startMockServer() {
  const requests = [];
  /** Responses consumed in order before falling back to fixtures. Each: {status, body, headers} | {hang:true} | {destroy:true} | fn(req)->spec */
  const queue = [];
  const sockets = new Set();
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const url = new URL(req.url, 'http://127.0.0.1');
      const route = routes.find(r => r.method === req.method && r.regex.test(url.pathname));
      const record = {
        method: req.method,
        path: url.pathname,
        rawPath: req.url.split('?')[0],
        query: Object.fromEntries(url.searchParams),
        headers: req.headers,
        rawBody: raw,
        body: raw ? safeJson(raw) : null,
        operationId: route?.operationId ?? null,
      };
      requests.push(record);
      let next = queue.shift();
      if (typeof next === 'function') next = next(record);
      if (next?.destroy) return req.socket.destroy();
      if (next?.hang) return; // never answer: exercises the client timeout
      const spec = next ?? (route ? { status: route.op.status, body: route.op.body } : fixtures.errors.not_found);
      const headers = {
        'Content-Type': 'application/json',
        'X-Request-ID': 'req_mock_' + requests.length,
        'TeePay-Version': '2026-10-18',
        'RateLimit-Limit': '120',
        'RateLimit-Remaining': '119',
        'RateLimit-Reset': '30',
        ...(spec.headers ?? {}),
      };
      res.writeHead(spec.status, headers);
      res.end(spec.rawBody ?? (spec.body === undefined ? '' : JSON.stringify(spec.body)));
    });
  });
  server.on('connection', s => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    queue,
    reset() {
      requests.length = 0;
      queue.length = 0;
    },
    enqueue(...specs) {
      queue.push(...specs);
    },
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const TEST_KEY = 'tp_test_0123456789abcdef0123456789abcdef.s3cr3tvalue';
export const LIVE_KEY = 'tp_live_0123456789abcdef0123456789abcdef.s3cr3tvalue';
