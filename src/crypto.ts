// Server-side crypto helpers. The SDK targets server runtimes (Node 18+, Bun, Deno with node: support).
import * as nodeCrypto from 'node:crypto';

export function randomUUID(): string {
  const web = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (web && typeof web.randomUUID === 'function') return web.randomUUID();
  return nodeCrypto.randomUUID();
}

export function hmacSha256Hex(secret: string, data: Uint8Array[]): string {
  const mac = nodeCrypto.createHmac('sha256', secret);
  for (const part of data) mac.update(part);
  return mac.digest('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    // Still spend comparable time so length differences leak as little as possible.
    nodeCrypto.timingSafeEqual(left, left);
    return false;
  }
  return nodeCrypto.timingSafeEqual(left, right);
}
