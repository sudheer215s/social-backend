import { HttpException } from '@nestjs/common';
import {
  fetchUpstream,
  resetUpstreamBreakers,
  upstreamHostKey,
  upstreamTimeoutMs,
} from './upstream';

describe('upstreamTimeoutMs', () => {
  it('defaults and clamps', () => {
    expect(upstreamTimeoutMs({})).toBe(5000);
    expect(upstreamTimeoutMs({ UPSTREAM_TIMEOUT_MS: '2500' })).toBe(2500);
    expect(upstreamTimeoutMs({ UPSTREAM_TIMEOUT_MS: '10' })).toBe(5000);
  });
});

describe('upstreamHostKey', () => {
  it('extracts host', () => {
    expect(upstreamHostKey('http://127.0.0.1:3001/v1/me')).toBe(
      '127.0.0.1:3001',
    );
  });
});

describe('fetchUpstream', () => {
  const original = global.fetch;

  afterEach(() => {
    global.fetch = original;
    resetUpstreamBreakers();
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

  it('opens circuit after repeated upstream 5xx and fails fast with 503', async () => {
    // Default policy: volumeThreshold 20, errorThreshold 0.5
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response('fail', { status: 503 }));

    for (let i = 0; i < 20; i++) {
      const res = await fetchUpstream('http://broken.test/y');
      expect(res.status).toBe(503);
    }

    try {
      await fetchUpstream('http://broken.test/y');
      fail('expected circuit open');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(503);
      const body = (e as HttpException).getResponse() as { detail?: string };
      expect(body.detail).toMatch(/circuit open/i);
    }
  });
});
