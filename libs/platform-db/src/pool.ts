import { Pool, type PoolConfig } from 'pg';

/** Hard ceiling from platform-config / connection budget (system design §3.6). */
export const MAX_POOL_SIZE = 10;

export const DEFAULT_STATEMENT_TIMEOUT_MS = 5_000;
export const DEFAULT_LOCK_TIMEOUT_MS = 3_000;
export const DEFAULT_IDLE_IN_TX_TIMEOUT_MS = 10_000;

export interface CreatePoolOptions {
  connectionString: string;
  /** Capped at {@link MAX_POOL_SIZE}. Default 5. */
  max?: number;
  /** Extra node-pg options (application_name, etc.). */
  poolConfig?: Omit<PoolConfig, 'connectionString' | 'max'>;
}

export class PoolConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PoolConfigError';
  }
}

/**
 * Create a node-pg pool sized for PgBouncer transaction pooling.
 *
 * Timeout GUCs are **not** set via libpq startup `options` — PgBouncer rejects
 * `statement_timeout` as an unsupported startup parameter. Timeouts are applied
 * with `SET LOCAL` inside {@link withTransaction} (see `transaction.ts`).
 */
export function createPool(options: CreatePoolOptions): Pool {
  const max = options.max ?? 5;
  if (!Number.isInteger(max) || max < 1) {
    throw new PoolConfigError(`Pool max must be an integer >= 1, got ${max}`);
  }
  if (max > MAX_POOL_SIZE) {
    throw new PoolConfigError(
      `Pool max ${max} exceeds hard cap of ${MAX_POOL_SIZE} (PgBouncer / connection budget)`,
    );
  }

  return new Pool({
    ...options.poolConfig,
    connectionString: options.connectionString,
    max,
    idleTimeoutMillis: options.poolConfig?.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis:
      options.poolConfig?.connectionTimeoutMillis ?? 5_000,
  });
}

/** Lightweight readiness probe used by HealthService. */
export async function checkDatabase(pool: Pool): Promise<boolean> {
  try {
    const result = await pool.query<{ ok: number }>('SELECT 1 AS ok');
    return result.rows[0]?.ok === 1;
  } catch {
    return false;
  }
}
