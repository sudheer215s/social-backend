import type { Redis } from 'ioredis';

const STREAM_MAXLEN = 200;
const STREAM_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export function notificationStreamKey(userId: string): string {
  return `ntf:s:${userId}`;
}

/**
 * After Postgres commit: pointer-only XADD so realtime-gateway can push.
 * Failure is non-fatal — client poll / reconnect catch-up covers gaps.
 */
export async function publishNotificationPointer(
  redis: Redis,
  input: { userId: string; notificationId: string; type: string },
): Promise<string | null> {
  const key = notificationStreamKey(input.userId);
  const id = await redis.xadd(
    key,
    'MAXLEN',
    '~',
    String(STREAM_MAXLEN),
    '*',
    'id',
    input.notificationId,
    'type',
    input.type,
    'ts',
    String(Date.now()),
  );
  await redis.expire(key, STREAM_TTL_SECONDS);
  return id;
}
