'use client';

/**
 * Password reset and email verification — token-bearing auth mutations.
 * @see docs/frontend/03-flows.md §3 (anti-enumeration is a frontend responsibility too)
 */
import { request, tokens, ApiError, type Problem } from '@/api-client';
import { ensureAuthConfigured } from './api';

export type ForgotPasswordInput = { email: string };

export type ResetPasswordInput = {
  token: string;
  password: string;
};

export type TokenActionError = {
  kind: 'invalid_token' | 'rate_limited' | 'validation' | 'network' | 'unknown';
  message: string;
  /** True when the user can fix this themselves by requesting a new link. */
  recoverable: boolean;
  retryAfterSec?: number;
  fieldErrors?: Record<string, string>;
};

/**
 * The single string shown after a forgot-password submit, whatever happened.
 * Any branch in this copy re-introduces account enumeration.
 */
export const FORGOT_PASSWORD_ACK =
  "If an account exists for that address, we've sent a link to reset your password.";

const INVALID_TOKEN_MESSAGE =
  'This link is invalid or has expired. Request a new one to continue.';

/**
 * Ask for a reset link. Resolves for every outcome that could reveal whether
 * the address is registered; only rate limiting and infrastructure failures
 * (which are account-independent) reach the caller.
 */
export async function requestPasswordReset(
  input: ForgotPasswordInput,
): Promise<void> {
  ensureAuthConfigured();
  try {
    await request('/v1/auth/password/forgot', {
      method: 'POST',
      body: input,
      public: true,
      skipAuthRefresh: true,
      deadline: 'auth',
    });
  } catch (err) {
    if (err instanceof ApiError && err.status < 500 && err.status !== 429) {
      // 400 / 404 / 422 — indistinguishable to the user, by design.
      return;
    }
    throw err;
  }
}

/**
 * Complete a reset. The backend revokes every session, so the local access
 * token is dead the moment this succeeds — clear it and send the user to login.
 */
export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  ensureAuthConfigured();
  await request('/v1/auth/password/reset', {
    method: 'POST',
    body: input,
    public: true,
    skipAuthRefresh: true,
    deadline: 'auth',
  });
  tokens.clear();
}

/**
 * Verify an email address. Public because the link is routinely opened in a
 * different browser from the one that registered.
 */
export async function verifyEmail(token: string): Promise<void> {
  ensureAuthConfigured();
  await request('/v1/auth/verify-email', {
    method: 'POST',
    body: { token },
    public: true,
    skipAuthRefresh: true,
    deadline: 'auth',
  });
}

/** Map failures of a token-bearing action into a state the UI can render. */
export function mapTokenActionError(err: unknown): TokenActionError {
  if (err instanceof ApiError) {
    if (err.status === 400 || err.status === 404 || err.status === 410) {
      return {
        kind: 'invalid_token',
        message: INVALID_TOKEN_MESSAGE,
        recoverable: true,
      };
    }
    if (err.status === 429) {
      const retry = retryAfterFromProblem(err.problem);
      return {
        kind: 'rate_limited',
        message: retry
          ? `Please wait ${retry} seconds before trying again.`
          : 'Too many requests. Please wait and try again.',
        recoverable: true,
        ...(retry !== undefined ? { retryAfterSec: retry } : {}),
      };
    }
    if (err.status === 422) {
      const fields = err.fieldErrors;
      return {
        kind: 'validation',
        message: err.problem.title || 'Please check your input.',
        recoverable: true,
        ...(Object.keys(fields).length > 0 ? { fieldErrors: fields } : {}),
      };
    }
    return {
      kind: 'unknown',
      message: err.problem.title || 'Something went wrong. Please try again.',
      recoverable: false,
    };
  }
  return {
    kind: 'network',
    message: 'Network error. Check your connection and try again.',
    recoverable: false,
  };
}

function retryAfterFromProblem(problem: Problem): number | undefined {
  const raw = problem['retryAfter'] ?? problem['retry_after'];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export { INVALID_TOKEN_MESSAGE };
