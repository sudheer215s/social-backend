import type { Producer } from 'kafkajs';
import type { DlqEnvelope, DomainEventEnvelope, ErrorClass } from './types';

/**
 * Non-blocking retry ladder (design §9.5):
 *   topic → .retry.5s → .retry.1m → .retry.10m → .dlq
 * In-process sleep only on *retry* partitions, never on the main topic.
 */
export const RETRY_TIERS = [
  { name: 'retry.5s', delayMs: 5_000 },
  { name: 'retry.1m', delayMs: 60_000 },
  { name: 'retry.10m', delayMs: 600_000 },
] as const;

export type RetryTierName = (typeof RETRY_TIERS)[number]['name'];

export function retryTopic(baseTopic: string, tierIndex: number): string {
  const tier = RETRY_TIERS[tierIndex];
  if (!tier) {
    throw new Error(`invalid retry tier ${tierIndex}`);
  }
  return `${baseTopic}.${tier.name}`;
}

export function dlqTopic(baseTopic: string): string {
  return `${baseTopic}.dlq`;
}

export function allRetryTopics(baseTopic: string): string[] {
  return RETRY_TIERS.map((_, i) => retryTopic(baseTopic, i));
}

export function ladderTopics(baseTopic: string): string[] {
  return [baseTopic, ...allRetryTopics(baseTopic), dlqTopic(baseTopic)];
}

/** Parse base topic + tier from a possibly-retry/dlq topic name. */
export function parseTopicLadder(topic: string): {
  baseTopic: string;
  tierIndex: number; // -1 = main, 0..n = retry, n+1 = dlq
  isDlq: boolean;
} {
  if (topic.endsWith('.dlq')) {
    return {
      baseTopic: topic.slice(0, -'.dlq'.length),
      tierIndex: RETRY_TIERS.length,
      isDlq: true,
    };
  }
  for (let i = RETRY_TIERS.length - 1; i >= 0; i--) {
    const suffix = `.${RETRY_TIERS[i]!.name}`;
    if (topic.endsWith(suffix)) {
      return {
        baseTopic: topic.slice(0, -suffix.length),
        tierIndex: i,
        isDlq: false,
      };
    }
  }
  return { baseTopic: topic, tierIndex: -1, isDlq: false };
}

/**
 * Classify handler failures for the ladder.
 * Poison goes straight to DLQ; transient/semantic climb the ladder.
 */
export function classifyError(err: unknown): ErrorClass {
  if (err instanceof HandlerError) {
    return err.errorClass;
  }
  if (err instanceof SyntaxError) {
    return 'poison';
  }
  if (err && typeof err === 'object' && 'name' in err) {
    const name = String((err as { name: string }).name);
    if (name === 'ZodError' || name === 'ValidationError') {
      return 'poison';
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/invalid json|unexpected token|schema|deserialize/i.test(msg)) {
    return 'poison';
  }
  if (/not found|missing referent|does not exist/i.test(msg)) {
    return 'semantic';
  }
  return 'transient';
}

export class HandlerError extends Error {
  readonly errorClass: ErrorClass;

  constructor(
    message: string,
    errorClass: ErrorClass,
    options?: { cause?: unknown },
  ) {
    super(
      message,
      options?.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = 'HandlerError';
    this.errorClass = errorClass;
  }
}

export interface RetryHeaders {
  originalTopic: string;
  retryTier: number;
  dueAtMs: number;
  errorClass: ErrorClass;
  errorMessage: string;
  consumerGroup: string;
}

export function encodeRetryHeaders(h: RetryHeaders): Record<string, string> {
  return {
    'x-original-topic': h.originalTopic,
    'x-retry-tier': String(h.retryTier),
    'x-due-at-ms': String(h.dueAtMs),
    'x-error-class': h.errorClass,
    'x-error-message': h.errorMessage.slice(0, 500),
    'x-consumer-group': h.consumerGroup,
  };
}

export function decodeRetryHeaders(
  headers:
    | Record<string, Buffer | string | (Buffer | string)[] | undefined>
    | undefined,
): Partial<RetryHeaders> {
  if (!headers) return {};
  const get = (k: string): string => {
    const v = headers[k];
    if (v == null) return '';
    if (Buffer.isBuffer(v)) return v.toString('utf8');
    if (Array.isArray(v)) {
      const first = v[0];
      return Buffer.isBuffer(first)
        ? first.toString('utf8')
        : String(first ?? '');
    }
    return String(v);
  };
  const tierRaw = get('x-retry-tier');
  const dueRaw = get('x-due-at-ms');
  const errorClassRaw = get('x-error-class');
  const out: Partial<RetryHeaders> = {};
  const originalTopic = get('x-original-topic');
  if (originalTopic) out.originalTopic = originalTopic;
  if (tierRaw) out.retryTier = Number(tierRaw);
  if (dueRaw) out.dueAtMs = Number(dueRaw);
  if (
    errorClassRaw === 'poison' ||
    errorClassRaw === 'semantic' ||
    errorClassRaw === 'transient'
  ) {
    out.errorClass = errorClassRaw;
  }
  const errorMessage = get('x-error-message');
  if (errorMessage) out.errorMessage = errorMessage;
  const consumerGroup = get('x-consumer-group');
  if (consumerGroup) out.consumerGroup = consumerGroup;
  return out;
}

export async function publishRetry(
  producer: Producer,
  options: {
    baseTopic: string;
    tierIndex: number;
    key: string | null;
    envelope: DomainEventEnvelope;
    errorClass: ErrorClass;
    errorMessage: string;
    consumerGroup: string;
    nowMs?: number;
  },
): Promise<string> {
  const tier = RETRY_TIERS[options.tierIndex];
  if (!tier) {
    throw new Error(`retry tier out of range: ${options.tierIndex}`);
  }
  const topic = retryTopic(options.baseTopic, options.tierIndex);
  const now = options.nowMs ?? Date.now();
  const dueAtMs = now + tier.delayMs;
  await producer.send({
    topic,
    messages: [
      {
        key: options.key,
        value: JSON.stringify(options.envelope),
        headers: encodeRetryHeaders({
          originalTopic: options.baseTopic,
          retryTier: options.tierIndex,
          dueAtMs,
          errorClass: options.errorClass,
          errorMessage: options.errorMessage,
          consumerGroup: options.consumerGroup,
        }),
      },
    ],
  });
  return topic;
}

export async function publishDlq(
  producer: Producer,
  options: {
    baseTopic: string;
    key: string | null;
    envelope: DomainEventEnvelope;
    errorClass: ErrorClass;
    errorMessage: string;
    consumerGroup: string;
    retryTierExhausted: number;
  },
): Promise<string> {
  const topic = dlqTopic(options.baseTopic);
  const body: DlqEnvelope = {
    originalTopic: options.baseTopic,
    originalPartitionKey: options.key,
    failedAt: new Date().toISOString(),
    errorClass: options.errorClass,
    errorMessage: options.errorMessage.slice(0, 2000),
    retryTierExhausted: options.retryTierExhausted,
    consumerGroup: options.consumerGroup,
    envelope: options.envelope,
  };
  await producer.send({
    topic,
    messages: [
      {
        key: options.key,
        value: JSON.stringify(body),
        headers: {
          'x-error-class': options.errorClass,
          'x-original-topic': options.baseTopic,
          'x-consumer-group': options.consumerGroup,
        },
      },
    ],
  });
  return topic;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
