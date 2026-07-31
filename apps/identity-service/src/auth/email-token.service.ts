import { createHash, randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';

export type EmailTokenPurpose = 'verify_email' | 'reset_password';

const TTL_MS: Record<EmailTokenPurpose, number> = {
  verify_email: 24 * 60 * 60 * 1000,
  reset_password: 60 * 60 * 1000,
};

export function hashEmailToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function mintEmailToken(): string {
  return randomBytes(32).toString('base64url');
}

export class EmailTokenService {
  constructor(private readonly pool: Pool) {}

  async issue(
    userId: string,
    purpose: EmailTokenPurpose,
    client?: PoolClient,
  ): Promise<string> {
    const token = mintEmailToken();
    const tokenHash = hashEmailToken(token);
    const id = uuidv7();
    const expiresAt = new Date(Date.now() + TTL_MS[purpose]);

    const sql = `INSERT INTO identity.email_tokens
        (id, user_id, purpose, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)`;
    const params = [id, userId, purpose, tokenHash, expiresAt];

    if (client) {
      await client.query(sql, params);
    } else {
      await this.pool.query(sql, params);
    }
    return token;
  }

  async consume(
    token: string,
    purpose: EmailTokenPurpose,
  ): Promise<{ userId: string } | null> {
    const tokenHash = hashEmailToken(token);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query<{
        id: string;
        user_id: string;
        expires_at: Date;
        used_at: Date | null;
      }>(
        `SELECT id, user_id, expires_at, used_at
         FROM identity.email_tokens
         WHERE token_hash = $1 AND purpose = $2
         LIMIT 1
         FOR UPDATE`,
        [tokenHash, purpose],
      );
      const row = found.rows[0];
      if (!row || row.used_at || row.expires_at.getTime() <= Date.now()) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query(
        `UPDATE identity.email_tokens SET used_at = now() WHERE id = $1`,
        [row.id],
      );
      await client.query('COMMIT');
      return { userId: row.user_id };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
