import type { NextFunction, Request, Response } from 'express';

/**
 * Lightweight security headers (no helmet dep). Applied at the public edge.
 */
export function securityHeadersMiddleware() {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()',
    );
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    if (process.env.NODE_ENV === 'production') {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=63072000; includeSubDomains',
      );
    }
    next();
  };
}

export function configureCorsOrigins():
  boolean | string | RegExp | (string | RegExp)[] {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (!raw || raw === '*') {
    // Dev default: allow local web; production should set CORS_ORIGINS.
    if (process.env.NODE_ENV === 'production') {
      return false;
    }
    return true;
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
