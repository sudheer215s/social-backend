import { afterEach, describe, expect, it, vi } from 'vitest';
import { degradation, extractSideChannel, rateLimit } from './headers';

describe('header side channel (F0-T06)', () => {
  afterEach(() => {
    degradation._reset();
    rateLimit._reset();
  });

  it('reports X-Degraded scopes', () => {
    const spy = vi.fn();
    degradation.subscribe(spy);
    const h = new Headers({
      'x-degraded': 'timeline-pull, post-hydration',
    });
    extractSideChannel(h);
    expect(spy).toHaveBeenCalledWith(['timeline-pull', 'post-hydration']);
  });

  it('observes RateLimit headers', () => {
    const spy = vi.fn();
    rateLimit.subscribe(spy);
    const h = new Headers({
      'ratelimit-remaining': '4',
      'ratelimit-reset': '1753900800',
      'ratelimit-limit': '100',
    });
    extractSideChannel(h, 'search');
    expect(spy).toHaveBeenCalledWith('search', {
      remaining: 4,
      reset: 1753900800,
      limit: 100,
    });
  });
});
