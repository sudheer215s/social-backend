import { describe, expect, it } from 'vitest';
import {
  initialSession,
  isAuthenticatedStatus,
  isResolvingStatus,
  sessionReduce,
  type SessionContext,
  type SessionEvent,
} from './session-machine';

function apply(
  events: SessionEvent[],
  start: SessionContext = initialSession,
): SessionContext {
  return events.reduce(sessionReduce, start);
}

describe('session machine (F1-T01)', () => {
  it('starts unknown', () => {
    expect(initialSession.status).toBe('unknown');
    expect(isResolvingStatus('unknown')).toBe(true);
  });

  it('Unknown → Bootstrapping on APP_MOUNT', () => {
    expect(apply([{ type: 'APP_MOUNT' }]).status).toBe('bootstrapping');
  });

  it('Bootstrapping → Authenticated on REFRESH_OK', () => {
    expect(apply([{ type: 'APP_MOUNT' }, { type: 'REFRESH_OK' }]).status).toBe(
      'authenticated',
    );
  });

  it('Bootstrapping → Anonymous on REFRESH_UNAUTHORIZED', () => {
    const ctx = apply([
      { type: 'APP_MOUNT' },
      { type: 'REFRESH_UNAUTHORIZED', reason: 'expired' },
    ]);
    expect(ctx.status).toBe('anonymous');
    expect(ctx.lostReason).toBe('expired');
  });

  it('Bootstrapping → Offline on NETWORK_ERROR', () => {
    expect(
      apply([{ type: 'APP_MOUNT' }, { type: 'NETWORK_ERROR' }]).status,
    ).toBe('offline');
  });

  it('Anonymous → Authenticating → Authenticated on login success', () => {
    const ctx = apply([
      { type: 'APP_MOUNT' },
      { type: 'REFRESH_UNAUTHORIZED' },
      { type: 'SUBMIT_LOGIN' },
      { type: 'LOGIN_OK' },
    ]);
    expect(ctx.status).toBe('authenticated');
  });

  it('Authenticating → Anonymous on LOGIN_FAIL', () => {
    const ctx = apply([
      { type: 'APP_MOUNT' },
      { type: 'REFRESH_UNAUTHORIZED' },
      { type: 'SUBMIT_LOGIN' },
      { type: 'LOGIN_FAIL' },
    ]);
    expect(ctx.status).toBe('anonymous');
  });

  it('Authenticated → Refreshing → Authenticated on silent refresh', () => {
    const ctx = apply([
      { type: 'APP_MOUNT' },
      { type: 'REFRESH_OK' },
      { type: 'ACCESS_EXPIRED' },
      { type: 'REFRESH_OK' },
    ]);
    expect(ctx.status).toBe('authenticated');
    expect(isAuthenticatedStatus('refreshing')).toBe(true);
  });

  it('Refreshing → Anonymous on REFRESH_UNAUTHORIZED (reuse/expired)', () => {
    const ctx = apply([
      { type: 'APP_MOUNT' },
      { type: 'REFRESH_OK' },
      { type: 'ACCESS_EXPIRED' },
      { type: 'REFRESH_UNAUTHORIZED', reason: 'security' },
    ]);
    expect(ctx.status).toBe('anonymous');
    expect(ctx.lostReason).toBe('security');
  });

  it('network error during refresh does not log out', () => {
    const ctx = apply([
      { type: 'APP_MOUNT' },
      { type: 'REFRESH_OK' },
      { type: 'ACCESS_EXPIRED' },
      { type: 'NETWORK_ERROR' },
    ]);
    expect(ctx.status).toBe('authenticated');
  });

  it('Authenticated → Anonymous on LOGOUT', () => {
    expect(
      apply([{ type: 'APP_MOUNT' }, { type: 'REFRESH_OK' }, { type: 'LOGOUT' }])
        .status,
    ).toBe('anonymous');
  });

  it('Offline → Bootstrapping on RECONNECT', () => {
    expect(
      apply([
        { type: 'APP_MOUNT' },
        { type: 'NETWORK_ERROR' },
        { type: 'RECONNECT' },
      ]).status,
    ).toBe('bootstrapping');
  });

  it('ignores illegal transitions', () => {
    expect(apply([{ type: 'LOGIN_OK' }]).status).toBe('unknown');
    expect(
      apply([{ type: 'APP_MOUNT' }, { type: 'SUBMIT_LOGIN' }]).status,
    ).toBe('bootstrapping');
  });
});
