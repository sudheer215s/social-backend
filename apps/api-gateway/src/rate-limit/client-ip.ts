import type { Request } from 'express';

/**
 * Resolve the client IP for rate limiting.
 *
 * Blindly trusting `X-Forwarded-For` is a bypass (any client can spoof it).
 * We only honour XFF / X-Real-IP when the *direct peer* is a trusted proxy
 * (CDN, ingress, or SSR renderer allow-list). See frontend review F3.
 *
 * Env:
 * - `TRUSTED_PROXIES` — comma-separated IPs or CIDR prefixes (e.g. `10.0.0.0/8,::1`)
 * - Loopback peers are always treated as trusted in non-production, or when
 *   `TRUST_LOOPBACK_PROXY=1`.
 */
export function resolveClientIp(req: Request): string {
  const peer = normalizeIp(
    req.socket.remoteAddress || req.ip || 'unknown',
  );
  if (!isTrustedPeer(peer)) {
    return peer;
  }

  const realIp = firstHeader(req.headers['x-real-ip']);
  if (realIp) return normalizeIp(realIp);

  const xff = firstHeader(req.headers['x-forwarded-for']);
  if (xff) {
    // Left-most = original client when proxies append to the right.
    const first = xff.split(',')[0]?.trim();
    if (first) return normalizeIp(first);
  }

  return peer;
}

export function parseTrustedProxies(
  raw: string = process.env.TRUSTED_PROXIES ?? '',
): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isTrustedPeer(
  peer: string,
  trusted: string[] = parseTrustedProxies(),
): boolean {
  const ip = normalizeIp(peer);
  if (trusted.some((entry) => matchProxyEntry(ip, entry))) {
    return true;
  }
  const trustLoopback =
    process.env.TRUST_LOOPBACK_PROXY === '1' ||
    process.env.NODE_ENV !== 'production';
  if (trustLoopback && isLoopback(ip)) {
    return true;
  }
  return false;
}

function matchProxyEntry(ip: string, entry: string): boolean {
  if (entry.includes('/')) {
    return ipInCidr(ip, entry);
  }
  return normalizeIp(entry) === ip;
}

function isLoopback(ip: string): boolean {
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip.startsWith('127.')
  );
}

/** Strip IPv4-mapped IPv6 prefix for stable comparison. */
export function normalizeIp(ip: string): string {
  const t = ip.trim();
  if (t.startsWith('::ffff:')) {
    return t.slice(7);
  }
  return t;
}

function firstHeader(v: string | string[] | undefined): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (Array.isArray(v) && typeof v[0] === 'string' && v[0].trim()) {
    return v[0].trim();
  }
  return undefined;
}

/** Minimal IPv4 CIDR match; IPv6 exact match only (no IPv6 CIDR math). */
export function ipInCidr(ip: string, cidr: string): boolean {
  const [net, bitsStr] = cidr.split('/');
  if (!net || !bitsStr) return false;
  const bits = Number(bitsStr);
  if (!Number.isFinite(bits) || bits < 0 || bits > 32) return false;
  const ipN = ipv4ToInt(normalizeIp(ip));
  const netN = ipv4ToInt(normalizeIp(net));
  if (ipN === null || netN === null) {
    // Non-IPv4: only exact network string match
    return normalizeIp(ip) === normalizeIp(net);
  }
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~0 << (32 - bits)) >>> 0;
  return (ipN & mask) === (netN & mask);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = (n << 8) | o;
  }
  return n >>> 0;
}
