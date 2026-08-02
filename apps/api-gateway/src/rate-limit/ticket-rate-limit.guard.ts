import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Response } from 'express';
import type { RateLimiter } from '@social/platform-redis';
import type { AuthedRequest } from '../auth/auth.guard';
import { RATE_LIMITER } from '../tokens';

/**
 * Dedicated realtime:ticket scope (~20/min per user) — frontend review F2.
 * Keyed by authenticated user id, not IP.
 */
@Injectable()
export class TicketRateLimitGuard implements CanActivate {
  constructor(@Inject(RATE_LIMITER) private readonly limiter: RateLimiter) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<AuthedRequest>();
    const res = http.getResponse<Response>();
    const userId = req.user?.userId;
    if (!userId) {
      return true; // AuthGuard should have already failed
    }

    const limit = Number(process.env.TICKET_RATE_LIMIT ?? 20);
    const windowSeconds = Number(process.env.TICKET_RATE_WINDOW_SEC ?? 60);
    const resolvedLimit = Number.isFinite(limit) ? limit : 20;
    const resolvedWindow = Number.isFinite(windowSeconds) ? windowSeconds : 60;

    const result = await this.limiter.check(
      `realtime:ticket:${userId}`,
      resolvedLimit,
      resolvedWindow,
    );
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
          detail: 'Realtime ticket rate limit exceeded. Try again later.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
