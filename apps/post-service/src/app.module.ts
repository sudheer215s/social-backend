import {
  Inject,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { checkDatabase, createPool } from '@social/platform-db';
import {
  createKafka,
  createProducer,
  startOutboxRelay,
} from '@social/platform-events';
import { HealthService } from '@social/platform-telemetry';
import type { Producer } from 'kafkajs';
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
  private producer: Producer | undefined;
  private stopRelay: (() => void) | undefined;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleInit(): Promise<void> {
    if (process.env.POST_SKIP_MIGRATE !== '1') {
      await applyMigrations(this.pool, defaultMigrationsDir());
    }
    if (process.env.KAFKA_DISABLED === '1') {
      return;
    }
    try {
      const kafka = createKafka('post-service');
      this.producer = await createProducer(kafka);
      this.stopRelay = startOutboxRelay({
        pool: this.pool,
        schema: 'post',
        producer: this.producer,
        intervalMs: 500,
        onError: (err) => {
          console.error('[post-outbox-relay]', err);
        },
      }).stop;
    } catch (err) {
      console.warn('[post-service] Kafka relay not started', err);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopRelay?.();
    if (this.producer) {
      await this.producer.disconnect();
    }
    await this.pool.end();
  }
}
