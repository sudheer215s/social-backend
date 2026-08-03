/**
 * Module-private access-token store (memory only — never localStorage).
 * @see docs/frontend/04-modules/api-client.md §4
 */

let accessToken: string | null = null;
/** Wall-clock expiry after applying the 5s safety margin. */
let expiresAt = 0;

const EXPIRY_SAFETY_MS = 5_000;
const PROACTIVE_REFRESH_MS = 60_000;

export const tokens = {
  get(): string | null {
    if (accessToken === null) return null;
    if (Date.now() >= expiresAt) return null;
    return accessToken;
  },

  /**
   * @param t access token
   * @param ttlSec server `expires_in` (seconds)
   */
  set(t: string, ttlSec: number): void {
    accessToken = t;
    expiresAt = Date.now() + ttlSec * 1000 - EXPIRY_SAFETY_MS;
  },

  clear(): void {
    accessToken = null;
    expiresAt = 0;
  },

  /**
   * True when a token is held, still valid, and will expire within 60s.
   * Callers should kick off a silent refresh before the next 401 storm.
   */
  needsProactiveRefresh(): boolean {
    if (accessToken === null) return false;
    if (Date.now() >= expiresAt) return false;
    return Date.now() > expiresAt - PROACTIVE_REFRESH_MS;
  },

  /** Test helper — raw expiry timestamp (after safety margin). */
  _expiresAt(): number {
    return expiresAt;
  },
};
