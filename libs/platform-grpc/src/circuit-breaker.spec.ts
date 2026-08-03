import {
  CircuitBreaker,
  CircuitBreakerRegistry,
  CircuitOpenError,
} from './circuit-breaker';

describe('CircuitBreaker', () => {
  let now = 0;
  const clock = () => now;

  beforeEach(() => {
    now = 1_000_000;
  });

  function make(
    overrides: Partial<{
      volumeThreshold: number;
      errorThreshold: number;
      halfOpenAfterMs: number;
    }> = {},
  ) {
    return new CircuitBreaker(
      {
        volumeThreshold: overrides.volumeThreshold ?? 5,
        errorThreshold: overrides.errorThreshold ?? 0.5,
        halfOpenAfterMs: overrides.halfOpenAfterMs ?? 1_000,
      },
      'test',
      clock,
    );
  }

  it('starts closed and allows traffic', () => {
    const b = make();
    expect(b.getState()).toBe('closed');
    expect(() => b.tryEnter()).not.toThrow();
    b.onSuccess();
    expect(b.getState()).toBe('closed');
  });

  it('opens when error rate exceeds threshold after volume', () => {
    const b = make({ volumeThreshold: 4, errorThreshold: 0.5 });
    for (let i = 0; i < 4; i++) {
      b.tryEnter();
      b.onFailure();
    }
    expect(b.getState()).toBe('open');
    expect(() => b.tryEnter()).toThrow(CircuitOpenError);
  });

  it('stays closed when failures stay under threshold', () => {
    const b = make({ volumeThreshold: 4, errorThreshold: 0.5 });
    b.tryEnter();
    b.onFailure();
    b.tryEnter();
    b.onSuccess();
    b.tryEnter();
    b.onSuccess();
    b.tryEnter();
    b.onSuccess();
    expect(b.getState()).toBe('closed');
  });

  it('transitions open → half_open after cool-down', () => {
    const b = make({
      volumeThreshold: 2,
      errorThreshold: 0.5,
      halfOpenAfterMs: 500,
    });
    b.tryEnter();
    b.onFailure();
    b.tryEnter();
    b.onFailure();
    expect(b.getState()).toBe('open');

    now += 499;
    expect(b.getState()).toBe('open');
    now += 2;
    expect(b.getState()).toBe('half_open');
  });

  it('half_open success closes; failure re-opens', () => {
    const b = make({
      volumeThreshold: 2,
      errorThreshold: 0.5,
      halfOpenAfterMs: 100,
    });
    b.tryEnter();
    b.onFailure();
    b.tryEnter();
    b.onFailure();
    now += 200;
    expect(b.getState()).toBe('half_open');

    b.tryEnter();
    b.onSuccess();
    expect(b.getState()).toBe('closed');

    // trip again
    b.tryEnter();
    b.onFailure();
    b.tryEnter();
    b.onFailure();
    now += 200;
    b.tryEnter();
    b.onFailure();
    expect(b.getState()).toBe('open');
  });

  it('only one half_open probe at a time', () => {
    const b = make({
      volumeThreshold: 2,
      errorThreshold: 0.5,
      halfOpenAfterMs: 50,
    });
    b.tryEnter();
    b.onFailure();
    b.tryEnter();
    b.onFailure();
    now += 100;
    expect(b.getState()).toBe('half_open');
    b.tryEnter();
    expect(() => b.tryEnter()).toThrow(CircuitOpenError);
  });

  it('exec records success and failure', async () => {
    const b = make({ volumeThreshold: 2, errorThreshold: 0.5 });
    await expect(b.exec(() => Promise.resolve(42))).resolves.toBe(42);
    await expect(
      b.exec(() => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    // volume=2, error rate=0.5 → open; next call fails fast
    expect(b.getState()).toBe('open');
    await expect(b.exec(() => Promise.resolve(1))).rejects.toBeInstanceOf(
      CircuitOpenError,
    );
  });
});

describe('CircuitBreakerRegistry', () => {
  it('returns same instance per name', () => {
    const reg = new CircuitBreakerRegistry({
      volumeThreshold: 10,
      errorThreshold: 0.5,
      halfOpenAfterMs: 1000,
    });
    expect(reg.get('a')).toBe(reg.get('a'));
    expect(reg.get('a')).not.toBe(reg.get('b'));
  });
});
