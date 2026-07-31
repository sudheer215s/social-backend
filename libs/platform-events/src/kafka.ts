import { Kafka, type Consumer, type Producer, logLevel } from 'kafkajs';
import type { DomainEventEnvelope, OutboxEvent } from './types';

export function createKafka(clientId: string, brokers?: string[]): Kafka {
  const list =
    brokers ??
    (process.env.KAFKA_BROKERS ?? 'localhost:19092')
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean);
  return new Kafka({
    clientId,
    brokers: list,
    logLevel: logLevel.ERROR,
    retry: { retries: 5 },
  });
}

export async function createProducer(kafka: Kafka): Promise<Producer> {
  const producer = kafka.producer({ allowAutoTopicCreation: true });
  await producer.connect();
  return producer;
}

export async function createConsumer(
  kafka: Kafka,
  groupId: string,
): Promise<Consumer> {
  const consumer = kafka.consumer({ groupId });
  await consumer.connect();
  return consumer;
}

/**
 * Lightweight broker reachability for readiness probes.
 * Returns true when KAFKA_DISABLED=1 (async plane intentionally off).
 */
export async function checkKafka(
  clientId = 'health-check',
  brokers?: string[],
): Promise<boolean> {
  if (process.env.KAFKA_DISABLED === '1') return true;
  const kafka = createKafka(clientId, brokers);
  const admin = kafka.admin();
  try {
    await admin.connect();
    await admin.describeCluster();
    return true;
  } catch {
    return false;
  } finally {
    try {
      await admin.disconnect();
    } catch {
      // ignore
    }
  }
}

export function toEnvelope(event: OutboxEvent): DomainEventEnvelope {
  return {
    eventId: event.id,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    occurredAt: new Date().toISOString(),
    payload: event.payload,
  };
}

export async function publishOutboxBatch(
  producer: Producer,
  events: OutboxEvent[],
): Promise<void> {
  if (events.length === 0) return;
  await producer.sendBatch({
    topicMessages: groupByTopic(events).map(([topic, batch]) => ({
      topic,
      messages: batch.map((e) => ({
        key: e.partitionKey,
        value: JSON.stringify(toEnvelope(e)),
        headers: {
          eventType: e.eventType,
          eventId: e.id,
        },
      })),
    })),
  });
}

function groupByTopic(events: OutboxEvent[]): [string, OutboxEvent[]][] {
  const map = new Map<string, OutboxEvent[]>();
  for (const e of events) {
    const list = map.get(e.topic) ?? [];
    list.push(e);
    map.set(e.topic, list);
  }
  return [...map.entries()];
}
