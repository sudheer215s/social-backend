'use client';

/**
 * Session network operations — features call these, never api-client.
 */
import {
  configureAuth,
  onSessionLost,
  refresh,
  NetworkError,
  type SessionLostDetail,
} from '@/api-client';
import { env } from '@/lib/env';

let configured = false;

export function ensureAuthConfigured(): void {
  if (configured) return;
  configured = true;
  configureAuth({ baseUrl: env.apiBaseUrl() });
}

export function subscribeSessionLost(
  listener: (detail: SessionLostDetail) => void,
): () => void {
  ensureAuthConfigured();
  return onSessionLost(listener);
}

export type SilentRefreshResult = 'ok' | 'unauthorized' | 'network';

/** Cookie-based silent refresh for cold boot. */
export async function silentRefresh(): Promise<SilentRefreshResult> {
  ensureAuthConfigured();
  try {
    const ok = await refresh();
    return ok ? 'ok' : 'unauthorized';
  } catch (err) {
    if (err instanceof NetworkError) return 'network';
    return 'network';
  }
}

export function resetSessionApiForTests(): void {
  configured = false;
}
