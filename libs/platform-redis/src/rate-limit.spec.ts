import { MemoryFixedWindowRateLimiter } from './rate-limit';

describe('MemoryFixedWindowRateLimiter', () => {
  it('allows up to limit then denies', async () => {
    const rl = new MemoryFixedWindowRateLimiter();
    const a = await rl.check('k', 2, 60);
    const b = await rl.check('k', 2, 60);
    const c = await rl.check('k', 2, 60);
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
    expect(c.allowed).toBe(false);
    expect(c.remaining).toBe(0);
  });
});
