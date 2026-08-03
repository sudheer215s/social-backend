/**
 * Full-jitter backoff for idempotent retries.
 * @see docs/frontend/04-modules/api-client.md §3
 */

export const DEADLINES = {
  default: 10_000,
  timeline: 15_000,
  search: 8_000,
  auth: 10_000,
  mutation: 20_000,
} as const;

export type DeadlineKind = keyof typeof DEADLINES;

/** Full jitter: random in [0, base * 2^attempt]. */
export function backoffMs(
  attempt: number,
  baseMs = 200,
  maxMs = 2_000,
  random: () => number = Math.random,
): number {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.floor(random() * exp);
}

export function isIdempotentMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m === 'GET' || m === 'HEAD' || m === 'PUT' || m === 'DELETE';
}

/**
 * POST is only retried when an idempotency key is present.
 * 4xx (except 429) never retried; 5xx/network only when idempotent.
 */
export function shouldRetry(opts: {
  method: string;
  status: number | null; // null = network error
  hasIdempotencyKey: boolean;
  attempt: number;
  maxAttempts?: number;
}): boolean {
  const max = opts.maxAttempts ?? 2;
  if (opts.attempt >= max) return false;

  if (opts.status !== null) {
    if (opts.status === 429) return true;
    if (opts.status >= 400 && opts.status < 500) return false;
    if (opts.status < 500) return false;
  }

  const method = opts.method.toUpperCase();
  if (isIdempotentMethod(method)) return true;
  if (method === 'POST' && opts.hasIdempotencyKey) return true;
  return false;
}
