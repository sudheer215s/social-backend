import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';

export async function applyMigrations(
  pool: Pool,
  migrationsDir: string,
): Promise<string[]> {
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS notification;
    CREATE TABLE IF NOT EXISTS notification.schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const applied: string[] = [];
  for (const file of files) {
    const exists = await pool.query(
      'SELECT 1 FROM notification.schema_migrations WHERE id = $1',
      [file],
    );
    if ((exists.rowCount ?? 0) > 0) continue;
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO notification.schema_migrations (id) VALUES ($1)',
        [file],
      );
      await client.query('COMMIT');
      applied.push(file);
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
  return path.join(__dirname, 'migrations');
}
