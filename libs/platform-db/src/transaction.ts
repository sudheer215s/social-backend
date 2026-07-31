import type { Pool, PoolClient } from 'pg';
import {
  DEFAULT_IDLE_IN_TX_TIMEOUT_MS,
  DEFAULT_LOCK_TIMEOUT_MS,
  DEFAULT_STATEMENT_TIMEOUT_MS,
} from './pool';

/** Postgres SQLSTATE for serialization failure. */
export const SERIALIZATION_FAILURE = '40001';
/** Postgres SQLSTATE for deadlock detected. */
export const DEADLOCK_DETECTED = '40P01';

export type TxClient = PoolClient;

export interface PgErrorLike {
  code?: string;
}

export interface TransactionOptions {
  statementTimeoutMs?: number;
  lockTimeoutMs?: number;
  idleInTransactionSessionTimeoutMs?: number;
}

export function isRetryableTxError(err: unknown): boolean {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as PgErrorLike).code)
      : undefined;
  return code === SERIALIZATION_FAILURE || code === DEADLOCK_DETECTED;
}

async function applyLocalTimeouts(
  client: PoolClient,
  options: TransactionOptions,
): Promise<void> {
  const statementTimeoutMs =
    options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
  const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const idleInTxMs =
    options.idleInTransactionSessionTimeoutMs ?? DEFAULT_IDLE_IN_TX_TIMEOUT_MS;

  // SET LOCAL is transaction-scoped and is the PgBouncer-safe way to enforce
  // timeouts under transaction pooling (startup options are rejected).
  await client.query(`
    SET LOCAL statement_timeout = ${Math.floor(statementTimeoutMs)};
    SET LOCAL lock_timeout = ${Math.floor(lockTimeoutMs)};
    SET LOCAL idle_in_transaction_session_timeout = ${Math.floor(idleInTxMs)};
  `);
}

/**
 * Run work inside a single SQL transaction (BEGIN … COMMIT / ROLLBACK).
 * Applies statement / lock / idle-in-tx timeouts via SET LOCAL.
 */
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: TxClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await applyLocalTimeouts(client, options);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback errors; original error is authoritative.
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Retry a full unit of work on serialization failures / deadlocks.
 * The callback must be idempotent or safe to re-run.
 */
export async function withRetryOnSerialization<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error(`maxAttempts must be integer >= 1, got ${maxAttempts}`);
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryableTxError(err) || attempt === maxAttempts) {
        throw err;
      }
    }
  }
  throw lastError;
}
