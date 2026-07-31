import Redis from 'ioredis';

export type RedisClient = Redis;

export function createRedisClient(
  url: string = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
): RedisClient {
  return new Redis(url, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    lazyConnect: false,
  });
}
