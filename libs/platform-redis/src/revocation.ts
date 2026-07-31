import type { RedisClient } from './client';

/** Access tokens live ≤ 10 minutes — revocation entries expire with them. */
export const ACCESS_TOKEN_REVOCATION_TTL_SECONDS = 10 * 60;

const keyFor = (sid: string) => `auth:revoked:sid:${sid}`;

export interface SidRevocationStore {
  revoke(sid: string, ttlSeconds?: number): Promise<void>;
  revokeMany(sids: string[], ttlSeconds?: number): Promise<void>;
  /**
   * Returns true if the session id is revoked.
   * **Fail-open** when Redis is unavailable (design: profile/authz fail open ≤10m).
   */
  isRevoked(sid: string): Promise<boolean>;
}

export class RedisSidRevocationStore implements SidRevocationStore {
  constructor(private readonly redis: RedisClient) {}

  async revoke(
    sid: string,
    ttlSeconds: number = ACCESS_TOKEN_REVOCATION_TTL_SECONDS,
  ): Promise<void> {
    await this.redis.set(keyFor(sid), '1', 'EX', ttlSeconds);
  }

  async revokeMany(
    sids: string[],
    ttlSeconds: number = ACCESS_TOKEN_REVOCATION_TTL_SECONDS,
  ): Promise<void> {
    if (sids.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const sid of sids) {
      pipeline.set(keyFor(sid), '1', 'EX', ttlSeconds);
    }
    await pipeline.exec();
  }

  async isRevoked(sid: string): Promise<boolean> {
    try {
      const v = await this.redis.get(keyFor(sid));
      return v !== null;
    } catch {
      return false;
    }
  }
}

/** In-memory store for unit tests. */
export class MemorySidRevocationStore implements SidRevocationStore {
  private readonly map = new Map<string, number>();

  revoke(
    sid: string,
    ttlSeconds: number = ACCESS_TOKEN_REVOCATION_TTL_SECONDS,
  ): Promise<void> {
    this.map.set(sid, Date.now() + ttlSeconds * 1000);
    return Promise.resolve();
  }

  revokeMany(
    sids: string[],
    ttlSeconds: number = ACCESS_TOKEN_REVOCATION_TTL_SECONDS,
  ): Promise<void> {
    for (const s of sids) {
      this.map.set(s, Date.now() + ttlSeconds * 1000);
    }
    return Promise.resolve();
  }

  isRevoked(sid: string): Promise<boolean> {
    const exp = this.map.get(sid);
    if (exp === undefined) return Promise.resolve(false);
    if (exp <= Date.now()) {
      this.map.delete(sid);
      return Promise.resolve(false);
    }
    return Promise.resolve(true);
  }
}

/** No-op store when Redis is not configured. */
export class NoopSidRevocationStore implements SidRevocationStore {
  revoke(): Promise<void> {
    return Promise.resolve();
  }
  revokeMany(): Promise<void> {
    return Promise.resolve();
  }
  isRevoked(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
