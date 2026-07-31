import {
  Inject,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  createConsumer,
  createKafka,
  createProducer,
  startReliableConsumer,
} from '@social/platform-events';
import { HealthService } from '@social/platform-telemetry';
import type { Consumer, Producer } from 'kafkajs';
import { HealthController } from './health.controller';
import { EsClient } from './search/es.client';
import { SearchController } from './search/search.controller';
import { SearchService } from './search/search.service';

export const ES_CLIENT = Symbol('ES_CLIENT');

const CONSUMER_GROUP = 'search-indexer';

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
  private producer: Producer | undefined;
  private stopConsumer: (() => Promise<void>) | undefined;

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
      this.producer = await createProducer(kafka);
      this.consumer = await createConsumer(kafka, CONSUMER_GROUP);
      this.stopConsumer = await startReliableConsumer({
        consumer: this.consumer,
        producer: this.producer,
        topics: ['social.post.v1', 'social.user.v1'],
        consumerGroup: CONSUMER_GROUP,
        handler: async (envelope) => {
          await this.search.processDomainEvent({
            eventType: envelope.eventType,
            payload: envelope.payload,
          });
        },
        onDlq: (info) => {
          // eslint-disable-next-line no-console
          console.error(
            `[search-dlq] ${info.errorClass}: ${info.errorMessage}`,
            info.envelope.eventId,
          );
        },
        onError: (err) => {
          // eslint-disable-next-line no-console
          console.error('[search-indexer]', err);
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[search-service] Kafka not started', err);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.stopConsumer) await this.stopConsumer();
    if (this.producer) await this.producer.disconnect();
  }
}
