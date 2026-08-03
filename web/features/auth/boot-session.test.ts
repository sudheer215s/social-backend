import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as sessionApi from '@/data/session/api';
import { bootSession, resetBootForTests } from './boot-session';
import { useSessionStore } from './session-store';

describe('bootSession (F1-T01)', () => {
  beforeEach(() => {
    resetBootForTests();
    useSessionStore.getState()._reset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetBootForTests();
    useSessionStore.getState()._reset();
  });

  it('transitions to authenticated when refresh succeeds', async () => {
    vi.spyOn(sessionApi, 'silentRefresh').mockResolvedValue('ok');
    vi.spyOn(sessionApi, 'subscribeSessionLost').mockReturnValue(
      () => undefined,
    );

    await bootSession();
    expect(useSessionStore.getState().status).toBe('authenticated');
  });

  it('transitions to anonymous when refresh is unauthorized', async () => {
    vi.spyOn(sessionApi, 'silentRefresh').mockResolvedValue('unauthorized');
    vi.spyOn(sessionApi, 'subscribeSessionLost').mockReturnValue(
      () => undefined,
    );

    await bootSession();
    expect(useSessionStore.getState().status).toBe('anonymous');
  });

  it('transitions to offline on network error', async () => {
    vi.spyOn(sessionApi, 'silentRefresh').mockResolvedValue('network');
    vi.spyOn(sessionApi, 'subscribeSessionLost').mockReturnValue(
      () => undefined,
    );

    await bootSession();
    expect(useSessionStore.getState().status).toBe('offline');
  });

  it('is idempotent', async () => {
    const spy = vi.spyOn(sessionApi, 'silentRefresh').mockResolvedValue('ok');
    vi.spyOn(sessionApi, 'subscribeSessionLost').mockReturnValue(
      () => undefined,
    );

    await bootSession();
    await bootSession();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
