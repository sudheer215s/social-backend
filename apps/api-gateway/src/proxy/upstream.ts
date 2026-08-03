import { HttpException, HttpStatus } from '@nestjs/common';

export function upstreamTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const n = Number(env.UPSTREAM_TIMEOUT_MS ?? 5000);
  return Number.isFinite(n) && n >= 100 ? Math.min(n, 60_000) : 5000;
}

/**
 * fetch with a hard deadline (design: ~5s edge budget).
 * Maps timeout/network failures to 504/502 problem-friendly HttpExceptions.
 */
export async function fetchUpstream(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const ms = upstreamTimeoutMs();
  try {
    return await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(ms),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new HttpException(
        {
          type: 'about:blank',
          title: 'Gateway Timeout',
          status: 504,
          detail: `Upstream timed out after ${ms}ms`,
        },
        HttpStatus.GATEWAY_TIMEOUT,
      );
    }
    throw new HttpException(
      {
        type: 'about:blank',
        title: 'Bad Gateway',
        status: 502,
        detail: 'Upstream request failed',
      },
      HttpStatus.BAD_GATEWAY,
    );
  }
}
