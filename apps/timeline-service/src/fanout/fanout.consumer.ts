import type { Consumer } from 'kafkajs';
import type { DomainEventEnvelope } from '@social/platform-events';
import type { TimelineService } from '../timeline/timeline.service';

export async function startFanoutConsumer(options: {
  consumer: Consumer;
  timelines: TimelineService;
  topics?: string[];
  onError?: (err: unknown) => void;
}): Promise<() => Promise<void>> {
  const topics = options.topics ?? ['social.post.v1', 'social.graph.v1'];
  for (const topic of topics) {
    await options.consumer.subscribe({ topic, fromBeginning: false });
  }
  await options.consumer.run({
    eachMessage: async ({ message }) => {
      try {
        if (!message.value) return;
        const envelope = JSON.parse(
          message.value.toString('utf8'),
        ) as DomainEventEnvelope;
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
      } catch (err) {
        options.onError?.(err);
      }
    },
  });
  return async () => {
    await options.consumer.disconnect();
  };
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
