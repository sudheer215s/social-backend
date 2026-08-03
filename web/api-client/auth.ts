/**
 * Single-flight refresh with cross-tab coordination.
 * @see docs/frontend/04-modules/api-client.md §5
 * @see docs/frontend/03-flows.md §4
 */

import { apiErrorFromResponse, type ApiError, NetworkError } from './errors';
import { tokens } from './tokens';

export type SessionLostReason = 'expired' | 'security' | 'unknown';

export type SessionLostDetail = {
  reason: SessionLostReason;
  problemType?: string;
};

type SessionLostListener = (detail: SessionLostDetail) => void;

let inFlight: Promise<boolean> | null = null;
const sessionLostListeners = new Set<SessionLostListener>();

/** Injected fetch for tests; defaults to global fetch. */
let fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args);

/** Optional lock + broadcast for cross-tab (injected in tests). */
export type AuthDeps = {
  fetch?: typeof fetch;
  withLock?: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  broadcast?: (msg: { type: string }) => void;
  baseUrl?: string;
  onSessionLost?: SessionLostListener;
};

let deps: Required<Pick<AuthDeps, 'withLock' | 'broadcast' | 'baseUrl'>> & {
  fetch: typeof fetch;
} = {
  fetch: fetchImpl,
  withLock: defaultWithLock,
  broadcast: defaultBroadcast,
  baseUrl: '',
};

export function configureAuth(next: AuthDeps): void {
  if (next.fetch) {
    fetchImpl = next.fetch;
    deps.fetch = next.fetch;
  }
  if (next.withLock) deps.withLock = next.withLock;
  if (next.broadcast) deps.broadcast = next.broadcast;
  if (next.baseUrl !== undefined) deps.baseUrl = next.baseUrl;
  if (next.onSessionLost) {
    sessionLostListeners.add(next.onSessionLost);
  }
}

export function resetAuthForTests(): void {
  inFlight = null;
  sessionLostListeners.clear();
  fetchImpl = (...args) => globalThis.fetch(...args);
  deps = {
    fetch: fetchImpl,
    withLock: defaultWithLock,
    broadcast: defaultBroadcast,
    baseUrl: '',
  };
  tokens.clear();
}

export function onSessionLost(listener: SessionLostListener): () => void {
  sessionLostListeners.add(listener);
  return () => {
    sessionLostListeners.delete(listener);
  };
}

export async function refresh(): Promise<boolean> {
  if (inFlight) return inFlight;
  inFlight = doRefresh().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doRefresh(): Promise<boolean> {
  return deps.withLock('auth-refresh', async () => {
    // Another tab may have finished while we waited for the lock.
    if (tokens.get()) return true;

    let res: Response;
    try {
      res = await deps.fetch(`${deps.baseUrl}/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
    } catch {
      // Network failure must NOT clear the session.
      throw new NetworkError('Refresh request failed');
    }

    if (res.status === 401) {
      const err = await apiErrorFromResponse(res);
      emitSessionLost(err);
      return false;
    }

    if (!res.ok) {
      // Transient server error — do not log out.
      throw new NetworkError(`Refresh failed with HTTP ${res.status}`);
    }

    const body: unknown = await res.json();
    const access =
      body &&
      typeof body === 'object' &&
      typeof (body as { access_token?: unknown }).access_token === 'string'
        ? (body as { access_token: string }).access_token
        : null;
    const expiresIn =
      body &&
      typeof body === 'object' &&
      typeof (body as { expires_in?: unknown }).expires_in === 'number'
        ? (body as { expires_in: number }).expires_in
        : 600;

    if (!access) {
      throw new NetworkError('Refresh response missing access_token');
    }

    tokens.set(access, expiresIn);
    deps.broadcast({ type: 'token-refreshed' });
    return true;
  });
}

function emitSessionLost(err: ApiError): void {
  tokens.clear();
  const type = err.problem.type ?? '';
  const reason: SessionLostReason = type.includes('token-reuse-detected')
    ? 'security'
    : type
      ? 'expired'
      : 'unknown';
  const detail: SessionLostDetail = {
    reason,
    ...(type ? { problemType: type } : {}),
  };
  for (const l of sessionLostListeners) l(detail);
}

async function defaultWithLock<T>(
  _name: string,
  fn: () => Promise<T>,
): Promise<T> {
  // Prefer Web Locks API when available (browsers).
  const locks = (
    globalThis as unknown as {
      navigator?: {
        locks?: {
          request: (name: string, callback: () => Promise<T>) => Promise<T>;
        };
      };
    }
  ).navigator?.locks;

  if (locks && typeof locks.request === 'function') {
    return locks.request('auth-refresh', () => fn());
  }
  // Fallback: no cross-tab lock (single-tab single-flight still applies).
  return fn();
}

function defaultBroadcast(msg: { type: string }): void {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel('auth');
      ch.postMessage(msg);
      ch.close();
    }
  } catch {
    // ignore
  }
}
