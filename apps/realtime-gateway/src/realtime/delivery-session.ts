import type { RedisClient } from '@social/platform-redis';
import { RedisSidRevocationStore } from '@social/platform-redis';
import type { TicketService } from '../ticket/ticket.service';
import { hydrateNotifications } from '../stream/hydrate';
import { readCatchUp, readLive } from '../stream/notification-stream';
import type { RealtimeFrame } from './protocol';

/** Design: check sid every 60s; force reauth after 12h. */
export const SESSION_CHECK_MS = 60_000;
export const MAX_CONNECTION_AGE_MS = 12 * 60 * 60 * 1000;

export type SessionEndReason =
  'client_closed' | 'session_revoked' | 'reauthenticate' | 'error';

export interface DeliverySessionOptions {
  redis: RedisClient;
  tickets: TicketService;
  userId: string;
  connId: string;
  connRef: string;
  sessionId?: string | null;
  since?: string;
  send: (frame: RealtimeFrame) => void;
  isClosed: () => boolean;
  /** Called when the session should end (e.g. close WS with 4403). */
  onSessionEnd?: (reason: SessionEndReason) => void;
  notificationBaseUrl?: string;
  serviceToken?: string;
  /** Emit connection_limit error if true */
  evicted?: boolean;
  now?: () => number;
  /** Inject for tests */
  isSidRevoked?: (sid: string) => Promise<boolean>;
  sessionCheckMs?: number;
  maxAgeMs?: number;
}

/**
 * Shared delivery loop for SSE and WebSocket:
 * catch-up → ready → XREAD BLOCK → optional hydrate → push.
 * Periodically checks session revocation and max connection age (review F9).
 */
export async function runDeliverySession(
  options: DeliverySessionOptions,
): Promise<SessionEndReason> {
  const { redis, tickets, userId, connId, connRef, send, isClosed } = options;
  const now = options.now ?? (() => Date.now());
  const startedAt = now();
  const sessionCheckMs = options.sessionCheckMs ?? SESSION_CHECK_MS;
  const maxAgeMs = options.maxAgeMs ?? MAX_CONNECTION_AGE_MS;
  const sessionId = options.sessionId ?? null;

  const revocation =
    options.isSidRevoked ??
    ((sid: string) => new RedisSidRevocationStore(redis).isRevoked(sid));

  const notifBase =
    options.notificationBaseUrl ??
    process.env.NOTIFICATION_BASE_URL ??
    'http://127.0.0.1:3005';
  const serviceToken =
    options.serviceToken ?? process.env.REALTIME_SERVICE_TOKEN ?? '';

  let cursor = options.since && options.since !== '$' ? options.since : '$';
  let endReason: SessionEndReason = 'client_closed';

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

  let lastSessionCheck = 0;
  const checkSession = async (): Promise<SessionEndReason | null> => {
    if (now() - startedAt > maxAgeMs) {
      send({
        t: 'error',
        d: {
          code: 'reauthenticate',
          message: 'connection age exceeded; obtain a fresh ticket',
        },
      });
      return 'reauthenticate';
    }
    if (sessionId && now() - lastSessionCheck >= sessionCheckMs) {
      lastSessionCheck = now();
      if (await revocation(sessionId)) {
        send({
          t: 'error',
          d: {
            code: 'session_revoked',
            message: 'session revoked',
          },
        });
        return 'session_revoked';
      }
    }
    return null;
  };

  const blockRedis = redis.duplicate();
  try {
    // Immediate check at connect
    const initial = await checkSession();
    if (initial) {
      endReason = initial;
      options.onSessionEnd?.(initial);
      return endReason;
    }

    while (!isClosed()) {
      const sessionEnd = await checkSession();
      if (sessionEnd) {
        endReason = sessionEnd;
        options.onSessionEnd?.(sessionEnd);
        break;
      }
      if (isClosed()) break;

      try {
        const entries = await readLive(blockRedis, userId, cursor, 5000, 50);
        if (isClosed()) break;
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

  if (endReason === 'client_closed' && !isClosed()) {
    endReason = 'error';
  }
  return endReason;
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
