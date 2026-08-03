import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, tokens } from '@/api-client';
import * as client from '@/api-client/client';
import {
  FORGOT_PASSWORD_ACK,
  mapTokenActionError,
  requestPasswordReset,
  resetPassword,
  verifyEmail,
} from './password';

function problem(
  status: number,
  title = 'x',
  extra: Record<string, unknown> = {},
) {
  return new ApiError(status, {
    type: 'about:blank',
    title,
    status,
    ...extra,
  });
}

describe('requestPasswordReset (F1-T05a)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves identically whether the account exists (202) or not (404)', async () => {
    const spy = vi.spyOn(client, 'request');

    spy.mockResolvedValueOnce({
      data: undefined,
      response: new Response(null, { status: 202 }),
    });
    await expect(
      requestPasswordReset({ email: 'known@example.com' }),
    ).resolves.toBeUndefined();

    spy.mockRejectedValueOnce(problem(404, 'Not found'));
    await expect(
      requestPasswordReset({ email: 'unknown@example.com' }),
    ).resolves.toBeUndefined();
  });

  it('swallows 400/422 so validation shape cannot leak account existence', async () => {
    const spy = vi.spyOn(client, 'request');
    spy.mockRejectedValueOnce(problem(400));
    await expect(
      requestPasswordReset({ email: 'a@b.com' }),
    ).resolves.toBeUndefined();
    spy.mockRejectedValueOnce(problem(422));
    await expect(
      requestPasswordReset({ email: 'a@b.com' }),
    ).resolves.toBeUndefined();
  });

  it('rethrows 429 so the form can show a wait message', async () => {
    vi.spyOn(client, 'request').mockRejectedValue(
      problem(429, 'Too many', { retryAfter: 30 }),
    );
    await expect(
      requestPasswordReset({ email: 'a@b.com' }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('rethrows 5xx and network failures', async () => {
    const spy = vi.spyOn(client, 'request');
    spy.mockRejectedValueOnce(problem(503, 'Unavailable'));
    await expect(
      requestPasswordReset({ email: 'a@b.com' }),
    ).rejects.toBeInstanceOf(ApiError);
    spy.mockRejectedValueOnce(new NetworkError());
    await expect(
      requestPasswordReset({ email: 'a@b.com' }),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('is a public call — no Authorization, no refresh cycle', async () => {
    const spy = vi.spyOn(client, 'request').mockResolvedValue({
      data: undefined,
      response: new Response(null, { status: 202 }),
    });
    await requestPasswordReset({ email: 'a@b.com' });
    const [path, options] = spy.mock.calls[0]!;
    expect(path).toBe('/v1/auth/password/forgot');
    expect(options).toMatchObject({
      method: 'POST',
      public: true,
      skipAuthRefresh: true,
    });
  });

  it('exposes one acknowledgement string for both outcomes', () => {
    expect(FORGOT_PASSWORD_ACK).toMatch(/if an account exists/i);
  });
});

describe('resetPassword (F1-T05a)', () => {
  beforeEach(() => {
    tokens.clear();
  });

  afterEach(() => {
    tokens.clear();
    vi.restoreAllMocks();
  });

  it('clears local tokens on success — the backend revokes every session', async () => {
    tokens.set('old-session', 600);
    vi.spyOn(client, 'request').mockResolvedValue({
      data: undefined,
      response: new Response(null, { status: 204 }),
    });

    await resetPassword({ token: 'reset-tok', password: 'new-password-1' });

    expect(tokens.get()).toBeNull();
  });

  it('propagates failures and leaves the current session untouched', async () => {
    tokens.set('still-valid', 600);
    vi.spyOn(client, 'request').mockRejectedValue(
      problem(400, 'Invalid token'),
    );

    await expect(
      resetPassword({ token: 'bad', password: 'new-password-1' }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(tokens.get()).toBe('still-valid');
  });

  it('sends the token in the body, never in the URL', async () => {
    const spy = vi.spyOn(client, 'request').mockResolvedValue({
      data: undefined,
      response: new Response(null, { status: 204 }),
    });
    await resetPassword({ token: 'secret-tok', password: 'new-password-1' });
    const [path, options] = spy.mock.calls[0]!;
    expect(path).toBe('/v1/auth/password/reset');
    expect(path).not.toContain('secret-tok');
    expect(options?.body).toEqual({
      token: 'secret-tok',
      password: 'new-password-1',
    });
  });
});

describe('verifyEmail (F1-T05a)', () => {
  afterEach(() => {
    tokens.clear();
    vi.restoreAllMocks();
  });

  it('posts the token and keeps the session intact', async () => {
    tokens.set('live-session', 600);
    const spy = vi.spyOn(client, 'request').mockResolvedValue({
      data: undefined,
      response: new Response(null, { status: 204 }),
    });

    await verifyEmail('verify-tok');

    const [path, options] = spy.mock.calls[0]!;
    expect(path).toBe('/v1/auth/verify-email');
    expect(options?.body).toEqual({ token: 'verify-tok' });
    expect(tokens.get()).toBe('live-session');
  });

  it('works logged out — the link may be opened in another browser', async () => {
    const spy = vi.spyOn(client, 'request').mockResolvedValue({
      data: undefined,
      response: new Response(null, { status: 204 }),
    });
    await verifyEmail('verify-tok');
    expect(spy.mock.calls[0]![1]).toMatchObject({ public: true });
  });
});

describe('mapTokenActionError (F1-T05a)', () => {
  it('maps 400/404/410 to one recoverable invalid-link state', () => {
    for (const status of [400, 404, 410]) {
      const mapped = mapTokenActionError(problem(status));
      expect(mapped.kind).toBe('invalid_token');
      expect(mapped.recoverable).toBe(true);
      expect(mapped.message).toMatch(/link/i);
    }
  });

  it('maps 429 to a wait message with the retry hint', () => {
    const mapped = mapTokenActionError(
      problem(429, 'Slow down', { retryAfter: 45 }),
    );
    expect(mapped.kind).toBe('rate_limited');
    expect(mapped.message).toMatch(/45/);
  });

  it('maps network failures without claiming the link is bad', () => {
    const mapped = mapTokenActionError(new NetworkError());
    expect(mapped.kind).toBe('network');
    expect(mapped.recoverable).toBe(false);
    expect(mapped.message).not.toMatch(/link/i);
  });

  it('surfaces field errors from 422 password-policy rejections', () => {
    const mapped = mapTokenActionError(
      new ApiError(422, {
        type: 'about:blank',
        title: 'Weak password',
        status: 422,
        errors: [{ field: 'password', message: 'Too common' }],
      }),
    );
    expect(mapped.kind).toBe('validation');
    expect(mapped.fieldErrors).toEqual({ password: 'Too common' });
  });
});
