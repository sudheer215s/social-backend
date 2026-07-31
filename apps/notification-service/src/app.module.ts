import {
  Inject,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { checkDatabase, createPool } from '@social/platform-db';
import {
  createConsumer,
  createKafka,
  createProducer,
  startReliableConsumer,
} from '@social/platform-events';
import { HealthService } from '@social/platform-telemetry';
import type { Consumer, Producer } from 'kafkajs';
import type { Pool } from 'pg';
import { JwtAuthGuard } from './auth/jwt.guard';
import { applyMigrations, defaultMigrationsDir } from './db/migrate';
import { HealthController } from './health.controller';
import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';

export const PG_POOL = Symbol('PG_POOL');

const CONSUMER_GROUP = 'notification-processor';

@Module({
  controllers: [NotificationsController, HealthController],
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
      provide: NotificationsService,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new NotificationsService(pool),
    },
    JwtAuthGuard,
  ],
})
export class AppModule implements OnModuleInit, OnModuleDestroy {
  private consumer: Consumer | undefined;
  private producer: Producer | undefined;
  private stopConsumer: (() => Promise<void>) | undefined;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.NOTIF_SKIP_MIGRATE !== '1') {
      await applyMigrations(this.pool, defaultMigrationsDir());
    }
    if (process.env.KAFKA_DISABLED === '1') return;
    try {
      const kafka = createKafka('notification-service');
      this.producer = await createProducer(kafka);
      this.consumer = await createConsumer(kafka, CONSUMER_GROUP);
      this.stopConsumer = await startReliableConsumer({
        consumer: this.consumer,
        producer: this.producer,
        topics: ['social.graph.v1', 'social.post.v1'],
        consumerGroup: CONSUMER_GROUP,
        handler: async (envelope) => {
          await this.notifications.processDomainEvent({
            eventId: envelope.eventId,
            eventType: envelope.eventType,
            payload: envelope.payload,
          });
        },
        onDlq: (info) => {
          // eslint-disable-next-line no-console
          console.error(
            `[notification-dlq] ${info.errorClass}: ${info.errorMessage}`,
            info.envelope.eventId,
          );
        },
        onError: (err) => {
          // eslint-disable-next-line no-console
          console.error('[notification-consumer]', err);
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[notification-service] Kafka not started', err);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.stopConsumer) await this.stopConsumer();
    if (this.producer) await this.producer.disconnect();
    await this.pool.end();
  }
}
