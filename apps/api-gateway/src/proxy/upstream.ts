import { HttpException, HttpStatus } from '@nestjs/common';
import {
  CircuitBreakerRegistry,
  CircuitOpenError,
  resolveGrpcClientOptions,
} from '@social/platform-grpc';

const defaultBreakerPolicy = resolveGrpcClientOptions().breaker;

/** Shared per-host breakers for upstream HTTP (identity, post, graph, …). */
const upstreamBreakers = new CircuitBreakerRegistry(defaultBreakerPolicy);

export function upstreamTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const n = Number(env.UPSTREAM_TIMEOUT_MS ?? 5000);
  return Number.isFinite(n) && n >= 100 ? Math.min(n, 60_000) : 5000;
}

/** Host key for breaker isolation (falls back to full URL on parse failure). */
export function upstreamHostKey(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

export function getUpstreamBreakers(): CircuitBreakerRegistry {
  return upstreamBreakers;
}

/** Reset all breakers (unit tests). */
export function resetUpstreamBreakers(): void {
  upstreamBreakers.resetAll();
}

/**
 * fetch with a hard deadline (design: ~5s edge budget) and per-host circuit breaker.
 * Maps timeout/network failures to 504/502; open breaker → 503.
 * Upstream 5xx counts as a breaker failure while still returning the response.
 */
export async function fetchUpstream(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const ms = upstreamTimeoutMs();
  const breaker = upstreamBreakers.get(upstreamHostKey(url));

  try {
    breaker.tryEnter();
  } catch (err) {
    if (err instanceof CircuitOpenError) {
      const retrySec = Math.max(1, Math.ceil(err.retryAfterMs / 1000));
      throw new HttpException(
        {
          type: 'about:blank',
          title: 'Service Unavailable',
          status: 503,
          detail: `Upstream circuit open for ${err.circuitName}`,
          retryAfter: retrySec,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    throw err;
  }

  try {
    const res = await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(ms),
    });
    if (res.status >= 500) {
      breaker.onFailure();
    } else {
      breaker.onSuccess();
    }
    return res;
  } catch (err) {
    breaker.onFailure();
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
