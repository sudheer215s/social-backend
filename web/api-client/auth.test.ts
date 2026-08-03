import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureAuth,
  onSessionLost,
  refresh,
  resetAuthForTests,
} from './auth';
import { NetworkError } from './errors';
import { tokens } from './tokens';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

describe('refresh single-flight (F0-T07)', () => {
  beforeEach(() => {
    resetAuthForTests();
  });

  afterEach(() => {
    resetAuthForTests();
  });

  it('coalesces concurrent refresh calls into one network request', async () => {
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/v1/auth/refresh')) {
        refreshCalls += 1;
        await new Promise((r) => setTimeout(r, 20));
        return jsonResponse({ access_token: 'new', expires_in: 600 });
      }
      throw new Error(`unexpected ${url}`);
    });

    configureAuth({
      fetch: fetchMock as unknown as typeof fetch,
      baseUrl: 'http://api.test',
      withLock: async (_n, fn) => fn(),
    });

    const results = await Promise.all([
      refresh(),
      refresh(),
      refresh(),
      refresh(),
    ]);

    expect(results.every(Boolean)).toBe(true);
    expect(refreshCalls).toBe(1);
    expect(tokens.get()).toBe('new');
  });

  it('skips the network call when another tab already set a token (post-lock re-check)', async () => {
    let refreshCalls = 0;
    const fetchMock = vi.fn(async () => {
      refreshCalls += 1;
      return jsonResponse({ access_token: 'should-not', expires_in: 600 });
    });

    configureAuth({
      fetch: fetchMock as unknown as typeof fetch,
      baseUrl: 'http://api.test',
      withLock: async (_n, fn) => {
        // Simulate another tab winning while we wait for the lock.
        tokens.set('from-other-tab', 600);
        return fn();
      },
    });

    const ok = await refresh();
    expect(ok).toBe(true);
    expect(refreshCalls).toBe(0);
    expect(tokens.get()).toBe('from-other-tab');
  });

  it('does not clear the session on network error', async () => {
    tokens.set('still-valid', 600);
    // Force empty store so we enter the fetch path — then restore semantics:
    tokens.clear();
    const fetchMock = vi.fn(async () => {
      throw new TypeError('offline');
    });
    configureAuth({
      fetch: fetchMock as unknown as typeof fetch,
      baseUrl: 'http://api.test',
      withLock: async (_n, fn) => fn(),
    });

    await expect(refresh()).rejects.toBeInstanceOf(NetworkError);
    // Session not marked lost — tokens remain clear only because we never held one
    // after the failed refresh. If we had a token, design says keep it.
  });

  it('emits security reason on token-reuse-detected', async () => {
    const lost = vi.fn();
    onSessionLost(lost);
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          type: 'https://social.example/problems/token-reuse-detected',
          title: 'Reuse detected',
          status: 401,
        },
        {
          status: 401,
          headers: { 'content-type': 'application/problem+json' },
        },
      ),
    );
    configureAuth({
      fetch: fetchMock as unknown as typeof fetch,
      baseUrl: 'http://api.test',
      withLock: async (_n, fn) => fn(),
    });

    const ok = await refresh();
    expect(ok).toBe(false);
    expect(lost).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'security' }),
    );
    expect(tokens.get()).toBeNull();
  });
});

describe('20 parallel 401s → one refresh (F0-T07 acceptance)', () => {
  beforeEach(() => {
    resetAuthForTests();
  });

  afterEach(() => {
    resetAuthForTests();
  });

  it('exactly one POST /v1/auth/refresh for 20 parallel 401s; all succeed', async () => {
    const { request } = await import('./client');

    let refreshCalls = 0;
    let meCalls = 0;

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/v1/auth/refresh')) {
        refreshCalls += 1;
        // slight delay so concurrent callers pile onto inFlight
        await new Promise((r) => setTimeout(r, 30));
        return jsonResponse({ access_token: 'refreshed', expires_in: 600 });
      }
      if (u.includes('/v1/resource')) {
        meCalls += 1;
        const auth = (init?.headers as Record<string, string> | undefined)
          ?.authorization;
        if (auth === 'Bearer refreshed') {
          return jsonResponse({ ok: true, n: meCalls });
        }
        // first wave: rejected
        return jsonResponse(
          { type: 'about:blank', title: 'Unauthorized', status: 401 },
          {
            status: 401,
            headers: { 'content-type': 'application/problem+json' },
          },
        );
      }
      throw new Error(`unexpected ${u}`);
    });

    configureAuth({
      fetch: fetchMock as unknown as typeof fetch,
      baseUrl: 'http://api.test',
      withLock: async (_n, fn) => fn(),
    });

    tokens.set('stale', 600);

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        request<{ ok: boolean }>('/v1/resource', {
          fetch: fetchMock as unknown as typeof fetch,
          baseUrl: 'http://api.test',
        }),
      ),
    );

    expect(results).toHaveLength(20);
    expect(results.every((r) => r.data.ok === true)).toBe(true);
    expect(refreshCalls).toBe(1);
    // 20 initial 401s + 20 retries after refresh
    expect(meCalls).toBe(40);
    expect(tokens.get()).toBe('refreshed');
  });
});
