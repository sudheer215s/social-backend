'use client';

/**
 * Auth mutations — features never call api-client for login/register.
 */
import { request, tokens, ApiError, type Problem } from '@/api-client';
import { ensureAuthConfigured } from './api';

export type TokenResponse = {
  access_token: string;
  expires_in: number;
  token_type?: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type RegisterInput = {
  email: string;
  password: string;
  username: string;
};

export type AuthFormError = {
  kind:
    | 'invalid_credentials'
    | 'locked'
    | 'rate_limited'
    | 'validation'
    | 'network'
    | 'unknown';
  message: string;
  retryAfterSec?: number;
  fieldErrors?: Record<string, string>;
};

const INVALID_CREDENTIALS_MESSAGE =
  'Invalid email or password. Please try again.';

function applyTokens(body: TokenResponse): void {
  tokens.set(body.access_token, body.expires_in);
}

export async function login(input: LoginInput): Promise<TokenResponse> {
  ensureAuthConfigured();
  const { data } = await request<TokenResponse>('/v1/auth/login', {
    method: 'POST',
    body: input,
    public: true,
    skipAuthRefresh: true,
    deadline: 'auth',
  });
  applyTokens(data);
  return data;
}

export async function register(input: RegisterInput): Promise<TokenResponse> {
  ensureAuthConfigured();
  const { data } = await request<TokenResponse>('/v1/auth/register', {
    method: 'POST',
    body: input,
    public: true,
    skipAuthRefresh: true,
    deadline: 'auth',
  });
  applyTokens(data);
  return data;
}

/**
 * Logout: fire-and-forget network, always clear local session.
 * @see docs/frontend/03-flows.md §11
 */
export async function logout(): Promise<void> {
  ensureAuthConfigured();
  try {
    await request('/v1/auth/logout', {
      method: 'POST',
      skipAuthRefresh: true,
      deadline: 'auth',
    });
  } catch {
    // Connectivity must not leave the user "logged in" locally.
  } finally {
    tokens.clear();
  }
}

/** Map API failures to form-safe, anti-enumeration messages. */
export function mapAuthError(err: unknown): AuthFormError {
  if (err instanceof ApiError) {
    if (err.status === 401) {
      return {
        kind: 'invalid_credentials',
        message: INVALID_CREDENTIALS_MESSAGE,
      };
    }
    if (err.status === 423) {
      const retry = retryAfterFromProblem(err.problem);
      return {
        kind: 'locked',
        message: retry
          ? `Too many attempts. Try again in ${Math.ceil(retry / 60)} minutes.`
          : 'Too many attempts. Try again later.',
        ...(retry !== undefined ? { retryAfterSec: retry } : {}),
      };
    }
    if (err.status === 429) {
      const retry = retryAfterFromProblem(err.problem);
      return {
        kind: 'rate_limited',
        message: retry
          ? `Please wait ${retry} seconds before trying again.`
          : 'Too many requests. Please wait and try again.',
        ...(retry !== undefined ? { retryAfterSec: retry } : {}),
      };
    }
    if (err.status === 400 || err.status === 422) {
      const fields = err.fieldErrors;
      return {
        kind: 'validation',
        message: err.problem.title || 'Please check your input.',
        ...(Object.keys(fields).length > 0 ? { fieldErrors: fields } : {}),
      };
    }
    return {
      kind: 'unknown',
      message: err.problem.title || 'Something went wrong. Please try again.',
    };
  }
  return {
    kind: 'network',
    message: 'Network error. Check your connection and try again.',
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

export { INVALID_CREDENTIALS_MESSAGE };
