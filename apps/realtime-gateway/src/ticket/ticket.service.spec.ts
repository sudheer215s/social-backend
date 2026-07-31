import { ticketRedisKey } from './ticket.service';

describe('ticketRedisKey', () => {
  it('hashes the ticket (never stores raw secret as key)', () => {
    const a = ticketRedisKey('abc');
    const b = ticketRedisKey('abc');
    const c = ticketRedisKey('xyz');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith('rt:tk:')).toBe(true);
    expect(a.includes('abc')).toBe(false);
  });
});
