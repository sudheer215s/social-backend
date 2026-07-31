import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';

/**
 * Forward-only SQL migrator. Files are applied in sorted filename order once.
 * Safe through PgBouncer transaction mode (no session state).
 */
export async function applyMigrations(
  pool: Pool,
  migrationsDir: string,
): Promise<string[]> {
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS identity;
    CREATE TABLE IF NOT EXISTS identity.schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied: string[] = [];
  for (const file of files) {
    const id = file;
    const exists = await pool.query<{ id: string }>(
      'SELECT id FROM identity.schema_migrations WHERE id = $1',
      [id],
    );
    if ((exists.rowCount ?? 0) > 0) {
      continue;
    }

    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO identity.schema_migrations (id) VALUES ($1)',
        [id],
      );
      await client.query('COMMIT');
      applied.push(id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  return applied;
}

export function defaultMigrationsDir(): string {
  // nest copies assets next to compiled JS under dist/db/migrations
  return path.join(__dirname, 'migrations');
}
