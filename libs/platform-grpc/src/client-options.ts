/**
 * Shared gRPC client policy (platform-libraries.md — platform-grpc).
 * Real channel construction lands when domain services adopt @grpc/grpc-js;
 * this module freezes the defaults so callers cannot drift.
 */

export type DeadlineMode = 'propagate' | 'fixed';

export interface RetryPolicy {
  /** Max retry attempts after the first try. */
  max: number;
  /**
   * Fraction of total request budget allowed for retries (0–1).
   * Uncapped retries amplify partial outages — keep this low (design: 0.1).
   */
  budget: number;
  /** gRPC status names that are safe to retry. */
  on: readonly string[];
}

export interface BreakerPolicy {
  volumeThreshold: number;
  /** Open the breaker when error rate exceeds this (0–1). */
  errorThreshold: number;
  halfOpenAfterMs: number;
}

export interface GrpcClientDefaults {
  deadline: DeadlineMode;
  retry: RetryPolicy;
  breaker: BreakerPolicy;
}

export const DEFAULT_GRPC_CLIENT_OPTIONS: GrpcClientDefaults = {
  deadline: 'propagate',
  retry: {
    max: 2,
    budget: 0.1,
    on: ['UNAVAILABLE', 'DEADLINE_EXCEEDED', 'RESOURCE_EXHAUSTED'],
  },
  breaker: {
    volumeThreshold: 20,
    errorThreshold: 0.5,
    halfOpenAfterMs: 15_000,
  },
};

export type GrpcClientOptionsInput = {
  deadline?: DeadlineMode;
  retry?: Partial<RetryPolicy> & {
    on?: readonly string[];
  };
  breaker?: Partial<BreakerPolicy>;
};

export class GrpcClientOptionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GrpcClientOptionsError';
  }
}

/**
 * Merge caller overrides with platform defaults and validate invariants.
 */
export function resolveGrpcClientOptions(
  input: GrpcClientOptionsInput = {},
): GrpcClientDefaults {
  const retry: RetryPolicy = {
    ...DEFAULT_GRPC_CLIENT_OPTIONS.retry,
    ...input.retry,
    on: input.retry?.on ?? DEFAULT_GRPC_CLIENT_OPTIONS.retry.on,
  };
  const breaker: BreakerPolicy = {
    ...DEFAULT_GRPC_CLIENT_OPTIONS.breaker,
    ...input.breaker,
  };

  if (retry.max < 0 || !Number.isInteger(retry.max)) {
    throw new GrpcClientOptionsError('retry.max must be an integer >= 0');
  }
  if (retry.budget <= 0 || retry.budget > 1) {
    throw new GrpcClientOptionsError('retry.budget must be in (0, 1]');
  }
  if (retry.budget > 0.25) {
    // Soft guard — design chooses 10%; anything above 25% is almost certainly a mistake.
    throw new GrpcClientOptionsError(
      'retry.budget > 0.25 is not allowed (retry amplification risk)',
    );
  }
  if (breaker.errorThreshold <= 0 || breaker.errorThreshold > 1) {
    throw new GrpcClientOptionsError(
      'breaker.errorThreshold must be in (0, 1]',
    );
  }
  if (breaker.volumeThreshold < 1) {
    throw new GrpcClientOptionsError('breaker.volumeThreshold must be >= 1');
  }

  return {
    deadline: input.deadline ?? DEFAULT_GRPC_CLIENT_OPTIONS.deadline,
    retry,
    breaker,
  };
}

/**
 * How many of `totalAttempts` may be retries under the budget.
 * Example: budget 0.1, 100 attempts → 10 retries.
 */
export function retryBudgetAllowance(
  totalAttempts: number,
  budget: number,
): number {
  if (totalAttempts < 0 || !Number.isFinite(totalAttempts)) {
    throw new GrpcClientOptionsError('totalAttempts must be finite >= 0');
  }
  return Math.floor(totalAttempts * budget);
}
