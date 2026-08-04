import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureAuth, resetAuthForTests } from './auth';
import { request } from './client';
import { ApiError, NetworkError } from './errors';
import { degradation } from './headers';
import { tokens } from './tokens';

function jsonResponse(
  body: unknown,
  init: ResponseInit & { headers?: Record<string, string> } = {},
): Response {
  const headers = {
    'content-type': 'application/json',
    ...(init.headers ?? {}),
  };
  return new Response(JSON.stringify(body), { ...init, headers });
}

describe('request pipeline (F0-T06)', () => {
  beforeEach(() => {
    resetAuthForTests();
    tokens.clear();
    degradation._reset();
  });

  afterEach(() => {
    resetAuthForTests();
    tokens.clear();
    vi.unstubAllGlobals();
  });

  it('attaches Authorization when a token is present', async () => {
    tokens.set('tok-1', 600);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    await request('/v1/me', { fetch: fetchMock, baseUrl: 'http://api.test' });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer tok-1',
    );
  });

  it('attaches Idempotency-Key when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'p1' }));
    await request('/v1/posts', {
      method: 'POST',
      body: { text: 'hi' },
      idempotencyKey: 'intent-1',
      fetch: fetchMock,
      baseUrl: 'http://api.test',
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['idempotency-key']).toBe(
      'intent-1',
    );
  });

  it('surfaces X-Degraded via the side channel', async () => {
    const spy = vi.fn();
    degradation.subscribe(spy);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { items: [] },
          { headers: { 'x-degraded': 'timeline-pull' } },
        ),
      );
    await request('/v1/timelines/home', {
      fetch: fetchMock,
      baseUrl: 'http://api.test',
      public: true,
    });
    expect(spy).toHaveBeenCalledWith(['timeline-pull']);
  });

  it('retries GET on 503 then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ title: 'down' }, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.useFakeTimers();
    const p = request('/v1/me', {
      fetch: fetchMock,
      baseUrl: 'http://api.test',
      public: true,
    });
    await vi.runAllTimersAsync();
    const result = await p;
    vi.useRealTimers();
    expect(result.data).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // React Query hands every queryFn an AbortSignal minted by whichever realm
  // owns the global — under jsdom that is not the one undici's fetch checks.
  describe('caller AbortSignal', () => {
    /** Stands in for a fetch realm that accepts (or rejects) foreign signals. */
    function stubRequest(accepts: boolean) {
      vi.stubGlobal(
        'Request',
        class StubRequest {
          constructor(_url: string, init?: { signal?: unknown }) {
            if (init?.signal && !accepts) {
              throw new TypeError(
                'Expected signal ("AbortSignal {}") to be an instance of AbortSignal.',
              );
            }
          }
        },
      );
    }

    it('forwards the signal when fetch would accept it', async () => {
      stubRequest(true);
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
      const controller = new AbortController();

      await request('/v1/me', {
        fetch: fetchMock,
        baseUrl: 'http://api.test',
        public: true,
        signal: controller.signal,
      });

      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(init.signal).toBe(controller.signal);
    });

    it('completes the request when the signal cannot cross realms', async () => {
      stubRequest(false);
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
      const controller = new AbortController();

      const result = await request('/v1/me', {
        fetch: fetchMock,
        baseUrl: 'http://api.test',
        public: true,
        signal: controller.signal,
      });

      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(init.signal).toBeUndefined();
      expect(result.data).toEqual({ ok: true });
    });

    it('still rejects on abort when the signal was not forwarded', async () => {
      stubRequest(false);
      const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}));
      const controller = new AbortController();

      const pending = request('/v1/me', {
        fetch: fetchMock as unknown as typeof fetch,
        baseUrl: 'http://api.test',
        public: true,
        signal: controller.signal,
      });
      controller.abort();

      await expect(pending).rejects.toBeInstanceOf(NetworkError);
    });

    it('rejects immediately when handed an already-aborted signal', async () => {
      stubRequest(false);
      const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}));
      const controller = new AbortController();
      controller.abort();

      await expect(
        request('/v1/me', {
          fetch: fetchMock as unknown as typeof fetch,
          baseUrl: 'http://api.test',
          public: true,
          signal: controller.signal,
        }),
      ).rejects.toBeInstanceOf(NetworkError);
    });
  });

  it('does not retry POST without idempotency key on 503', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ title: 'down' }, { status: 503 }));
    await expect(
      request('/v1/posts', {
        method: 'POST',
        body: { text: 'x' },
        fetch: fetchMock,
        baseUrl: 'http://api.test',
        public: true,
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws NetworkError when fetch throws', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'));
    await expect(
      request('/v1/me', {
        fetch: fetchMock,
        baseUrl: 'http://api.test',
        public: true,
      }),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('refreshes once on 401 then retries the original request', async () => {
    tokens.set('expired', 600);
    let meHits = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/v1/auth/refresh')) {
        return jsonResponse({ access_token: 'new-tok', expires_in: 600 });
      }
      if (url.includes('/v1/me')) {
        meHits += 1;
        if (meHits === 1) {
          return jsonResponse({ title: 'unauthorized' }, { status: 401 });
        }
        return jsonResponse({ id: 'u1' });
      }
      return jsonResponse({}, { status: 404 });
    });

    configureAuth({
      fetch: fetchMock as unknown as typeof fetch,
      baseUrl: 'http://api.test',
      withLock: async (_n, fn) => fn(),
    });

    const result = await request('/v1/me', {
      fetch: fetchMock as unknown as typeof fetch,
      baseUrl: 'http://api.test',
    });
    expect(result.data).toEqual({ id: 'u1' });
    expect(tokens.get()).toBe('new-tok');
  });
});
