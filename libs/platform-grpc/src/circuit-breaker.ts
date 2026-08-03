import type { BreakerPolicy } from './client-options';
import { DEFAULT_GRPC_CLIENT_OPTIONS } from './client-options';

export type CircuitState = 'closed' | 'open' | 'half_open';

export class CircuitOpenError extends Error {
  readonly circuitName: string;
  readonly retryAfterMs: number;

  constructor(circuitName: string, retryAfterMs: number) {
    super(
      `Circuit breaker open for ${circuitName}; retry after ${retryAfterMs}ms`,
    );
    this.name = 'CircuitOpenError';
    this.circuitName = circuitName;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Simple sliding-window circuit breaker (no external deps).
 *
 * - CLOSED: record successes/failures; open when volume ≥ threshold and
 *   error rate ≥ errorThreshold.
 * - OPEN: fail fast until halfOpenAfterMs, then allow one probe.
 * - HALF_OPEN: single in-flight probe; success → CLOSED, failure → OPEN.
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  /** Rolling outcomes: true = success. */
  private readonly outcomes: boolean[] = [];
  private openedAt = 0;
  private halfOpenInFlight = false;

  constructor(
    private readonly policy: BreakerPolicy = DEFAULT_GRPC_CLIENT_OPTIONS.breaker,
    private readonly circuitName = 'default',
    private readonly now: () => number = () => Date.now(),
  ) {}

  getState(): CircuitState {
    this.maybeTransitionToHalfOpen();
    return this.state;
  }

  getName(): string {
    return this.circuitName;
  }

  /** Snapshot for metrics / debugging. */
  snapshot(): {
    state: CircuitState;
    name: string;
    volume: number;
    errorRate: number;
  } {
    this.maybeTransitionToHalfOpen();
    const volume = this.outcomes.length;
    const failures = this.outcomes.filter((ok) => !ok).length;
    return {
      state: this.state,
      name: this.circuitName,
      volume,
      errorRate: volume === 0 ? 0 : failures / volume,
    };
  }

  /**
   * Call before the protected operation. Throws CircuitOpenError when open
   * (or when a half-open probe is already in flight).
   */
  tryEnter(): void {
    this.maybeTransitionToHalfOpen();
    if (this.state === 'open') {
      const elapsed = this.now() - this.openedAt;
      const retryAfterMs = Math.max(0, this.policy.halfOpenAfterMs - elapsed);
      throw new CircuitOpenError(this.circuitName, retryAfterMs);
    }
    if (this.state === 'half_open') {
      if (this.halfOpenInFlight) {
        throw new CircuitOpenError(
          this.circuitName,
          this.policy.halfOpenAfterMs,
        );
      }
      this.halfOpenInFlight = true;
    }
  }

  onSuccess(): void {
    if (this.state === 'half_open') {
      this.halfOpenInFlight = false;
      this.state = 'closed';
      this.outcomes.length = 0;
      return;
    }
    this.record(true);
  }

  onFailure(): void {
    if (this.state === 'half_open') {
      this.halfOpenInFlight = false;
      this.state = 'open';
      this.openedAt = this.now();
      this.outcomes.length = 0;
      return;
    }
    this.record(false);
    this.maybeOpen();
  }

  /**
   * Run `fn` under the breaker. Network/thrown errors count as failures.
   * Use tryEnter/onSuccess/onFailure when you need status-code semantics.
   */
  async exec<T>(fn: () => Promise<T>): Promise<T> {
    this.tryEnter();
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  /** Test helper / manual reset. */
  reset(): void {
    this.state = 'closed';
    this.outcomes.length = 0;
    this.openedAt = 0;
    this.halfOpenInFlight = false;
  }

  private maybeTransitionToHalfOpen(): void {
    if (this.state !== 'open') return;
    if (this.now() - this.openedAt >= this.policy.halfOpenAfterMs) {
      this.state = 'half_open';
      this.halfOpenInFlight = false;
    }
  }

  private record(success: boolean): void {
    this.outcomes.push(success);
    const max = Math.max(this.policy.volumeThreshold, 1);
    while (this.outcomes.length > max) {
      this.outcomes.shift();
    }
  }

  private maybeOpen(): void {
    if (this.outcomes.length < this.policy.volumeThreshold) return;
    const failures = this.outcomes.filter((ok) => !ok).length;
    const rate = failures / this.outcomes.length;
    if (rate >= this.policy.errorThreshold) {
      this.state = 'open';
      this.openedAt = this.now();
    }
  }
}

/** Registry of named breakers (e.g. per upstream host). */
export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(
    private readonly policy: BreakerPolicy = DEFAULT_GRPC_CLIENT_OPTIONS.breaker,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get(name: string): CircuitBreaker {
    let b = this.breakers.get(name);
    if (!b) {
      b = new CircuitBreaker(this.policy, name, this.now);
      this.breakers.set(name, b);
    }
    return b;
  }

  snapshots(): ReturnType<CircuitBreaker['snapshot']>[] {
    return [...this.breakers.values()].map((b) => b.snapshot());
  }

  resetAll(): void {
    for (const b of this.breakers.values()) b.reset();
  }
}
