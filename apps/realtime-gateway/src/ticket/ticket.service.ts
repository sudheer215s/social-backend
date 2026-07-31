import { createHash, randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

const TICKET_TTL_SECONDS = 30;
const MAX_CONNECTIONS_PER_USER = 5;

export interface TicketPayload {
  userId: string;
  sessionId: string | null;
}

export function ticketRedisKey(ticket: string): string {
  const hash = createHash('sha256').update(ticket).digest('hex');
  return `rt:tk:${hash}`;
}

export function userConnKey(userId: string): string {
  return `ws:u:${userId}`;
}

/**
 * Single-use realtime tickets (design: never put JWT in query strings).
 */
export class TicketService {
  constructor(
    private readonly redis: Redis,
    private readonly instanceId: string,
  ) {}

  async issue(userId: string, sessionId?: string | null): Promise<{
    ticket: string;
    expiresIn: number;
  }> {
    const ticket = randomBytes(32).toString('base64url');
    const key = ticketRedisKey(ticket);
    const payload: TicketPayload = {
      userId,
      sessionId: sessionId ?? null,
    };
    const ok = await this.redis.set(
      key,
      JSON.stringify(payload),
      'EX',
      TICKET_TTL_SECONDS,
      'NX',
    );
    if (ok !== 'OK') {
      throw new Error('ticket issue race');
    }
    return { ticket, expiresIn: TICKET_TTL_SECONDS };
  }

  /**
   * Atomic single-use consume (GETDEL). Returns null if missing/expired/reused.
   */
  async consume(ticket: string): Promise<TicketPayload | null> {
    if (!ticket || ticket.length < 16) return null;
    const key = ticketRedisKey(ticket);
    // GETDEL is Redis 6.2+
    const raw = (await this.redis.call('GETDEL', key)) as string | null;
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as TicketPayload;
      if (typeof parsed.userId !== 'string') return null;
      return {
        userId: parsed.userId,
        sessionId:
          typeof parsed.sessionId === 'string' ? parsed.sessionId : null,
      };
    } catch {
      return null;
    }
  }

  async registerConnection(
    userId: string,
    connId: string,
  ): Promise<{ connRef: string; evicted: string[] }> {
    const key = userConnKey(userId);
    const connRef = `${this.instanceId}:${connId}`;
    await this.redis.sadd(key, connRef);
    await this.redis.expire(key, 90);
    const members = await this.redis.smembers(key);
    const evicted: string[] = [];
    if (members.length > MAX_CONNECTIONS_PER_USER) {
      // Evict oldest by sorting instance:conn (connId is UUIDv-ish / timestamped)
      const sorted = [...members].sort();
      const extra = sorted.slice(0, members.length - MAX_CONNECTIONS_PER_USER);
      if (extra.length > 0) {
        await this.redis.srem(key, ...extra);
        evicted.push(...extra);
      }
    }
    return { connRef, evicted };
  }

  async heartbeatConnection(userId: string): Promise<void> {
    await this.redis.expire(userConnKey(userId), 90);
  }

  async unregisterConnection(userId: string, connRef: string): Promise<void> {
    await this.redis.srem(userConnKey(userId), connRef);
  }
}

export { MAX_CONNECTIONS_PER_USER, TICKET_TTL_SECONDS };
