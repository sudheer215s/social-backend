import type { Pool, PoolClient } from 'pg';

/**
 * Run `fn` only if this process acquires a Postgres session advisory lock.
 * Prevents multi-replica job overlap (mention-repair, reconcile, …).
 *
 * @returns true if this caller was the leader and ran `fn`.
 */
export async function withAdvisoryLeaderLock(
  pool: Pool,
  lockKey: number,
  fn: (client: PoolClient) => Promise<void>,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    const got = await client.query<{ ok: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS ok',
      [lockKey],
    );
    if (!got.rows[0]?.ok) {
      return false;
    }
    try {
      await fn(client);
      return true;
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [lockKey]);
    }
  } finally {
    client.release();
  }
}

/** Stable int4 lock key from a string name (mention-repair, …). */
export function advisoryLockKey(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  }
  // Keep away from 0; pg accepts signed int4.
  return h === 0 ? 1 : h;
}
