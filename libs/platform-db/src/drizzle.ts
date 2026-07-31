import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

export type Db = NodePgDatabase;

/**
 * Drizzle wrapper over an existing pool. Schema is provided per-service at
 * call sites; the platform package stays domain-agnostic.
 */
export function createDb(pool: Pool): Db {
  return drizzle(pool);
}
