/**
 * Typed fetch pipeline — the only module permitted to call fetch.
 * @see docs/frontend/04-modules/api-client.md §3
 */

import { refresh } from './auth';
import { NetworkError, TimeoutError, apiErrorFromResponse } from './errors';
import { extractSideChannel } from './headers';
import { DEADLINES, backoffMs, shouldRetry, type DeadlineKind } from './retry';
import { tokens } from './tokens';

export type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Intent-scoped key; never generated here. */
  idempotencyKey?: string;
  deadline?: number | DeadlineKind;
  /** Public endpoints skip Authorization. */
  public?: boolean;
  /** Skip the single 401→refresh→retry cycle. */
  skipAuthRefresh?: boolean;
  signal?: AbortSignal;
  /** Rate-limit observation scope. */
  rateLimitScope?: string;
  /** Override base URL (tests). */
  baseUrl?: string;
  /** Injected fetch (tests). */
  fetch?: typeof fetch;
};

export type RequestResult<T> = {
  data: T;
  response: Response;
};

function resolveDeadline(d: RequestOptions['deadline']): number {
  if (d === undefined) return DEADLINES.default;
  if (typeof d === 'number') return d;
  return DEADLINES[d];
}

/**
 * jsdom installs its own `AbortSignal`, which then fails the `instanceof` brand
 * check inside undici's fetch — the request is rejected before it is ever sent.
 * Probe the Request/AbortSignal pairing (same webidl conversion, no network)
 * and fall back to {@link abortRace} when the two realms do not match.
 */
let signalProbe: { request: unknown; signal: unknown; ok: boolean } | null =
  null;

function canForwardSignal(signal: AbortSignal): boolean {
  if (typeof Request !== 'function') return false;
  const signalCtor = signal.constructor;
  if (
    signalProbe &&
    signalProbe.request === Request &&
    signalProbe.signal === signalCtor
  ) {
    return signalProbe.ok;
  }
  let ok = true;
  try {
    void new Request('http://localhost/', { signal });
  } catch {
    ok = false;
  }
  signalProbe = { request: Request, signal: signalCtor, ok };
  return ok;
}

/**
 * Caller cancellation for realms where the signal cannot reach fetch. The
 * socket stays open until the response arrives, but the caller's promise
 * rejects on abort exactly as it would with a forwarded signal.
 */
function abortRace(signal: AbortSignal): {
  promise: Promise<never>;
  release: () => void;
} {
  let onAbort: (() => void) | undefined;
  const promise = new Promise<never>((_resolve, reject) => {
    const fail = () => reject(new NetworkError('aborted'));
    if (signal.aborted) {
      fail();
      return;
    }
    onAbort = fail;
    signal.addEventListener('abort', fail, { once: true });
  });
  return {
    promise,
    release: () => {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    },
  };
}

function resolveBaseUrl(override?: string): string {
  if (override !== undefined) return override.replace(/\/$/, '');
  const fromEnv =
    typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_API_BASE_URL
      : undefined;
  return (fromEnv ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
}

/**
 * Core request helper.
 * On 401 (authenticated calls): single-flight refresh, then retry once.
 */
export async function request<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<RequestResult<T>> {
  const method = (options.method ?? 'GET').toUpperCase();
  const baseUrl = resolveBaseUrl(options.baseUrl);
  const url = path.startsWith('http')
    ? path
    : `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  const deadlineMs = resolveDeadline(options.deadline);
  const hasIdempotencyKey = Boolean(options.idempotencyKey);

  let attempt = 0;
  let didRefreshRetry = false;

  for (;;) {
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...options.headers,
    };

    if (!options.public) {
      const token = tokens.get();
      if (token) headers.authorization = `Bearer ${token}`;
    }

    if (options.idempotencyKey) {
      headers['idempotency-key'] = options.idempotencyKey;
    }

    let body: BodyInit | undefined;
    if (options.body !== undefined) {
      headers['content-type'] = headers['content-type'] ?? 'application/json';
      body =
        typeof options.body === 'string'
          ? options.body
          : JSON.stringify(options.body);
    }

    let res: Response;
    let timedOut = false;
    let abort: ReturnType<typeof abortRace> | undefined;
    try {
      const init: RequestInit = {
        method,
        headers,
        credentials: options.public ? 'omit' : 'include',
      };
      // Only forward caller AbortSignal when fetch's realm will accept it.
      // Deadlines use Promise.race so jsdom + MSW undici do not fight over
      // AbortSignal instanceof checks.
      if (options.signal) {
        if (canForwardSignal(options.signal)) {
          init.signal = options.signal;
        } else {
          abort = abortRace(options.signal);
        }
      }
      if (body !== undefined) {
        init.body = body;
      }

      res = await Promise.race([
        fetchFn(url, init),
        sleep(deadlineMs).then(() => {
          timedOut = true;
          throw new TimeoutError();
        }),
        ...(abort ? [abort.promise] : []),
      ]);
    } catch (err) {
      if (err instanceof TimeoutError || timedOut) {
        throw new TimeoutError();
      }
      if (options.signal?.aborted) {
        throw err instanceof Error ? err : new NetworkError('aborted');
      }
      if (
        shouldRetry({
          method,
          status: null,
          hasIdempotencyKey,
          attempt,
        })
      ) {
        attempt += 1;
        await sleep(backoffMs(attempt));
        continue;
      }
      throw err instanceof NetworkError
        ? err
        : new NetworkError(err instanceof Error ? err.message : 'fetch failed');
    } finally {
      abort?.release();
    }

    extractSideChannel(res.headers, options.rateLimitScope ?? path);

    if (
      res.status === 401 &&
      !options.public &&
      !options.skipAuthRefresh &&
      !didRefreshRetry
    ) {
      didRefreshRetry = true;
      // Drop the rejected access token so the post-lock re-check only
      // succeeds when another tab has already installed a *new* token.
      tokens.clear();
      const ok = await refresh();
      if (ok) {
        continue;
      }
      // refresh returned false → session lost; surface as ApiError
      throw await apiErrorFromResponse(res);
    }

    if (!res.ok) {
      if (
        shouldRetry({
          method,
          status: res.status,
          hasIdempotencyKey,
          attempt,
        })
      ) {
        attempt += 1;
        const retryAfter = res.headers.get('retry-after');
        if (res.status === 429 && retryAfter) {
          const sec = Number(retryAfter);
          await sleep(Number.isFinite(sec) ? sec * 1000 : backoffMs(attempt));
        } else {
          await sleep(backoffMs(attempt));
        }
        continue;
      }
      throw await apiErrorFromResponse(res);
    }

    if (res.status === 204) {
      return { data: undefined as T, response: res };
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const data = (await res.json()) as T;
      return { data, response: res };
    }

    const text = await res.text();
    return { data: text as T, response: res };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { DEADLINES };
