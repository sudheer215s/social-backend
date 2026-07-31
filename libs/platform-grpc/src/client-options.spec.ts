import {
  DEFAULT_GRPC_CLIENT_OPTIONS,
  GrpcClientOptionsError,
  resolveGrpcClientOptions,
  retryBudgetAllowance,
} from './client-options';

describe('resolveGrpcClientOptions', () => {
  it('returns design defaults when given no input', () => {
    expect(resolveGrpcClientOptions()).toEqual(DEFAULT_GRPC_CLIENT_OPTIONS);
  });

  it('uses deadline propagate by default', () => {
    expect(resolveGrpcClientOptions().deadline).toBe('propagate');
  });

  it('defaults retry budget to 10% with max 2', () => {
    const opts = resolveGrpcClientOptions();
    expect(opts.retry.max).toBe(2);
    expect(opts.retry.budget).toBe(0.1);
    expect(opts.retry.on).toEqual(
      expect.arrayContaining([
        'UNAVAILABLE',
        'DEADLINE_EXCEEDED',
        'RESOURCE_EXHAUSTED',
      ]),
    );
  });

  it('merges partial overrides', () => {
    const opts = resolveGrpcClientOptions({
      retry: { max: 1 },
      breaker: { halfOpenAfterMs: 5_000 },
    });
    expect(opts.retry.max).toBe(1);
    expect(opts.retry.budget).toBe(0.1);
    expect(opts.breaker.halfOpenAfterMs).toBe(5_000);
    expect(opts.breaker.volumeThreshold).toBe(20);
  });

  it('rejects retry budgets above 0.25', () => {
    expect(() => resolveGrpcClientOptions({ retry: { budget: 0.5 } })).toThrow(
      GrpcClientOptionsError,
    );
  });

  it('rejects non-positive retry budget', () => {
    expect(() => resolveGrpcClientOptions({ retry: { budget: 0 } })).toThrow(
      GrpcClientOptionsError,
    );
  });
});

describe('retryBudgetAllowance', () => {
  it('computes floor(total * budget)', () => {
    expect(retryBudgetAllowance(100, 0.1)).toBe(10);
    expect(retryBudgetAllowance(9, 0.1)).toBe(0);
    expect(retryBudgetAllowance(20, 0.1)).toBe(2);
  });
});
