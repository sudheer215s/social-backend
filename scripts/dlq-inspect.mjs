#!/usr/bin/env node
/**
 * Minimal DLQ inspect / redrive CLI.
 *
 * Usage:
 *   node scripts/dlq-inspect.mjs list  --topic social.post.v1 [--limit 20]
 *   node scripts/dlq-inspect.mjs redrive --topic social.post.v1 --max 1
 *
 * Requires KAFKA_BROKERS (default localhost:19092).
 */
import { Kafka, logLevel } from 'kafkajs';

const brokers = (process.env.KAFKA_BROKERS ?? 'localhost:19092')
  .split(',')
  .map((b) => b.trim())
  .filter(Boolean);

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const cmd = process.argv[2] ?? 'list';
const baseTopic = arg('topic', 'social.post.v1');
const dlqTopic = baseTopic.endsWith('.dlq') ? baseTopic : `${baseTopic}.dlq`;
const limit = Number(arg('limit', '20'));
const max = Number(arg('max', '1'));

const kafka = new Kafka({
  clientId: 'dlq-inspect',
  brokers,
  logLevel: logLevel.ERROR,
});

async function list() {
  const consumer = kafka.consumer({
    groupId: `dlq-inspect-${Date.now()}`,
  });
  await consumer.connect();
  await consumer.subscribe({ topic: dlqTopic, fromBeginning: true });

  const rows = [];
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(undefined), 4000);
    consumer
      .run({
        eachMessage: async ({ message, partition }) => {
          if (rows.length >= limit) return;
          const raw = message.value?.toString('utf8') ?? '';
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = { raw };
          }
          rows.push({
            partition,
            offset: message.offset,
            key: message.key?.toString() ?? null,
            body: parsed,
          });
          if (rows.length >= limit) {
            clearTimeout(timer);
            resolve(undefined);
          }
        },
      })
      .catch(reject);
  });

  await consumer.disconnect();
  console.log(JSON.stringify({ topic: dlqTopic, count: rows.length, rows }, null, 2));
}

async function redrive() {
  const consumer = kafka.consumer({
    groupId: `dlq-redrive-${Date.now()}`,
  });
  const producer = kafka.producer();
  await consumer.connect();
  await producer.connect();
  await consumer.subscribe({ topic: dlqTopic, fromBeginning: true });

  let redriven = 0;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(undefined), 5000);
    consumer
      .run({
        eachMessage: async ({ message }) => {
          if (redriven >= max) return;
          const raw = message.value?.toString('utf8') ?? '';
          let body;
          try {
            body = JSON.parse(raw);
          } catch {
            console.error('skip non-json dlq message');
            return;
          }
          const envelope = body.envelope ?? body;
          const dest = body.originalTopic ?? baseTopic.replace(/\.dlq$/, '');
          await producer.send({
            topic: dest,
            messages: [
              {
                key: message.key,
                value: JSON.stringify(envelope),
                headers: {
                  'x-redriven-from': dlqTopic,
                  'x-redriven-at': new Date().toISOString(),
                },
              },
            ],
          });
          redriven += 1;
          console.error(`redrove event ${envelope.eventId ?? '?'} → ${dest}`);
          if (redriven >= max) {
            clearTimeout(timer);
            resolve(undefined);
          }
        },
      })
      .catch(reject);
  });

  await consumer.disconnect();
  await producer.disconnect();
  console.log(JSON.stringify({ redriven, from: dlqTopic }, null, 2));
}

if (cmd === 'list') {
  await list();
} else if (cmd === 'redrive') {
  await redrive();
} else if (cmd === 'help' || hasFlag('help')) {
  console.log(`Usage:
  node scripts/dlq-inspect.mjs list --topic social.post.v1 [--limit 20]
  node scripts/dlq-inspect.mjs redrive --topic social.post.v1 [--max 1]`);
} else {
  console.error(`unknown command: ${cmd}`);
  process.exit(1);
}
