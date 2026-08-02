import type { NextFunction, Request, Response } from 'express';
import type { RateLimiter } from '@social/platform-redis';
import { resolveClientIp } from './client-ip';

const SKIP_PREFIXES = [
  '/metrics',
  '/health',
  '/.well-known',
  '/v1/auth/jwks',
];

/**
 * Anonymous scrape backstop: 100 req / hour per client IP (design §4 `anon`).
 * Authenticated requests (Bearer present) skip this bucket.
 * IP resolution uses trusted X-Forwarded-For only (F3).
 */
export function createAnonRateLimitMiddleware(limiter: RateLimiter) {
  const limit = Number(process.env.ANON_RATE_LIMIT ?? 100);
  const windowSeconds = Number(process.env.ANON_RATE_WINDOW_SEC ?? 3600);
  const resolvedLimit = Number.isFinite(limit) ? limit : 100;
  const resolvedWindow = Number.isFinite(windowSeconds) ? windowSeconds : 3600;

  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const path = req.path || '/';
      if (SKIP_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
        next();
        return;
      }
      const auth = req.headers.authorization;
      if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
        next();
        return;
      }

      const ip = resolveClientIp(req);
      const result = await limiter.check(
        `anon:${ip}`,
        resolvedLimit,
        resolvedWindow,
      );
      res.setHeader('X-RateLimit-Limit', String(result.limit));
      res.setHeader('X-RateLimit-Remaining', String(result.remaining));
      res.setHeader('X-RateLimit-Reset', String(result.resetSeconds));
      if (!result.allowed) {
        res.setHeader('Retry-After', String(result.resetSeconds));
        res.status(429).json({
          type: 'about:blank',
          title: 'Too Many Requests',
          status: 429,
          detail: 'Anonymous rate limit exceeded. Try again later.',
        });
        return;
      }
      next();
    } catch {
      // Fail open if limiter errors (design §4).
      next();
    }
  };
}
