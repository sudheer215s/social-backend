import {
  ipInCidr,
  isTrustedPeer,
  normalizeIp,
  parseTrustedProxies,
  resolveClientIp,
} from './client-ip';
import type { Request } from 'express';

function mockReq(partial: {
  remoteAddress?: string;
  ip?: string;
  headers?: Record<string, string | string[]>;
}): Request {
  return {
    socket: { remoteAddress: partial.remoteAddress },
    ip: partial.ip,
    headers: partial.headers ?? {},
  } as unknown as Request;
}

describe('client-ip', () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
  });

  it('normalizes IPv4-mapped IPv6', () => {
    expect(normalizeIp('::ffff:10.0.0.5')).toBe('10.0.0.5');
  });

  it('matches IPv4 CIDR', () => {
    expect(ipInCidr('10.1.2.3', '10.0.0.0/8')).toBe(true);
    expect(ipInCidr('11.0.0.1', '10.0.0.0/8')).toBe(false);
  });

  it('does not trust XFF from untrusted peer', () => {
    process.env.NODE_ENV = 'production';
    process.env.TRUSTED_PROXIES = '10.0.0.1';
    delete process.env.TRUST_LOOPBACK_PROXY;
    const ip = resolveClientIp(
      mockReq({
        remoteAddress: '203.0.113.9',
        headers: { 'x-forwarded-for': '1.2.3.4' },
      }),
    );
    expect(ip).toBe('203.0.113.9');
  });

  it('honours XFF from trusted peer', () => {
    process.env.NODE_ENV = 'production';
    process.env.TRUSTED_PROXIES = '10.0.0.0/8';
    const ip = resolveClientIp(
      mockReq({
        remoteAddress: '10.0.0.5',
        headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.5' },
      }),
    );
    expect(ip).toBe('198.51.100.7');
  });

  it('trusts loopback in non-production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.TRUSTED_PROXIES;
    expect(isTrustedPeer('127.0.0.1')).toBe(true);
    expect(parseTrustedProxies('a, b')).toEqual(['a', 'b']);
  });
});
