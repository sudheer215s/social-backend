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

type Scope = {
  name: string;
  limit: number;
  windowSeconds: number;
};

/**
 * Per-user write velocity limits (api-gateway design §4):
 * - post:create  30 / hour
 * - post:like    500 / hour
 * - graph:follow 100 / day
 */
@Injectable()
export class WriteRateLimitGuard implements CanActivate {
  constructor(@Inject(RATE_LIMITER) private readonly limiter: RateLimiter) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<AuthedRequest>();
    const res = http.getResponse<Response>();
    const userId = req.user?.userId;
    if (!userId) return true;

    const scope = resolveScope(req.method, req.path);
    if (!scope) return true;

    const result = await this.limiter.check(
      `write:${scope.name}:${userId}`,
      scope.limit,
      scope.windowSeconds,
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
          detail: `Rate limit exceeded for ${scope.name}`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

export function resolveScope(method: string, path: string): Scope | null {
  const m = method.toUpperCase();
  const p = path.split('?')[0] ?? path;

  if (m === 'POST' && (p === '/v1/posts' || p.endsWith('/v1/posts'))) {
    return {
      name: 'post:create',
      limit: envInt('POST_CREATE_RATE_LIMIT', 30),
      windowSeconds: envInt('POST_CREATE_RATE_WINDOW_SEC', 3600),
    };
  }
  if (
    (m === 'POST' || m === 'DELETE') &&
    /\/v1\/posts\/[^/]+\/likes$/.test(p)
  ) {
    return {
      name: 'post:like',
      limit: envInt('POST_LIKE_RATE_LIMIT', 500),
      windowSeconds: envInt('POST_LIKE_RATE_WINDOW_SEC', 3600),
    };
  }
  if (
    (m === 'POST' || m === 'DELETE') &&
    /\/v1\/graph\/follows\/[^/]+$/.test(p)
  ) {
    return {
      name: 'graph:follow',
      limit: envInt('GRAPH_FOLLOW_RATE_LIMIT', 100),
      windowSeconds: envInt('GRAPH_FOLLOW_RATE_WINDOW_SEC', 86400),
    };
  }
  return null;
}

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name] ?? fallback);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
