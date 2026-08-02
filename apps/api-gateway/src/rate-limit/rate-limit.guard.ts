import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { RateLimiter } from '@social/platform-redis';
import { RATE_LIMITER } from '../tokens';
import { resolveClientIp } from './client-ip';

/**
 * Fixed-window rate limit for sensitive auth routes.
 * Keyed by *trusted* client IP + route path (see resolveClientIp / F3).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(@Inject(RATE_LIMITER) private readonly limiter: RateLimiter) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const limit = Number(process.env.AUTH_RATE_LIMIT ?? 30);
    const windowSeconds = Number(process.env.AUTH_RATE_WINDOW_SEC ?? 60);
    const resolvedLimit = Number.isFinite(limit) ? limit : 30;
    const resolvedWindow = Number.isFinite(windowSeconds) ? windowSeconds : 60;

    const ip = resolveClientIp(req);
    const key = `auth:${ip}:${req.method}:${req.path}`;
    const result = await this.limiter.check(key, resolvedLimit, resolvedWindow);
    res.setHeader('X-RateLimit-Limit', String(result.limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    res.setHeader('X-RateLimit-Reset', String(result.resetSeconds));
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.resetSeconds));
      throw new HttpException(
        {
          type: 'about:blank',
          title: 'Too Many Requests',
          status: 429,
          detail: 'Rate limit exceeded. Try again later.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
