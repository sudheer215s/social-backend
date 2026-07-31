import type { Consumer } from 'kafkajs';
import type { DomainEventEnvelope } from '@social/platform-events';
import type { TimelineService } from '../timeline/timeline.service';

export async function startFanoutConsumer(options: {
  consumer: Consumer;
  timelines: TimelineService;
  topic?: string;
  onError?: (err: unknown) => void;
}): Promise<() => Promise<void>> {
  const topic = options.topic ?? 'social.post.v1';
  await options.consumer.subscribe({ topic, fromBeginning: false });
  await options.consumer.run({
    eachMessage: async ({ message }) => {
      try {
        if (!message.value) return;
        const envelope = JSON.parse(
          message.value.toString('utf8'),
        ) as DomainEventEnvelope;
        if (envelope.eventType !== 'post.created') return;
        const authorRaw = envelope.payload.authorId;
        const postRaw = envelope.payload.postId;
        const authorId = typeof authorRaw === 'string' ? authorRaw : '';
        const postId = typeof postRaw === 'string' ? postRaw : '';
        if (!authorId || !postId) return;
        await options.timelines.fanoutPost(authorId, postId);
      } catch (err) {
        options.onError?.(err);
      }
    },
  });
  return async () => {
    await options.consumer.disconnect();
  };
}
