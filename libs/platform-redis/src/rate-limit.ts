import type { RedisClient } from './client';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetSeconds: number;
}

export interface RateLimiter {
  /**
   * Fixed-window counter. Returns whether the call is allowed under `limit`
   * requests per `windowSeconds`.
   */
  check(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult>;
}

export class RedisFixedWindowRateLimiter implements RateLimiter {
  constructor(
    private readonly redis: RedisClient,
    private readonly prefix = 'rl:',
  ) {}

  async check(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    const redisKey = `${this.prefix}${key}`;
    const count = await this.redis.incr(redisKey);
    if (count === 1) {
      await this.redis.expire(redisKey, windowSeconds);
    }
    const ttl = await this.redis.ttl(redisKey);
    const resetSeconds = ttl > 0 ? ttl : windowSeconds;
    const remaining = Math.max(0, limit - count);
    return {
      allowed: count <= limit,
      remaining,
      limit,
      resetSeconds,
    };
  }
}

/** In-memory fixed window for unit tests. */
export class MemoryFixedWindowRateLimiter implements RateLimiter {
  private readonly buckets = new Map<
    string,
    { count: number; resetAt: number }
  >();

  check(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowSeconds * 1000 };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    const remaining = Math.max(0, limit - bucket.count);
    return Promise.resolve({
      allowed: bucket.count <= limit,
      remaining,
      limit,
      resetSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    });
  }
}
