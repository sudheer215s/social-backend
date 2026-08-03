import { HttpException } from '@nestjs/common';
import { fetchUpstream, upstreamTimeoutMs } from './upstream';

describe('upstreamTimeoutMs', () => {
  it('defaults and clamps', () => {
    expect(upstreamTimeoutMs({})).toBe(5000);
    expect(upstreamTimeoutMs({ UPSTREAM_TIMEOUT_MS: '2500' })).toBe(2500);
    expect(upstreamTimeoutMs({ UPSTREAM_TIMEOUT_MS: '10' })).toBe(5000);
  });
});

describe('fetchUpstream', () => {
  const original = global.fetch;

  afterEach(() => {
    global.fetch = original;
  });

  it('returns successful responses', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    const res = await fetchUpstream('http://example.test/x');
    expect(res.status).toBe(200);
  });

  it('maps abort/timeout to 504', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('aborted'), { name: 'TimeoutError' }),
      );
    await expect(fetchUpstream('http://example.test/x')).rejects.toBeInstanceOf(
      HttpException,
    );
    try {
      await fetchUpstream('http://example.test/x');
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(504);
    }
  });
});
