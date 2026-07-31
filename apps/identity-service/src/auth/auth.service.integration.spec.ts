/**
 * Integration: auth + email verify + password reset through PgBouncer.
 */
import { createPool } from '@social/platform-db';
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import path from 'node:path';
import { applyMigrations } from '../db/migrate';
import { createDevKeyRing } from '../tokens/jwt-keys';
import { SessionService } from '../tokens/session.service';
import { ConsoleEmailAdapter } from '../email/console-email.adapter';
import { AuthService } from './auth.service';
import { EmailTokenService } from './email-token.service';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://social:social@127.0.0.1:6432/social';

describe('AuthService email + tokens (integration)', () => {
  const pool = createPool({ connectionString, max: 3 });
  let auth: AuthService;
  let mail: ConsoleEmailAdapter;
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
      const emailTokens = new EmailTokenService(pool);
      mail = new ConsoleEmailAdapter();
      auth = new AuthService(pool, sessions, emailTokens, mail);
      available = true;
    } catch (err) {
      console.warn('Skipping identity integration tests', err);
      available = false;
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('registers, sends verify email, and verifies', async () => {
    if (!available) return;
    mail.clear();
    const email = `verify_${suffix}@example.com`;
    const result = await auth.register({
      username: `verify_${suffix}`,
      email,
      password: 'long-enough-password',
    });
    expect(result.user.emailVerified).toBe(false);
    const msg = mail.lastTo(email);
    expect(msg?.text).toMatch(/verification token:/i);
    const token = msg!.text.split('token: ')[1]!.trim();

    await expect(auth.verifyEmail({ token })).resolves.toEqual({
      verified: true,
    });
    const row = await pool.query<{ email_verified: boolean }>(
      `SELECT email_verified FROM identity.users WHERE id = $1`,
      [result.user.id],
    );
    expect(row.rows[0]?.email_verified).toBe(true);

    await expect(auth.verifyEmail({ token })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('forgot password always looks the same; reset revokes sessions', async () => {
    if (!available) return;
    mail.clear();
    const email = `reset_${suffix}@example.com`;
    const password = 'long-enough-password';
    const registered = await auth.register({
      username: `reset_${suffix}`,
      email,
      password,
    });
    const session = registered.tokens;

    const missing = await auth.forgotPassword({
      email: `nope_${suffix}@example.com`,
    });
    const existing = await auth.forgotPassword({ email });
    expect(existing).toEqual(missing);

    const msg = mail.lastTo(email);
    expect(msg?.text).toMatch(/reset token:/i);
    const token = msg!.text.split('token: ')[1]!.trim();

    await auth.resetPassword({
      token,
      newPassword: 'brand-new-password-99',
    });

    await expect(auth.refresh(session.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      auth.login({ identifier: email, password }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const again = await auth.login({
      identifier: email,
      password: 'brand-new-password-99',
    });
    expect(again.user.id).toBe(registered.user.id);
  });

  it('rotates refresh and detects reuse', async () => {
    if (!available) return;
    const registered = await auth.register({
      username: `rot_${suffix}`,
      email: `rot_${suffix}@example.com`,
      password: 'long-enough-password',
    });
    const first = registered.tokens.refreshToken;
    const rotated = await auth.refresh(first);
    const rotated2 = await auth.refresh(rotated.refreshToken);
    await expect(auth.refresh(rotated.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(auth.refresh(rotated2.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects duplicate registration', async () => {
    if (!available) return;
    const email = `dup3_${suffix}@example.com`;
    await auth.register({
      username: `dup3_${suffix}`,
      email,
      password: 'long-enough-password',
    });
    await expect(
      auth.register({
        username: `other3_${suffix}`,
        email,
        password: 'long-enough-password',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
