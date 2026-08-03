/**
 * Header side channel: X-Degraded and RateLimit-*.
 * @see docs/frontend/04-modules/api-client.md §8
 */

export type RateLimitSnapshot = {
  remaining: number | null;
  reset: number | null;
  limit: number | null;
};

export type DegradationListener = (scopes: string[]) => void;
export type RateLimitListener = (
  scope: string,
  snapshot: RateLimitSnapshot,
) => void;

const degradationListeners = new Set<DegradationListener>();
const rateLimitListeners = new Set<RateLimitListener>();

export const degradation = {
  subscribe(listener: DegradationListener): () => void {
    degradationListeners.add(listener);
    return () => {
      degradationListeners.delete(listener);
    };
  },
  report(scopes: string[]): void {
    if (scopes.length === 0) return;
    for (const l of degradationListeners) l(scopes);
  },
  /** Test helper */
  _reset(): void {
    degradationListeners.clear();
  },
};

export const rateLimit = {
  subscribe(listener: RateLimitListener): () => void {
    rateLimitListeners.add(listener);
    return () => {
      rateLimitListeners.delete(listener);
    };
  },
  observe(scope: string, snapshot: RateLimitSnapshot): void {
    for (const l of rateLimitListeners) l(scope, snapshot);
  },
  _reset(): void {
    rateLimitListeners.clear();
  },
};

export function extractSideChannel(res: Headers, scope = 'default'): void {
  const degraded = res.get('x-degraded');
  if (degraded) {
    const scopes = degraded
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    degradation.report(scopes);
  }

  const remaining = parseOptionalInt(res.get('ratelimit-remaining'));
  const reset = parseOptionalInt(res.get('ratelimit-reset'));
  const limit = parseOptionalInt(res.get('ratelimit-limit'));
  if (remaining !== null || reset !== null || limit !== null) {
    rateLimit.observe(scope, { remaining, reset, limit });
  }
}

function parseOptionalInt(value: string | null): number | null {
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
