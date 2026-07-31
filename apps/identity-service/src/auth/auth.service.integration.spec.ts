/**
 * Integration: register/login/refresh/reuse through PgBouncer.
 */
import { createPool } from '@social/platform-db';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import path from 'node:path';
import { applyMigrations } from '../db/migrate';
import { createDevKeyRing } from '../tokens/jwt-keys';
import { SessionService } from '../tokens/session.service';
import { AuthService } from './auth.service';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://social:social@127.0.0.1:6432/social';

describe('AuthService tokens (integration)', () => {
  const pool = createPool({ connectionString, max: 3 });
  let auth: AuthService;
  let keys: Awaited<ReturnType<typeof createDevKeyRing>>;
  let available = false;
  const suffix = Date.now().toString(36);

  beforeAll(async () => {
    try {
      await pool.query('SELECT 1');
      const migrationsDir = path.join(__dirname, '../db/migrations');
      await applyMigrations(pool, migrationsDir);
      keys = await createDevKeyRing({
        issuer: 'http://test',
        audience: 'api',
      });
      const sessions = new SessionService(pool, keys);
      auth = new AuthService(pool, sessions);
      available = true;
    } catch (err) {
      console.warn('Skipping identity integration tests', err);
      available = false;
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('registers and returns a verifiable access token + refresh', async () => {
    if (!available) return;
    const result = await auth.register({
      username: `tok_${suffix}`,
      email: `tok_${suffix}@example.com`,
      password: 'long-enough-password',
    });
    expect(result.tokens.accessToken).toBeTruthy();
    expect(result.tokens.refreshToken).toBeTruthy();
    const verified = await keys.verifyAccessToken(result.tokens.accessToken);
    expect(verified.sub).toBe(result.user.id);
    expect(verified.sid).toBe(result.tokens.sessionId);
  });

  it('rotates refresh tokens and rejects reuse of the old one', async () => {
    if (!available) return;
    const registered = await auth.register({
      username: `rot_${suffix}`,
      email: `rot_${suffix}@example.com`,
      password: 'long-enough-password',
    });
    const first = registered.tokens.refreshToken;

    const rotated = await auth.refresh(first);
    expect(rotated.refreshToken).not.toBe(first);
    const verified = await keys.verifyAccessToken(rotated.accessToken);
    expect(verified.sub).toBe(registered.user.id);

    // Second refresh with the new token works.
    const rotated2 = await auth.refresh(rotated.refreshToken);
    expect(rotated2.refreshToken).not.toBe(rotated.refreshToken);

    // Presenting the first (now previous) token after further rotation —
    // use the intermediate token as reuse after rotated2.
    await expect(auth.refresh(rotated.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    // Family should be dead: even the latest token fails.
    await expect(auth.refresh(rotated2.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('login issues tokens; logout revokes refresh', async () => {
    if (!available) return;
    const username = `out_${suffix}`;
    const password = 'long-enough-password';
    await auth.register({
      username,
      email: `out_${suffix}@example.com`,
      password,
    });
    const loggedIn = await auth.login({ identifier: username, password });
    await auth.logout(loggedIn.tokens.refreshToken);
    await expect(
      auth.refresh(loggedIn.tokens.refreshToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects duplicate registration', async () => {
    if (!available) return;
    const email = `dup2_${suffix}@example.com`;
    await auth.register({
      username: `dup2_${suffix}`,
      email,
      password: 'long-enough-password',
    });
    await expect(
      auth.register({
        username: `other2_${suffix}`,
        email,
        password: 'long-enough-password',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
