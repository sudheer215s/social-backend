import {
  clearRefreshCookie,
  extractRefreshTokenFromBody,
  getRefreshCookie,
  parseCookies,
  REFRESH_COOKIE,
  setRefreshCookie,
  tokensFromJson,
} from './refresh-cookie';
import type { Request, Response } from 'express';

describe('refresh-cookie', () => {
  it('parses cookie header', () => {
    expect(parseCookies('a=1; rt=secret-token-value-here')).toEqual({
      a: '1',
      rt: 'secret-token-value-here',
    });
  });

  it('reads refresh cookie', () => {
    const req = {
      headers: { cookie: `${REFRESH_COOKIE}=${'x'.repeat(24)}` },
    } as unknown as Request;
    expect(getRefreshCookie(req)?.length).toBe(24);
  });

  it('sets and clears Set-Cookie', () => {
    const headers: Record<string, string | string[]> = {};
    const res = {
      getHeader: (k: string) => headers[k.toLowerCase()],
      setHeader: (k: string, v: string | string[]) => {
        headers[k.toLowerCase()] = v;
      },
    } as unknown as Response;
    setRefreshCookie(res, 'y'.repeat(32));
    expect(String(headers['set-cookie'])).toContain('HttpOnly');
    expect(String(headers['set-cookie'])).toContain('Path=/v1/auth');
    clearRefreshCookie(res);
    const sc = headers['set-cookie'];
    const last = Array.isArray(sc) ? sc[sc.length - 1] : sc;
    expect(String(last)).toContain('Max-Age=0');
  });

  it('extracts body and nested tokens', () => {
    expect(
      extractRefreshTokenFromBody({ refreshToken: 'z'.repeat(24) }),
    ).toHaveLength(24);
    expect(
      tokensFromJson({ tokens: { refreshToken: 'a'.repeat(24) } })
        ?.refreshToken,
    ).toHaveLength(24);
  });
});
