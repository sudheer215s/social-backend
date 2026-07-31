import { createRedisClient } from '@social/platform-redis';
import { TicketService } from './ticket.service';

describe('TicketService (integration)', () => {
  const redis = createRedisClient(
    process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  );
  let available = false;
  let tickets: TicketService;

  beforeAll(async () => {
    try {
      await redis.ping();
      tickets = new TicketService(redis, 'test-inst');
      available = true;
    } catch (err) {
      console.warn('Skipping ticket integration', err);
    }
  });

  afterAll(() => {
    redis.disconnect();
  });

  it('issues single-use tickets', async () => {
    if (!available) return;
    const { ticket, expiresIn } = await tickets.issue('user-1', 'sid-1');
    expect(expiresIn).toBe(30);
    const first = await tickets.consume(ticket);
    expect(first?.userId).toBe('user-1');
    expect(first?.sessionId).toBe('sid-1');
    const second = await tickets.consume(ticket);
    expect(second).toBeNull();
  });

  it('evicts oldest connections beyond limit', async () => {
    if (!available) return;
    const userId = `u-limit-${Date.now()}`;
    const refs: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await tickets.registerConnection(userId, `c${i}`);
      refs.push(r.connRef);
      if (i === 5) {
        expect(r.evicted.length).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
