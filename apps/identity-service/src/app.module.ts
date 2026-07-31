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
import { applyMigrations, defaultMigrationsDir } from './db/migrate';
import { HealthController } from './health.controller';

export const PG_POOL = Symbol('PG_POOL');

@Global()
@Module({
  controllers: [AuthController, HealthController],
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
      provide: HealthService,
      inject: [PG_POOL],
      useFactory: (pool: Pool) =>
        new HealthService({
          probes: [{ name: 'postgres', check: () => checkDatabase(pool) }],
        }),
    },
    {
      provide: AuthService,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new AuthService(pool),
    },
  ],
  exports: [PG_POOL, AuthService],
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
