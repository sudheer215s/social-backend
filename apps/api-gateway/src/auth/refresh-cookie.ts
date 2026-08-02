import type { Request, Response } from 'express';

/** httpOnly refresh cookie (frontend review F1). Path-scoped to auth routes. */
export const REFRESH_COOKIE = 'rt';
export const REFRESH_COOKIE_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 days

export function parseCookies(
  header: string | undefined,
): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function getRefreshCookie(req: Request): string | undefined {
  const cookies = parseCookies(
    typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined,
  );
  const v = cookies[REFRESH_COOKIE];
  return v && v.length >= 20 ? v : undefined;
}

export function setRefreshCookie(res: Response, refreshToken: string): void {
  const secure =
    process.env.COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production';
  const parts = [
    `${REFRESH_COOKIE}=${encodeURIComponent(refreshToken)}`,
    'HttpOnly',
    'Path=/v1/auth',
    'SameSite=Strict',
    `Max-Age=${REFRESH_COOKIE_MAX_AGE_SEC}`,
  ];
  if (secure) parts.push('Secure');
  const domain = process.env.COOKIE_DOMAIN?.trim();
  if (domain) parts.push(`Domain=${domain}`);
  // Append rather than overwrite other Set-Cookie headers.
  const prev = res.getHeader('Set-Cookie');
  if (!prev) {
    res.setHeader('Set-Cookie', parts.join('; '));
  } else if (Array.isArray(prev)) {
    res.setHeader('Set-Cookie', [...prev.map(String), parts.join('; ')]);
  } else {
    res.setHeader('Set-Cookie', [String(prev), parts.join('; ')]);
  }
}

export function clearRefreshCookie(res: Response): void {
  const secure =
    process.env.COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production';
  const parts = [
    `${REFRESH_COOKIE}=`,
    'HttpOnly',
    'Path=/v1/auth',
    'SameSite=Strict',
    'Max-Age=0',
  ];
  if (secure) parts.push('Secure');
  const domain = process.env.COOKIE_DOMAIN?.trim();
  if (domain) parts.push(`Domain=${domain}`);
  const prev = res.getHeader('Set-Cookie');
  if (!prev) {
    res.setHeader('Set-Cookie', parts.join('; '));
  } else if (Array.isArray(prev)) {
    res.setHeader('Set-Cookie', [...prev.map(String), parts.join('; ')]);
  } else {
    res.setHeader('Set-Cookie', [String(prev), parts.join('; ')]);
  }
}

export function extractRefreshTokenFromBody(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const rt = (body as { refreshToken?: unknown }).refreshToken;
  return typeof rt === 'string' && rt.length >= 20 ? rt : undefined;
}

export function tokensFromJson(
  json: unknown,
): { refreshToken?: string } | null {
  if (!json || typeof json !== 'object') return null;
  const tokens = (json as { tokens?: unknown }).tokens;
  if (!tokens || typeof tokens !== 'object') return null;
  const refreshToken = (tokens as { refreshToken?: unknown }).refreshToken;
  if (typeof refreshToken !== 'string') return {};
  return { refreshToken };
}
