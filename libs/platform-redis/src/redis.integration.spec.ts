import { createRedisClient } from './client';
import { RedisFixedWindowRateLimiter } from './rate-limit';
import { RedisSidRevocationStore } from './revocation';

const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

describe('platform-redis (integration)', () => {
  const redis = createRedisClient(url);
  let available = false;

  beforeAll(async () => {
    try {
      await redis.ping();
      available = true;
    } catch (err) {
      console.warn('Skipping redis integration', err);
      available = false;
    }
  });

  afterAll(() => {
    redis.disconnect();
  });

  it('revokes sids with TTL', async () => {
    if (!available) return;
    const store = new RedisSidRevocationStore(redis);
    const sid = `test-sid-${Date.now()}`;
    await expect(store.isRevoked(sid)).resolves.toBe(false);
    await store.revoke(sid, 30);
    await expect(store.isRevoked(sid)).resolves.toBe(true);
  });

  it('rate limits a fixed window', async () => {
    if (!available) return;
    const rl = new RedisFixedWindowRateLimiter(redis, 'test-rl:');
    const key = `ip:${Date.now()}`;
    const r1 = await rl.check(key, 2, 30);
    const r2 = await rl.check(key, 2, 30);
    const r3 = await rl.check(key, 2, 30);
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(false);
  });
});
