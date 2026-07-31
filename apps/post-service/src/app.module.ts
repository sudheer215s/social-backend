import {
  Inject,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { checkDatabase, createPool } from '@social/platform-db';
import {
  checkKafka,
  createConsumer,
  createKafka,
  createProducer,
  startOutboxRelay,
  startReliableConsumer,
} from '@social/platform-events';
import { HealthService } from '@social/platform-telemetry';
import type { Consumer, Producer } from 'kafkajs';
import type { Pool } from 'pg';
import { JwtAuthGuard } from './auth/jwt.guard';
import { AuthorCascadeService } from './cascade/author-cascade.service';
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
          probes: [
            { name: 'postgres', check: () => checkDatabase(pool) },
            { name: 'kafka', check: () => checkKafka('post-health') },
          ],
        }),
    },
    {
      provide: PostsService,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new PostsService(pool),
    },
    {
      provide: AuthorCascadeService,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new AuthorCascadeService(pool),
    },
    JwtAuthGuard,
  ],
})
export class AppModule implements OnModuleInit, OnModuleDestroy {
  private producer: Producer | undefined;
  private cascadeConsumer: Consumer | undefined;
  private stopRelay: (() => void) | undefined;
  private stopCascade: (() => Promise<void>) | undefined;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(AuthorCascadeService)
    private readonly authorCascade: AuthorCascadeService,
  ) {}

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
        onPoison: (event, error) => {
          console.error(
            `[post-outbox-poison] id=${event.id} type=${event.eventType}`,
            error,
          );
        },
      }).stop;

      this.cascadeConsumer = await createConsumer(kafka, 'post-author-cascade');
      this.stopCascade = await startReliableConsumer({
        consumer: this.cascadeConsumer,
        producer: this.producer,
        topics: ['social.user.v1'],
        consumerGroup: 'post-author-cascade',
        handler: async (envelope) => {
          await this.authorCascade.processDomainEvent({
            eventId: envelope.eventId,
            eventType: envelope.eventType,
            payload: envelope.payload,
          });
        },
        onDlq: (info) => {
          console.error(
            `[post-author-cascade-dlq] ${info.errorClass}: ${info.errorMessage}`,
            info.envelope.eventId,
          );
        },
        onError: (err) => {
          console.error('[post-author-cascade]', err);
        },
      });
    } catch (err) {
      console.warn('[post-service] Kafka not fully started', err);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopRelay?.();
    if (this.stopCascade) await this.stopCascade();
    if (this.producer) {
      await this.producer.disconnect();
    }
    await this.pool.end();
  }
}
