import type { Consumer, Producer } from 'kafkajs';
import {
  startReliableConsumer,
  type DomainEventEnvelope,
  type ErrorClass,
} from '@social/platform-events';
import type { TimelineService } from '../timeline/timeline.service';

const CONSUMER_GROUP = 'timeline-fanout';

export async function startFanoutConsumer(options: {
  consumer: Consumer;
  producer: Producer;
  timelines: TimelineService;
  topics?: string[];
  onError?: (err: unknown) => void;
  onDlq?: (info: {
    baseTopic: string;
    errorClass: ErrorClass;
    errorMessage: string;
    envelope: DomainEventEnvelope;
  }) => void;
}): Promise<() => Promise<void>> {
  const topics = options.topics ?? ['social.post.v1', 'social.graph.v1'];
  return startReliableConsumer({
    consumer: options.consumer,
    producer: options.producer,
    topics,
    consumerGroup: CONSUMER_GROUP,
    handler: async (envelope) => {
      if (envelope.eventType === 'post.created') {
        const authorId = asString(envelope.payload.authorId);
        const postId = asString(envelope.payload.postId);
        if (!authorId || !postId) return;
        await options.timelines.fanoutPost(authorId, postId);
        return;
      }
      if (envelope.eventType === 'user.followed') {
        const followerId = asString(envelope.payload.followerId);
        const followeeId = asString(envelope.payload.followeeId);
        if (!followerId || !followeeId) return;
        await options.timelines.backfillOnFollow(followerId, followeeId);
      }
    },
    ...(options.onError ? { onError: options.onError } : {}),
    ...(options.onDlq ? { onDlq: options.onDlq } : {}),
  });
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
