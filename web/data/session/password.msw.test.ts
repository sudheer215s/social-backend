/**
 * F1-T05d: the password/verify contract through the real request pipeline.
 * Unit tests stub `request`; this one does not, so a drift between the data
 * layer and the OpenAPI-derived mocks fails here.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ApiError, tokens } from '@/api-client';
import { server } from '@/mocks/server';
import {
  mapTokenActionError,
  requestPasswordReset,
  resetPassword,
  verifyEmail,
} from './password';

describe('password flows against MSW (F1-T05d)', () => {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
  });

  afterEach(() => {
    server.resetHandlers();
    tokens.clear();
  });

  afterAll(() => {
    server.close();
  });

  it('accepts a forgot-password request for any address', async () => {
    await expect(
      requestPasswordReset({ email: 'anyone@example.com' }),
    ).resolves.toBeUndefined();
  });

  it('surfaces the rate limit rather than a false acknowledgement', async () => {
    await expect(
      requestPasswordReset({ email: 'ratelimited@example.com' }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('resets the password and drops the revoked local session', async () => {
    tokens.set('pre-reset', 600);
    await resetPassword({ token: 'good-token', password: 'new-password-1' });
    expect(tokens.get()).toBeNull();
  });

  it('maps a rejected reset token to the invalid-link state', async () => {
    const err = await resetPassword({
      token: 'expired-token',
      password: 'new-password-1',
    }).catch((e: unknown) => e);
    expect(mapTokenActionError(err).kind).toBe('invalid_token');
  });

  it('verifies an email and maps a rejected token to the same state', async () => {
    await expect(verifyEmail('good-token')).resolves.toBeUndefined();
    const err = await verifyEmail('expired-token').catch((e: unknown) => e);
    expect(mapTokenActionError(err).kind).toBe('invalid_token');
  });
});
