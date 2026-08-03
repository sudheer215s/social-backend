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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), deadlineMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort);

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
    try {
      const init: RequestInit = {
        method,
        headers,
        credentials: options.public ? 'omit' : 'include',
        signal: controller.signal,
      };
      if (body !== undefined) {
        init.body = body;
      }
      res = await fetchFn(url, init);
    } catch (err) {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);

      if (controller.signal.aborted && !options.signal?.aborted) {
        throw new TimeoutError();
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
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
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
