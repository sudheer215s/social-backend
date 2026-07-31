import type { Consumer, EachMessagePayload, Producer } from 'kafkajs';
import {
  classifyError,
  decodeRetryHeaders,
  parseTopicLadder,
  publishDlq,
  publishRetry,
  RETRY_TIERS,
  sleep,
} from './retry';
import type { DomainEventEnvelope, ErrorClass } from './types';

export type EventHandler = (
  envelope: DomainEventEnvelope,
  meta: { topic: string; partition: number; retryTier: number },
) => Promise<void>;

export interface ReliableConsumerOptions {
  consumer: Consumer;
  producer: Producer;
  /** Main domain topics (not retry/dlq). */
  topics: string[];
  consumerGroup: string;
  handler: EventHandler;
  /** Also subscribe to retry ladder topics for each main topic. Default true. */
  subscribeRetryTopics?: boolean;
  onDlq?: (info: {
    baseTopic: string;
    errorClass: ErrorClass;
    errorMessage: string;
    envelope: DomainEventEnvelope;
  }) => void;
  onRetry?: (info: {
    baseTopic: string;
    tierIndex: number;
    topic: string;
    errorClass: ErrorClass;
  }) => void;
  onDrop?: (info: {
    baseTopic: string;
    errorClass: ErrorClass;
    envelope: DomainEventEnvelope;
  }) => void;
  onError?: (err: unknown) => void;
  /** Cap wait when a retry message arrives early (ms). Default 60_000. */
  maxSleepMs?: number;
  now?: () => number;
}

/**
 * Run a consumer that never blocks the *main* partition on handler failure:
 * failures are published to the retry ladder or DLQ, then the offset advances.
 *
 * Retry-topic partitions may sleep until due (non-blocking for main topics).
 */
export async function startReliableConsumer(
  options: ReliableConsumerOptions,
): Promise<() => Promise<void>> {
  const subscribeRetry = options.subscribeRetryTopics !== false;
  const maxSleepMs = options.maxSleepMs ?? 60_000;
  const now = options.now ?? (() => Date.now());

  const topics = new Set<string>();
  for (const t of options.topics) {
    topics.add(t);
    if (subscribeRetry) {
      for (let i = 0; i < RETRY_TIERS.length; i++) {
        topics.add(`${t}.${RETRY_TIERS[i]!.name}`);
      }
    }
  }

  for (const topic of topics) {
    await options.consumer.subscribe({ topic, fromBeginning: false });
  }

  await options.consumer.run({
    eachMessage: async (payload) => {
      try {
        await handleOne(payload, options, maxSleepMs, now);
      } catch (err) {
        // Last-resort: still do not throw (would block partition / crash loop).
        options.onError?.(err);
        try {
          await forceDlqFromRaw(payload, options, err);
        } catch (dlqErr) {
          options.onError?.(dlqErr);
        }
      }
    },
  });

  return async () => {
    await options.consumer.disconnect();
  };
}

async function handleOne(
  payload: EachMessagePayload,
  options: ReliableConsumerOptions,
  maxSleepMs: number,
  now: () => number,
): Promise<void> {
  const { topic, message, partition } = payload;
  if (!message.value) return;

  const parsed = parseTopicLadder(topic);
  if (parsed.isDlq) {
    // Never auto-process DLQ; redrive is manual.
    return;
  }

  const headers = decodeRetryHeaders(message.headers);
  const baseTopic = headers.originalTopic || parsed.baseTopic;
  const retryTier =
    typeof headers.retryTier === 'number' && !Number.isNaN(headers.retryTier)
      ? headers.retryTier
      : parsed.tierIndex >= 0
        ? parsed.tierIndex
        : -1;

  // Wait out due-time only on retry topics (main topic never sleeps).
  if (retryTier >= 0 && headers.dueAtMs && headers.dueAtMs > now()) {
    const wait = Math.min(headers.dueAtMs - now(), maxSleepMs);
    if (wait > 0) await sleep(wait);
  }

  let envelope: DomainEventEnvelope;
  try {
    envelope = JSON.parse(message.value.toString('utf8')) as DomainEventEnvelope;
    if (!envelope || typeof envelope.eventId !== 'string') {
      throw new SyntaxError('invalid domain envelope');
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await publishDlq(options.producer, {
      baseTopic,
      key: message.key?.toString() ?? null,
      envelope: poisonEnvelope(message.value.toString('utf8')),
      errorClass: 'poison',
      errorMessage,
      consumerGroup: options.consumerGroup,
      retryTierExhausted: Math.max(retryTier, 0),
    });
    options.onDlq?.({
      baseTopic,
      errorClass: 'poison',
      errorMessage,
      envelope: poisonEnvelope(message.value.toString('utf8')),
    });
    return;
  }

  try {
    await options.handler(envelope, {
      topic,
      partition,
      retryTier: Math.max(retryTier, -1),
    });
  } catch (err) {
    const errorClass = classifyError(err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    await routeFailure({
      options,
      baseTopic,
      key: message.key?.toString() ?? null,
      envelope,
      errorClass,
      errorMessage,
      currentTier: retryTier,
    });
  }
}

async function routeFailure(input: {
  options: ReliableConsumerOptions;
  baseTopic: string;
  key: string | null;
  envelope: DomainEventEnvelope;
  errorClass: ErrorClass;
  errorMessage: string;
  currentTier: number;
}): Promise<void> {
  const { options, baseTopic, key, envelope, errorClass, errorMessage } =
    input;
  // currentTier -1 means main topic; next tier is 0.
  const nextTier = input.currentTier + 1;

  if (errorClass === 'poison') {
    await publishDlq(options.producer, {
      baseTopic,
      key,
      envelope,
      errorClass,
      errorMessage,
      consumerGroup: options.consumerGroup,
      retryTierExhausted: Math.max(input.currentTier + 1, 0),
    });
    options.onDlq?.({ baseTopic, errorClass, errorMessage, envelope });
    return;
  }

  // Semantic failures drop after last tier (referent likely gone).
  if (nextTier >= RETRY_TIERS.length) {
    if (errorClass === 'semantic') {
      options.onDrop?.({ baseTopic, errorClass, envelope });
      return;
    }
    await publishDlq(options.producer, {
      baseTopic,
      key,
      envelope,
      errorClass,
      errorMessage,
      consumerGroup: options.consumerGroup,
      retryTierExhausted: RETRY_TIERS.length,
    });
    options.onDlq?.({ baseTopic, errorClass, errorMessage, envelope });
    return;
  }

  const topic = await publishRetry(options.producer, {
    baseTopic,
    tierIndex: nextTier,
    key,
    envelope,
    errorClass,
    errorMessage,
    consumerGroup: options.consumerGroup,
  });
  options.onRetry?.({
    baseTopic,
    tierIndex: nextTier,
    topic,
    errorClass,
  });
}

function poisonEnvelope(raw: string): DomainEventEnvelope {
  return {
    eventId: '00000000-0000-0000-0000-000000000000',
    eventType: 'poison.invalid',
    aggregateType: 'unknown',
    aggregateId: 'unknown',
    occurredAt: new Date().toISOString(),
    payload: { raw: raw.slice(0, 4000) },
  };
}

async function forceDlqFromRaw(
  payload: EachMessagePayload,
  options: ReliableConsumerOptions,
  err: unknown,
): Promise<void> {
  const { topic, message } = payload;
  const { baseTopic } = parseTopicLadder(topic);
  const raw = message.value?.toString('utf8') ?? '';
  let envelope: DomainEventEnvelope;
  try {
    envelope = JSON.parse(raw) as DomainEventEnvelope;
  } catch {
    envelope = poisonEnvelope(raw);
  }
  await publishDlq(options.producer, {
    baseTopic,
    key: message.key?.toString() ?? null,
    envelope,
    errorClass: 'poison',
    errorMessage: err instanceof Error ? err.message : String(err),
    consumerGroup: options.consumerGroup,
    retryTierExhausted: 0,
  });
}
