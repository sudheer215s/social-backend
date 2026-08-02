import {
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  createConsumer,
  createKafka,
  createProducer,
} from '@social/platform-events';
import { createRedisClient, type RedisClient } from '@social/platform-redis';
import { HealthService } from '@social/platform-telemetry';
import type { Consumer, Producer } from 'kafkajs';
import { JwtAuthGuard } from './auth/jwt.guard';
import { startFanoutConsumer } from './fanout/fanout.consumer';
import { HealthController } from './health.controller';
import { MetricsController } from './metrics.controller';
import { TimelineController } from './timeline/timeline.controller';
import { TimelineService } from './timeline/timeline.service';
import { TimelineStore } from './timeline/timeline.store';

export const REDIS = Symbol('REDIS');
export const TIMELINE_STORE = Symbol('TIMELINE_STORE');

@Module({
  controllers: [TimelineController, HealthController, MetricsController],
  providers: [
    {
      provide: REDIS,
      useFactory: (): RedisClient =>
        createRedisClient(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'),
    },
    {
      provide: TIMELINE_STORE,
      inject: [REDIS],
      useFactory: (redis: RedisClient) => new TimelineStore(redis),
    },
    {
      provide: TimelineService,
      inject: [TIMELINE_STORE],
      useFactory: (store: TimelineStore) =>
        new TimelineService(
          store,
          process.env.GRAPH_BASE_URL ?? 'http://127.0.0.1:3003',
          process.env.POST_BASE_URL ?? 'http://127.0.0.1:3002',
        ),
    },
    {
      provide: HealthService,
      inject: [REDIS],
      useFactory: (redis: RedisClient) =>
        new HealthService({
          probes: [
            {
              name: 'redis',
              check: async () => {
                try {
                  return (await redis.ping()) === 'PONG';
                } catch {
                  return false;
                }
              },
            },
          ],
        }),
    },
    JwtAuthGuard,
  ],
})
export class AppModule implements OnModuleInit, OnModuleDestroy {
  private consumer: Consumer | undefined;
  private producer: Producer | undefined;
  private stopConsumer: (() => Promise<void>) | undefined;
  private redis: RedisClient | undefined;

  async onModuleInit(): Promise<void> {
    this.redis = createRedisClient(
      process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    );
    if (process.env.KAFKA_DISABLED === '1') return;
    try {
      const kafka = createKafka('timeline-service');
      this.producer = await createProducer(kafka);
      this.consumer = await createConsumer(kafka, 'timeline-fanout');
      const store = new TimelineStore(this.redis);
      const timelines = new TimelineService(
        store,
        process.env.GRAPH_BASE_URL ?? 'http://127.0.0.1:3003',
        process.env.POST_BASE_URL ?? 'http://127.0.0.1:3002',
      );
      this.stopConsumer = await startFanoutConsumer({
        consumer: this.consumer,
        producer: this.producer,
        timelines,
        onError: (err) => {
          console.error('[timeline-fanout]', err);
        },
        onDlq: (info) => {
          console.error(
            `[timeline-dlq] ${info.errorClass}: ${info.errorMessage}`,
            info.envelope.eventId,
          );
        },
      });
    } catch (err) {
      console.warn('[timeline-service] Kafka consumer not started', err);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.stopConsumer) await this.stopConsumer();
    if (this.producer) await this.producer.disconnect();
    this.redis?.disconnect();
  }
}
