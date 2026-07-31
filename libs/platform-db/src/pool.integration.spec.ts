/**
 * Integration tests against local Compose (Postgres via PgBouncer :6432).
 * Soft-skip when the database is unreachable so CI without Compose still passes.
 */
import { sql } from 'drizzle-orm';
import { createDb } from './drizzle';
import { checkDatabase, createPool } from './pool';
import { withTransaction } from './transaction';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://social:social@127.0.0.1:6432/social';

async function canConnect(): Promise<boolean> {
  const pool = createPool({ connectionString, max: 1 });
  try {
    return await checkDatabase(pool);
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}

describe('platform-db via PgBouncer', () => {
  let available = false;

  beforeAll(async () => {
    available = await canConnect();
    if (!available) {
      console.warn(
        'Skipping platform-db integration tests — database not reachable at',
        connectionString,
      );
    }
  });

  it('checkDatabase returns true through PgBouncer', async () => {
    if (!available) return;
    const pool = createPool({ connectionString, max: 2 });
    try {
      await expect(checkDatabase(pool)).resolves.toBe(true);
    } finally {
      await pool.end();
    }
  });

  it('withTransaction commits a simple SELECT', async () => {
    if (!available) return;
    const pool = createPool({ connectionString, max: 2 });
    try {
      const value = await withTransaction(pool, async (client) => {
        const res = await client.query<{ n: string }>('SELECT 2::int AS n');
        return Number(res.rows[0]?.n);
      });
      expect(value).toBe(2);
    } finally {
      await pool.end();
    }
  });

  it('applies SET LOCAL statement_timeout inside the transaction', async () => {
    if (!available) return;
    const pool = createPool({ connectionString, max: 1 });
    try {
      const timeouts = await withTransaction(
        pool,
        async (client) => {
          const res = await client.query<{
            statement_timeout: string;
            lock_timeout: string;
          }>(
            `SELECT current_setting('statement_timeout') AS statement_timeout,
                    current_setting('lock_timeout') AS lock_timeout`,
          );
          return res.rows[0];
        },
        { statementTimeoutMs: 5_000, lockTimeoutMs: 3_000 },
      );
      expect(timeouts?.statement_timeout).toMatch(/5s|5000/);
      expect(timeouts?.lock_timeout).toMatch(/3s|3000/);
    } finally {
      await pool.end();
    }
  });

  it('createDb runs a raw SQL select via Drizzle', async () => {
    if (!available) return;
    const pool = createPool({ connectionString, max: 1 });
    try {
      const db = createDb(pool);
      const rows = await db.execute(sql`SELECT 1::int AS ok`);
      const list = Array.isArray(rows)
        ? rows
        : ((rows as { rows?: { ok: number }[] }).rows ?? []);
      expect(Number((list[0] as { ok: number } | undefined)?.ok)).toBe(1);
    } finally {
      await pool.end();
    }
  });
});
