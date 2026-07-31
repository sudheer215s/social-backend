export type HealthStatus = 'up' | 'down';

export interface DependencyProbe {
  name: string;
  check: () => Promise<boolean> | boolean;
}

export interface LiveResult {
  status: 'ok';
}

export interface ReadyResult {
  status: 'ok' | 'degraded' | 'unavailable';
  checks: Record<string, HealthStatus>;
}

export interface HealthServiceOptions {
  probes?: DependencyProbe[];
  /** Cache ready results for this many ms. Default 5000 (design). */
  readyCacheMs?: number;
  now?: () => number;
}

/**
 * Liveness is process-only (event-loop responsiveness). Readiness includes
 * dependency probes and is cached so thrashing deps do not restart the fleet
 * via liveness (review H7 / platform-libraries.md).
 */
export class HealthService {
  private readonly probes: DependencyProbe[];
  private readonly readyCacheMs: number;
  private readonly now: () => number;
  private cachedReady: { at: number; result: ReadyResult } | undefined;

  constructor(options: HealthServiceOptions = {}) {
    this.probes = options.probes ?? [];
    this.readyCacheMs = options.readyCacheMs ?? 5_000;
    this.now = options.now ?? (() => Date.now());
  }

  live(): LiveResult {
    return { status: 'ok' };
  }

  async ready(): Promise<ReadyResult> {
    const t = this.now();
    if (this.cachedReady && t - this.cachedReady.at < this.readyCacheMs) {
      return this.cachedReady.result;
    }

    const checks: Record<string, HealthStatus> = {};
    await Promise.all(
      this.probes.map(async (probe) => {
        try {
          const ok = await probe.check();
          checks[probe.name] = ok ? 'up' : 'down';
        } catch {
          checks[probe.name] = 'down';
        }
      }),
    );

    const values = Object.values(checks);
    let status: ReadyResult['status'] = 'ok';
    if (values.length === 0) {
      status = 'ok';
    } else if (values.every((v) => v === 'down')) {
      status = 'unavailable';
    } else if (values.some((v) => v === 'down')) {
      status = 'degraded';
    }

    const result: ReadyResult = { status, checks };
    this.cachedReady = { at: t, result };
    return result;
  }

  /** Test helper / forced refresh after known recovery. */
  clearReadyCache(): void {
    this.cachedReady = undefined;
  }
}
