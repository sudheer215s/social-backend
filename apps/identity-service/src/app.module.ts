import {
  Global,
  Inject,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { checkDatabase, createPool } from '@social/platform-db';
import {
  createRedisClient,
  MemorySidRevocationStore,
  NoopSidRevocationStore,
  RedisSidRevocationStore,
  type RedisClient,
  type SidRevocationStore,
} from '@social/platform-redis';
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
import { IdentityGrpcController } from './grpc/identity.grpc.controller';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';

export const PG_POOL = Symbol('PG_POOL');
export const JWT_KEYS = Symbol('JWT_KEYS');
export const REDIS = Symbol('REDIS');
export const SID_REVOCATION = Symbol('SID_REVOCATION');

@Global()
@Module({
  controllers: [
    AuthController,
    UsersController,
    HealthController,
    IdentityGrpcController,
  ],
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
      provide: REDIS,
      useFactory: (): RedisClient | null => {
        if (process.env.REDIS_DISABLED === '1') {
          return null;
        }
        try {
          return createRedisClient(
            process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
          );
        } catch {
          return null;
        }
      },
    },
    {
      provide: SID_REVOCATION,
      inject: [REDIS],
      useFactory: (redis: RedisClient | null): SidRevocationStore => {
        if (process.env.NODE_ENV === 'test' && !redis) {
          return new MemorySidRevocationStore();
        }
        if (!redis) {
          return new NoopSidRevocationStore();
        }
        return new RedisSidRevocationStore(redis);
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
      inject: [PG_POOL, JWT_KEYS, SID_REVOCATION],
      useFactory: (
        pool: Pool,
        keys: JwtKeyRing,
        revocation: SidRevocationStore,
      ) => new SessionService(pool, keys, revocation),
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
      inject: [PG_POOL, SessionService],
      useFactory: (pool: Pool, sessions: SessionService) =>
        new UsersService(pool, sessions),
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
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: RedisClient | null,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.IDENTITY_SKIP_MIGRATE === '1') {
      return;
    }
    await applyMigrations(this.pool, defaultMigrationsDir());
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
    if (this.redis) {
      this.redis.disconnect();
    }
  }
}
