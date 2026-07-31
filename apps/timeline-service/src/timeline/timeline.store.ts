import type { Redis } from 'ioredis';

const CAP = 400;
const TTL_SECONDS = 14 * 24 * 60 * 60; // 14 days
const FANOUT_LUA = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  redis.call('ZADD', KEYS[1], 0, ARGV[1])
  redis.call('ZREMRANGEBYRANK', KEYS[1], 0, -401)
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
  return 1
end
return 0
`;

export function timelineKey(userId: string): string {
  return `tl:h:${userId}`;
}

/**
 * UUIDv7 string as ZSET member — lex order ≈ chronological order.
 */
export class TimelineStore {
  private sha: string | undefined;

  constructor(private readonly redis: Redis) {}

  private async ensureScript(): Promise<string> {
    if (!this.sha) {
      this.sha = (await this.redis.script('LOAD', FANOUT_LUA)) as string;
    }
    return this.sha;
  }

  /**
   * Fan-out write: only if the timeline key already exists (active reader).
   */
  async fanoutIfExists(userId: string, postId: string): Promise<boolean> {
    const key = timelineKey(userId);
    try {
      const sha = await this.ensureScript();
      const res = await this.redis.evalsha(
        sha,
        1,
        key,
        postId,
        String(TTL_SECONDS),
      );
      return res === 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('NOSCRIPT')) {
        this.sha = undefined;
        return this.fanoutIfExists(userId, postId);
      }
      throw err;
    }
  }

  /**
   * Materialise / refresh a home timeline with post IDs (newest first).
   */
  async replaceTimeline(
    userId: string,
    postIdsNewestFirst: string[],
  ): Promise<void> {
    const key = timelineKey(userId);
    const multi = this.redis.multi();
    multi.del(key);
    // ZADD with score 0; members ordered by lex (UUIDv7). Store as we get them.
    for (const id of postIdsNewestFirst.slice(0, CAP)) {
      multi.zadd(key, 0, id);
    }
    multi.expire(key, TTL_SECONDS);
    await multi.exec();
  }

  async touch(userId: string): Promise<void> {
    await this.redis.expire(timelineKey(userId), TTL_SECONDS);
  }

  async exists(userId: string): Promise<boolean> {
    return (await this.redis.exists(timelineKey(userId))) === 1;
  }

  /**
   * Newest-first page via reverse lex range on UUIDv7 members.
   */
  async page(
    userId: string,
    limit: number,
    beforePostId?: string,
  ): Promise<string[]> {
    const key = timelineKey(userId);
    const max = beforePostId ? `(${beforePostId}` : '+';
    // ZREVRANGEBYLEX: max to min
    const ids = await this.redis.zrevrangebylex(
      key,
      max,
      '-',
      'LIMIT',
      0,
      Math.min(Math.max(limit, 1), 100),
    );
    await this.touch(userId);
    return ids;
  }
}
