import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '@social/platform-db';
import { uuidv7 } from 'uuidv7';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  hashRefreshToken,
  JwtKeyRing,
  mintRefreshToken,
  REFRESH_TOKEN_TTL_SECONDS,
} from './jwt-keys';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  sessionId: string;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly pool: Pool,
    private readonly keys: JwtKeyRing,
  ) {}

  async issueSession(
    userId: string,
    meta?: { userAgent?: string; ipHash?: Buffer },
    client?: PoolClient,
  ): Promise<TokenPair> {
    const sessionId = uuidv7();
    const familyId = uuidv7();
    const refresh = mintRefreshToken();
    const refreshHash = hashRefreshToken(refresh);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);

    const run = async (c: PoolClient) => {
      await c.query(
        `INSERT INTO identity.sessions
           (id, family_id, user_id, refresh_token_hash, user_agent, ip_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          sessionId,
          familyId,
          userId,
          refreshHash,
          meta?.userAgent ?? null,
          meta?.ipHash ?? null,
          expiresAt,
        ],
      );
    };

    if (client) {
      await run(client);
    } else {
      await withTransaction(this.pool, run);
    }

    const accessToken = await this.keys.signAccessToken({
      sub: userId,
      sid: sessionId,
      scope: ['user'],
    });

    return {
      accessToken,
      refreshToken: refresh,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      sessionId,
    };
  }

  /**
   * Rotate refresh token. Reuse of a previous token revokes the whole family.
   * Revocation on reuse is committed before the 401 is thrown.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const presentedHash = hashRefreshToken(refreshToken);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`
        SET LOCAL statement_timeout = 5000;
        SET LOCAL lock_timeout = 3000;
        SET LOCAL idle_in_transaction_session_timeout = 10000;
      `);

      const found = await client.query<{
        id: string;
        family_id: string;
        user_id: string;
        refresh_token_hash: Buffer;
        prev_token_hash: Buffer | null;
        expires_at: Date;
        revoked_at: Date | null;
      }>(
        `SELECT id, family_id, user_id, refresh_token_hash, prev_token_hash,
                expires_at, revoked_at
         FROM identity.sessions
         WHERE refresh_token_hash = $1 OR prev_token_hash = $1
         LIMIT 1
         FOR UPDATE`,
        [presentedHash],
      );

      const row = found.rows[0];
      if (!row || row.revoked_at) {
        await client.query('ROLLBACK');
        throw new UnauthorizedException('Invalid refresh token');
      }

      // Reuse: presented hash is the previous token, not the current one.
      if (
        row.prev_token_hash &&
        buffersEqual(row.prev_token_hash, presentedHash) &&
        !buffersEqual(row.refresh_token_hash, presentedHash)
      ) {
        await client.query(
          `UPDATE identity.sessions
           SET revoked_at = now()
           WHERE family_id = $1 AND revoked_at IS NULL`,
          [row.family_id],
        );
        await client.query('COMMIT');
        throw new UnauthorizedException('Refresh token reuse detected');
      }

      if (row.expires_at.getTime() <= Date.now()) {
        await client.query('ROLLBACK');
        throw new UnauthorizedException('Invalid refresh token');
      }

      if (!buffersEqual(row.refresh_token_hash, presentedHash)) {
        await client.query('ROLLBACK');
        throw new UnauthorizedException('Invalid refresh token');
      }

      const newRefresh = mintRefreshToken();
      const newHash = hashRefreshToken(newRefresh);
      const newExpires = new Date(
        Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000,
      );

      await client.query(
        `UPDATE identity.sessions
         SET prev_token_hash = refresh_token_hash,
             refresh_token_hash = $2,
             last_used_at = now(),
             expires_at = $3
         WHERE id = $1`,
        [row.id, newHash, newExpires],
      );
      await client.query('COMMIT');

      const accessToken = await this.keys.signAccessToken({
        sub: row.user_id,
        sid: row.id,
        scope: ['user'],
      });

      return {
        accessToken,
        refreshToken: newRefresh,
        tokenType: 'Bearer',
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        sessionId: row.id,
      };
    } catch (err) {
      // Only roll back if we are still in a transaction (non-reuse path errors
      // after BEGIN). COMMIT already closed the reuse path.
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

  async revokeByRefreshToken(refreshToken: string): Promise<void> {
    const h = hashRefreshToken(refreshToken);
    await this.pool.query(
      `UPDATE identity.sessions
       SET revoked_at = now()
       WHERE (refresh_token_hash = $1 OR prev_token_hash = $1)
         AND revoked_at IS NULL`,
      [h],
    );
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.pool.query(
      `UPDATE identity.sessions SET revoked_at = now()
       WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId],
    );
  }

  async revokeAllForUser(userId: string, client?: PoolClient): Promise<void> {
    const sql = `UPDATE identity.sessions
       SET revoked_at = now()
       WHERE user_id = $1 AND revoked_at IS NULL`;
    if (client) {
      await client.query(sql, [userId]);
    } else {
      await this.pool.query(sql, [userId]);
    }
  }
}

function buffersEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return a.equals(b);
}
