import {
  Global,
  Inject,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { checkDatabase, createPool } from '@social/platform-db';
import { HealthService } from '@social/platform-telemetry';
import type { Pool } from 'pg';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { EmailTokenService } from './auth/email-token.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { applyMigrations, defaultMigrationsDir } from './db/migrate';
import { ConsoleEmailAdapter } from './email/console-email.adapter';
import { HealthController } from './health.controller';
import { createDevKeyRing, JwtKeyRing } from './tokens/jwt-keys';
import { SessionService } from './tokens/session.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';

export const PG_POOL = Symbol('PG_POOL');
export const JWT_KEYS = Symbol('JWT_KEYS');

@Global()
@Module({
  controllers: [AuthController, UsersController, HealthController],
  providers: [
    {
      provide: PG_POOL,
      useFactory: (): Pool => {
        const url = process.env.DATABASE_URL;
        if (!url) {
          throw new Error('DATABASE_URL is required for identity-service');
        }
        const rawMax = Number(process.env.DATABASE_POOL_MAX ?? 5);
        const max = Number.isFinite(rawMax)
          ? Math.min(Math.max(Math.floor(rawMax), 1), 10)
          : 5;
        return createPool({ connectionString: url, max });
      },
    },
    {
      provide: JWT_KEYS,
      useFactory: async (): Promise<JwtKeyRing> => createDevKeyRing(),
    },
    ConsoleEmailAdapter,
    {
      provide: HealthService,
      inject: [PG_POOL],
      useFactory: (pool: Pool) =>
        new HealthService({
          probes: [{ name: 'postgres', check: () => checkDatabase(pool) }],
        }),
    },
    {
      provide: SessionService,
      inject: [PG_POOL, JWT_KEYS],
      useFactory: (pool: Pool, keys: JwtKeyRing) =>
        new SessionService(pool, keys),
    },
    {
      provide: EmailTokenService,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new EmailTokenService(pool),
    },
    {
      provide: AuthService,
      inject: [PG_POOL, SessionService, EmailTokenService, ConsoleEmailAdapter],
      useFactory: (
        pool: Pool,
        sessions: SessionService,
        emailTokens: EmailTokenService,
        email: ConsoleEmailAdapter,
      ) => new AuthService(pool, sessions, emailTokens, email),
    },
    {
      provide: UsersService,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new UsersService(pool),
    },
    {
      provide: JwtKeyRing,
      inject: [JWT_KEYS],
      useFactory: (keys: JwtKeyRing) => keys,
    },
    JwtAuthGuard,
  ],
  exports: [
    PG_POOL,
    AuthService,
    UsersService,
    JwtKeyRing,
    SessionService,
    ConsoleEmailAdapter,
  ],
})
export class AppModule implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleInit(): Promise<void> {
    if (process.env.IDENTITY_SKIP_MIGRATE === '1') {
      return;
    }
    await applyMigrations(this.pool, defaultMigrationsDir());
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
