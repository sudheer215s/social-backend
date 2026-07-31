import {
  Inject,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { checkDatabase, createPool } from '@social/platform-db';
import { HealthService } from '@social/platform-telemetry';
import type { Pool } from 'pg';
import { JwtAuthGuard } from './auth/jwt.guard';
import { applyMigrations, defaultMigrationsDir } from './db/migrate';
import { HealthController } from './health.controller';
import { PostsController } from './posts/posts.controller';
import { PostsService } from './posts/posts.service';

export const PG_POOL = Symbol('PG_POOL');

@Module({
  controllers: [PostsController, HealthController],
  providers: [
    {
      provide: PG_POOL,
      useFactory: (): Pool => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error('DATABASE_URL required');
        return createPool({
          connectionString: url,
          max: Number(process.env.DATABASE_POOL_MAX ?? 5),
        });
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
      provide: PostsService,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new PostsService(pool),
    },
    JwtAuthGuard,
  ],
})
export class AppModule implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleInit(): Promise<void> {
    if (process.env.POST_SKIP_MIGRATE === '1') return;
    await applyMigrations(this.pool, defaultMigrationsDir());
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
