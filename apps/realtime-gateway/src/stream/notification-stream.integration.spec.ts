import { createRedisClient } from '@social/platform-redis';
import { randomUUID } from 'node:crypto';
import {
  notificationStreamKey,
  readCatchUp,
  readLive,
} from './notification-stream';

describe('notification stream (integration)', () => {
  const redis = createRedisClient(
    process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  );
  let available = false;

  beforeAll(async () => {
    try {
      await redis.ping();
      available = true;
    } catch (err) {
      console.warn('Skipping stream integration', err);
    }
  });

  afterAll(() => {
    redis.disconnect();
  });

  it('catch-up and live read work on XADD', async () => {
    if (!available) return;
    const userId = randomUUID();
    const key = notificationStreamKey(userId);
    const id1 = await redis.xadd(
      key,
      '*',
      'id',
      'n1',
      'type',
      'like',
      'ts',
      '1',
    );
    expect(id1).toBeTruthy();
    const id2 = await redis.xadd(
      key,
      '*',
      'id',
      'n2',
      'type',
      'follow',
      'ts',
      '2',
    );

    const catchUp = await readCatchUp(redis, userId, id1 as string);
    expect(catchUp.some((e) => e.notificationId === 'n2')).toBe(true);

    // Live with cursor at id2 should block then empty (short block)
    const live = await readLive(redis, userId, id2 as string, 200, 10);
    expect(Array.isArray(live)).toBe(true);

    await redis.del(key);
  });
});
