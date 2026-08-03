import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, tokens } from '@/api-client';
import * as client from '@/api-client/client';
import {
  INVALID_CREDENTIALS_MESSAGE,
  login,
  logout,
  mapAuthError,
  register,
} from './auth';

describe('mapAuthError (F1-T02)', () => {
  it('maps 401 to identical invalid-credentials message', () => {
    const a = mapAuthError(
      new ApiError(401, {
        type: 'about:blank',
        title: 'Unknown email',
        status: 401,
      }),
    );
    const b = mapAuthError(
      new ApiError(401, {
        type: 'about:blank',
        title: 'Wrong password',
        status: 401,
      }),
    );
    expect(a.message).toBe(INVALID_CREDENTIALS_MESSAGE);
    expect(b.message).toBe(INVALID_CREDENTIALS_MESSAGE);
    expect(a.kind).toBe('invalid_credentials');
  });

  it('maps 423 locked with retry hint', () => {
    const err = mapAuthError(
      new ApiError(423, {
        type: 'about:blank',
        title: 'Locked',
        status: 423,
        retryAfter: 120,
      }),
    );
    expect(err.kind).toBe('locked');
    expect(err.message).toMatch(/2 minutes/i);
  });

  it('maps network errors', () => {
    expect(mapAuthError(new NetworkError()).kind).toBe('network');
  });
});

describe('login / register (F1-T02)', () => {
  beforeEach(() => {
    tokens.clear();
  });

  afterEach(() => {
    tokens.clear();
    vi.restoreAllMocks();
  });

  it('stores access token on successful login', async () => {
    vi.spyOn(client, 'request').mockResolvedValue({
      data: { access_token: 'tok-login', expires_in: 600 },
      response: new Response(),
    });
    await login({ email: 'a@b.com', password: 'secret12' });
    expect(tokens.get()).toBe('tok-login');
  });

  it('stores access token on successful register', async () => {
    vi.spyOn(client, 'request').mockResolvedValue({
      data: { access_token: 'tok-reg', expires_in: 600 },
      response: new Response(),
    });
    await register({
      email: 'a@b.com',
      password: 'secret12',
      username: 'alice',
    });
    expect(tokens.get()).toBe('tok-reg');
  });

  it('clears tokens even when logout network fails', async () => {
    tokens.set('still-here', 600);
    vi.spyOn(client, 'request').mockRejectedValue(new NetworkError());
    await logout();
    expect(tokens.get()).toBeNull();
  });

  it('clears tokens after successful logout', async () => {
    tokens.set('still-here', 600);
    vi.spyOn(client, 'request').mockResolvedValue({
      data: undefined,
      response: new Response(null, { status: 204 }),
    });
    await logout();
    expect(tokens.get()).toBeNull();
  });
});
