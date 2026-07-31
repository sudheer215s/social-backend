import {
  Inject,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { createConsumer, createKafka } from '@social/platform-events';
import type { DomainEventEnvelope } from '@social/platform-events';
import { HealthService } from '@social/platform-telemetry';
import type { Consumer } from 'kafkajs';
import { HealthController } from './health.controller';
import { EsClient } from './search/es.client';
import { SearchController } from './search/search.controller';
import { SearchService } from './search/search.service';

export const ES_CLIENT = Symbol('ES_CLIENT');

@Module({
  controllers: [SearchController, HealthController],
  providers: [
    {
      provide: ES_CLIENT,
      useFactory: (): EsClient =>
        new EsClient(process.env.ELASTICSEARCH_URL ?? 'http://127.0.0.1:9200'),
    },
    {
      provide: SearchService,
      inject: [ES_CLIENT],
      useFactory: (es: EsClient) => new SearchService(es),
    },
    {
      provide: HealthService,
      inject: [ES_CLIENT],
      useFactory: (es: EsClient) =>
        new HealthService({
          probes: [
            {
              name: 'elasticsearch',
              check: () => es.ping(),
            },
          ],
        }),
    },
  ],
})
export class AppModule implements OnModuleInit, OnModuleDestroy {
  private consumer: Consumer | undefined;

  constructor(@Inject(SearchService) private readonly search: SearchService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.search.ensureIndices();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[search-service] index ensure failed', err);
    }

    if (process.env.KAFKA_DISABLED === '1') return;
    try {
      const kafka = createKafka('search-service');
      this.consumer = await createConsumer(kafka, 'search-indexer');
      for (const topic of ['social.post.v1', 'social.user.v1']) {
        await this.consumer.subscribe({ topic, fromBeginning: false });
      }
      await this.consumer.run({
        eachMessage: async ({ message }) => {
          if (!message.value) return;
          try {
            const envelope = JSON.parse(
              message.value.toString('utf8'),
            ) as DomainEventEnvelope;
            await this.search.processDomainEvent({
              eventType: envelope.eventType,
              payload: envelope.payload,
            });
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[search-indexer]', err);
          }
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[search-service] Kafka not started', err);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.consumer) await this.consumer.disconnect();
  }
}
