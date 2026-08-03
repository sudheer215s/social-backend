/**
 * Session state machine — pure reducer.
 * @see docs/frontend/03-flows.md §1
 */

export type SessionStatus =
  | 'unknown'
  | 'bootstrapping'
  | 'anonymous'
  | 'authenticating'
  | 'authenticated'
  | 'refreshing'
  | 'offline';

export type SessionLostReason = 'expired' | 'security' | 'unknown';

export type SessionContext = {
  status: SessionStatus;
  /** Set when transitioning to anonymous from a failed refresh/logout. */
  lostReason?: SessionLostReason;
};

export type SessionEvent =
  | { type: 'APP_MOUNT' }
  | { type: 'REFRESH_OK' }
  | { type: 'REFRESH_UNAUTHORIZED'; reason?: SessionLostReason }
  | { type: 'NETWORK_ERROR' }
  | { type: 'SUBMIT_LOGIN' }
  | { type: 'LOGIN_OK' }
  | { type: 'LOGIN_FAIL' }
  | { type: 'ACCESS_EXPIRED' }
  | { type: 'LOGOUT' }
  | { type: 'RECONNECT' };

export const initialSession: SessionContext = { status: 'unknown' };

/**
 * Transition the session machine. Illegal events leave state unchanged
 * (and are easy to assert in tests).
 */
export function sessionReduce(
  ctx: SessionContext,
  event: SessionEvent,
): SessionContext {
  const { status } = ctx;

  switch (event.type) {
    case 'APP_MOUNT':
      if (status === 'unknown') return { status: 'bootstrapping' };
      return ctx;

    case 'REFRESH_OK':
      if (status === 'bootstrapping' || status === 'refreshing') {
        return { status: 'authenticated' };
      }
      return ctx;

    case 'REFRESH_UNAUTHORIZED':
      if (status === 'bootstrapping' || status === 'refreshing') {
        return {
          status: 'anonymous',
          lostReason: event.reason ?? 'expired',
        };
      }
      return ctx;

    case 'NETWORK_ERROR':
      if (status === 'bootstrapping') return { status: 'offline' };
      // Network error during refresh must not log out (api-client contract).
      if (status === 'refreshing') return { status: 'authenticated' };
      return ctx;

    case 'SUBMIT_LOGIN':
      if (status === 'anonymous') return { status: 'authenticating' };
      return ctx;

    case 'LOGIN_OK':
      if (status === 'authenticating') return { status: 'authenticated' };
      return ctx;

    case 'LOGIN_FAIL':
      if (status === 'authenticating') return { status: 'anonymous' };
      return ctx;

    case 'ACCESS_EXPIRED':
      if (status === 'authenticated') return { status: 'refreshing' };
      return ctx;

    case 'LOGOUT':
      if (status === 'authenticated' || status === 'refreshing') {
        return { status: 'anonymous' };
      }
      return ctx;

    case 'RECONNECT':
      if (status === 'offline') return { status: 'bootstrapping' };
      return ctx;

    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

/** Whether authenticated chrome / private routes are allowed. */
export function isAuthenticatedStatus(status: SessionStatus): boolean {
  return status === 'authenticated' || status === 'refreshing';
}

/** Whether boot is still resolving (no auth flash). */
export function isResolvingStatus(status: SessionStatus): boolean {
  return status === 'unknown' || status === 'bootstrapping';
}
