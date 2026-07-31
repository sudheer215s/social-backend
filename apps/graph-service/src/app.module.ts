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
import { CascadeService, startCascadeWorker } from './cascade/cascade.service';
import { applyMigrations, defaultMigrationsDir } from './db/migrate';
import { GraphController } from './graph/graph.controller';
import { GraphService } from './graph/graph.service';
import { HealthController } from './health.controller';

export const PG_POOL = Symbol('PG_POOL');

@Module({
  controllers: [GraphController, HealthController],
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
            { name: 'kafka', check: () => checkKafka('graph-health') },
          ],
        }),
    },
    {
      provide: GraphService,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new GraphService(pool),
    },
    {
      provide: CascadeService,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new CascadeService(pool),
    },
    JwtAuthGuard,
  ],
})
export class AppModule implements OnModuleInit, OnModuleDestroy {
  private producer: Producer | undefined;
  private cascadeConsumer: Consumer | undefined;
  private stopRelay: (() => void) | undefined;
  private stopCascadeConsumer: (() => Promise<void>) | undefined;
  private stopCascadeWorker: (() => void) | undefined;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CascadeService) private readonly cascade: CascadeService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.GRAPH_SKIP_MIGRATE !== '1') {
      await applyMigrations(this.pool, defaultMigrationsDir());
    }

    if (process.env.CASCADE_WORKER_DISABLED !== '1') {
      this.stopCascadeWorker = startCascadeWorker({
        service: this.cascade,
        intervalMs: Number(process.env.CASCADE_WORKER_INTERVAL_MS ?? 2_000),
        onError: (err) => {
          console.error('[graph-cascade-worker]', err);
        },
      }).stop;
    }

    if (process.env.KAFKA_DISABLED === '1') return;
    try {
      const kafka = createKafka('graph-service');
      this.producer = await createProducer(kafka);
      this.stopRelay = startOutboxRelay({
        pool: this.pool,
        schema: 'graph',
        producer: this.producer,
        intervalMs: 500,
        onError: (err) => {
          console.error('[graph-outbox-relay]', err);
        },
        onPoison: (event, error) => {
          console.error(
            `[graph-outbox-poison] id=${event.id} type=${event.eventType}`,
            error,
          );
        },
      }).stop;

      this.cascadeConsumer = await createConsumer(kafka, 'graph-cascade');
      this.stopCascadeConsumer = await startReliableConsumer({
        consumer: this.cascadeConsumer,
        producer: this.producer,
        topics: ['social.user.v1'],
        consumerGroup: 'graph-cascade',
        handler: async (envelope) => {
          await this.cascade.processDomainEvent({
            eventId: envelope.eventId,
            eventType: envelope.eventType,
            payload: envelope.payload,
          });
        },
        onDlq: (info) => {
          console.error(
            `[graph-cascade-dlq] ${info.errorClass}: ${info.errorMessage}`,
            info.envelope.eventId,
          );
        },
        onError: (err) => {
          console.error('[graph-cascade]', err);
        },
      });
    } catch (err) {
      console.warn('[graph-service] Kafka not fully started', err);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopCascadeWorker?.();
    this.stopRelay?.();
    if (this.stopCascadeConsumer) await this.stopCascadeConsumer();
    if (this.producer) await this.producer.disconnect();
    await this.pool.end();
  }
}
