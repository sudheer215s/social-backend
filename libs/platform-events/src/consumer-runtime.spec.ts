import type { Consumer, Producer } from 'kafkajs';
import { startReliableConsumer } from './consumer-runtime';
import { HandlerError } from './retry';
import type { DomainEventEnvelope } from './types';

function envelope(over: Partial<DomainEventEnvelope> = {}): DomainEventEnvelope {
  return {
    eventId: '11111111-1111-1111-1111-111111111111',
    eventType: 'post.created',
    aggregateType: 'post',
    aggregateId: 'p1',
    occurredAt: new Date().toISOString(),
    payload: { postId: 'p1' },
    ...over,
  };
}

describe('startReliableConsumer', () => {
  it('routes poison deserialisation to DLQ without throwing', async () => {
    let eachMessage:
      | ((p: {
          topic: string;
          partition: number;
          message: {
            value: Buffer;
            key: Buffer | null;
            headers?: Record<string, Buffer>;
          };
        }) => Promise<void>)
      | undefined;

    const sent: { topic: string; value: string }[] = [];
    const consumer = {
      subscribe: jest.fn(async () => undefined),
      run: jest.fn(async (cfg: { eachMessage: typeof eachMessage }) => {
        eachMessage = cfg.eachMessage;
      }),
      disconnect: jest.fn(async () => undefined),
    } as unknown as Consumer;

    const producer = {
      send: jest.fn(async (req: { topic: string; messages: { value: string }[] }) => {
        sent.push({
          topic: req.topic,
          value: String(req.messages[0]?.value ?? ''),
        });
      }),
    } as unknown as Producer;

    const dlq: string[] = [];
    await startReliableConsumer({
      consumer,
      producer,
      topics: ['social.post.v1'],
      consumerGroup: 'test-group',
      handler: async () => undefined,
      onDlq: () => dlq.push('hit'),
    });

    expect(eachMessage).toBeDefined();
    await eachMessage!({
      topic: 'social.post.v1',
      partition: 0,
      message: {
        value: Buffer.from('not-json{{{'),
        key: Buffer.from('k1'),
      },
    });

    expect(dlq).toEqual(['hit']);
    expect(sent.some((s) => s.topic === 'social.post.v1.dlq')).toBe(true);
  });

  it('publishes transient failures to first retry tier', async () => {
    let eachMessage:
      | ((p: {
          topic: string;
          partition: number;
          message: {
            value: Buffer;
            key: Buffer | null;
            headers?: Record<string, Buffer>;
          };
        }) => Promise<void>)
      | undefined;

    const sent: string[] = [];
    const consumer = {
      subscribe: jest.fn(async () => undefined),
      run: jest.fn(async (cfg: { eachMessage: typeof eachMessage }) => {
        eachMessage = cfg.eachMessage;
      }),
      disconnect: jest.fn(async () => undefined),
    } as unknown as Consumer;

    const producer = {
      send: jest.fn(async (req: { topic: string }) => {
        sent.push(req.topic);
      }),
    } as unknown as Producer;

    const retries: number[] = [];
    await startReliableConsumer({
      consumer,
      producer,
      topics: ['social.post.v1'],
      consumerGroup: 'test-group',
      handler: async () => {
        throw new HandlerError('db timeout', 'transient');
      },
      onRetry: (i) => retries.push(i.tierIndex),
    });

    await eachMessage!({
      topic: 'social.post.v1',
      partition: 0,
      message: {
        value: Buffer.from(JSON.stringify(envelope())),
        key: Buffer.from('k1'),
      },
    });

    expect(retries).toEqual([0]);
    expect(sent).toContain('social.post.v1.retry.5s');
  });

  it('drops semantic failures after the last retry tier', async () => {
    let eachMessage:
      | ((p: {
          topic: string;
          partition: number;
          message: {
            value: Buffer;
            key: Buffer | null;
            headers?: Record<string, Buffer>;
          };
        }) => Promise<void>)
      | undefined;

    const consumer = {
      subscribe: jest.fn(async () => undefined),
      run: jest.fn(async (cfg: { eachMessage: typeof eachMessage }) => {
        eachMessage = cfg.eachMessage;
      }),
      disconnect: jest.fn(async () => undefined),
    } as unknown as Consumer;

    const producer = {
      send: jest.fn(async () => undefined),
    } as unknown as Producer;

    const drops: string[] = [];
    await startReliableConsumer({
      consumer,
      producer,
      topics: ['social.post.v1'],
      consumerGroup: 'test-group',
      handler: async () => {
        throw new HandlerError('referent missing', 'semantic');
      },
      onDrop: () => drops.push('dropped'),
    });

    await eachMessage!({
      topic: 'social.post.v1.retry.10m',
      partition: 0,
      message: {
        value: Buffer.from(JSON.stringify(envelope())),
        key: null,
        headers: {
          'x-original-topic': Buffer.from('social.post.v1'),
          'x-retry-tier': Buffer.from('2'),
          'x-due-at-ms': Buffer.from(String(Date.now() - 1000)),
          'x-error-class': Buffer.from('semantic'),
          'x-error-message': Buffer.from('missing'),
          'x-consumer-group': Buffer.from('test-group'),
        },
      },
    });

    expect(drops).toEqual(['dropped']);
    expect(producer.send).not.toHaveBeenCalled();
  });
});
