import type { RedisClient } from '@social/platform-redis';
import type { TicketService } from '../ticket/ticket.service';
import { hydrateNotifications } from '../stream/hydrate';
import { readCatchUp, readLive } from '../stream/notification-stream';
import type { RealtimeFrame } from './protocol';

export interface DeliverySessionOptions {
  redis: RedisClient;
  tickets: TicketService;
  userId: string;
  connId: string;
  connRef: string;
  since?: string;
  send: (frame: RealtimeFrame) => void;
  isClosed: () => boolean;
  notificationBaseUrl?: string;
  serviceToken?: string;
  /** Emit connection_limit error if true */
  evicted?: boolean;
}

/**
 * Shared delivery loop for SSE and WebSocket:
 * catch-up → ready → XREAD BLOCK → optional hydrate → push.
 */
export async function runDeliverySession(
  options: DeliverySessionOptions,
): Promise<void> {
  const {
    redis,
    tickets,
    userId,
    connId,
    connRef,
    send,
    isClosed,
  } = options;
  const notifBase =
    options.notificationBaseUrl ??
    process.env.NOTIFICATION_BASE_URL ??
    'http://127.0.0.1:3005';
  const serviceToken =
    options.serviceToken ?? process.env.REALTIME_SERVICE_TOKEN ?? '';

  let cursor =
    options.since && options.since !== '$' ? options.since : '$';

  if (options.evicted) {
    send({
      t: 'error',
      d: {
        code: 'connection_limit',
        message: 'oldest connection superseded',
      },
    });
  }

  if (options.since && options.since !== '$') {
    try {
      const missed = await readCatchUp(redis, userId, options.since);
      await pushEntries(missed, {
        send,
        notifBase,
        userId,
        serviceToken,
        setCursor: (id) => {
          cursor = id;
        },
      });
    } catch {
      // Redis blip — still open for live
    }
  }

  send({
    t: 'ready',
    d: { since: cursor === '$' ? '0-0' : cursor, connId },
  });

  const heartbeat = setInterval(() => {
    if (!isClosed()) send({ t: 'ping' });
  }, 25_000);

  const registryBeat = setInterval(() => {
    if (!isClosed()) void tickets.heartbeatConnection(userId);
  }, 30_000);

  const blockRedis = redis.duplicate();
  try {
    while (!isClosed()) {
      try {
        const entries = await readLive(blockRedis, userId, cursor, 5000, 50);
        await pushEntries(entries, {
          send,
          notifBase,
          userId,
          serviceToken,
          setCursor: (id) => {
            cursor = id;
          },
        });
      } catch (err) {
        if (isClosed()) break;
        send({
          t: 'error',
          d: {
            code: 'stream_error',
            message: err instanceof Error ? err.message : 'read failed',
          },
        });
        await sleep(1000);
      }
    }
  } finally {
    clearInterval(heartbeat);
    clearInterval(registryBeat);
    try {
      blockRedis.disconnect();
    } catch {
      // ignore
    }
    try {
      await tickets.unregisterConnection(userId, connRef);
    } catch {
      // ignore
    }
  }
}

async function pushEntries(
  entries: Array<{
    streamId: string;
    notificationId: string;
    type: string;
    ts: string;
  }>,
  ctx: {
    send: (frame: RealtimeFrame) => void;
    notifBase: string;
    userId: string;
    serviceToken: string;
    setCursor: (id: string) => void;
  },
): Promise<void> {
  if (entries.length === 0) return;
  const ids = entries.map((e) => e.notificationId);
  const hydrated = await hydrateNotifications(
    ctx.notifBase,
    ctx.userId,
    ids,
    ctx.serviceToken || undefined,
  );
  for (const entry of entries) {
    const item = hydrated.get(entry.notificationId);
    ctx.send({
      t: 'notification',
      d: {
        id: entry.notificationId,
        type: entry.type,
        streamId: entry.streamId,
        ts: entry.ts,
        ...(item !== undefined ? { item } : {}),
      },
    });
    ctx.setCursor(entry.streamId);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
