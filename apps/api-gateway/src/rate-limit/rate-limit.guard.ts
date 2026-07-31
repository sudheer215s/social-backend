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

/**
 * Fixed-window rate limit for sensitive auth routes.
 * Keyed by client IP + route path.
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

    const ip =
      (typeof req.headers['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0]?.trim()
        : undefined) ||
      req.ip ||
      req.socket.remoteAddress ||
      'unknown';
    const key = `${ip}:${req.method}:${req.path}`;
    const result = await this.limiter.check(key, resolvedLimit, resolvedWindow);
    res.setHeader('X-RateLimit-Limit', String(result.limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    res.setHeader('X-RateLimit-Reset', String(result.resetSeconds));
    if (!result.allowed) {
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
