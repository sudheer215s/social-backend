import type { RedisClient } from '@social/platform-redis';
import type { TicketService } from '../ticket/ticket.service';
import { runDeliverySession } from './delivery-session';
import type { RealtimeFrame } from './protocol';

describe('runDeliverySession session checks', () => {
  it('ends with session_revoked when sid is revoked', async () => {
    const frames: RealtimeFrame[] = [];
    let closed = false;
    const redis = {
      duplicate: () => ({
        call: async () => null,
        disconnect: () => undefined,
      }),
    } as unknown as RedisClient;
    const tickets = {
      heartbeatConnection: jest.fn(),
      unregisterConnection: jest.fn(),
    } as unknown as TicketService;

    const reason = await runDeliverySession({
      redis,
      tickets,
      userId: 'u1',
      connId: 'c1',
      connRef: 'i:c1',
      sessionId: 'sid-1',
      send: (f) => frames.push(f),
      isClosed: () => closed,
      onSessionEnd: () => {
        closed = true;
      },
      isSidRevoked: async () => true,
      sessionCheckMs: 0,
      maxAgeMs: 99_999_999,
      now: () => Date.now(),
    });

    expect(reason).toBe('session_revoked');
    expect(frames.some((f) => f.t === 'error' && f.d.code === 'session_revoked')).toBe(
      true,
    );
  });

  it('ends with reauthenticate when connection age exceeds max', async () => {
    let t = 0;
    let closed = false;
    const frames: RealtimeFrame[] = [];
    const redis = {
      duplicate: () => ({
        call: async () => null,
        disconnect: () => undefined,
      }),
    } as unknown as RedisClient;
    const tickets = {
      heartbeatConnection: jest.fn(),
      unregisterConnection: jest.fn(),
    } as unknown as TicketService;

    const reason = await runDeliverySession({
      redis,
      tickets,
      userId: 'u1',
      connId: 'c1',
      connRef: 'i:c1',
      sessionId: null,
      send: (f) => frames.push(f),
      isClosed: () => closed,
      onSessionEnd: () => {
        closed = true;
      },
      now: () => {
        const cur = t;
        t += 100;
        return cur;
      },
      maxAgeMs: 50,
      sessionCheckMs: 10_000,
    });

    expect(reason).toBe('reauthenticate');
    expect(
      frames.some((f) => f.t === 'error' && f.d.code === 'reauthenticate'),
    ).toBe(true);
  });
});
