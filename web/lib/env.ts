/**
 * Public environment accessors. Never expose secrets to the client.
 * @see docs/frontend/01-architecture.md §9 (platform layer)
 */

function readPublic(name: string, fallback: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return fallback;
  }
  return value;
}

export const env = {
  /** API gateway base URL used by the browser api-client. */
  apiBaseUrl: () =>
    readPublic('NEXT_PUBLIC_API_BASE_URL', 'http://127.0.0.1:3000'),
  /** Realtime gateway origin (WS). */
  realtimeBaseUrl: () =>
    readPublic('NEXT_PUBLIC_REALTIME_BASE_URL', 'http://127.0.0.1:3008'),
  isDev: () => process.env.NODE_ENV !== 'production',
};
