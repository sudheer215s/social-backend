import { z } from 'zod';

export const createPostSchema = z.object({
  content: z.string().min(1).max(280),
  mediaRefs: z.array(z.string().min(1).max(128)).max(4).optional(),
  replyToId: z.string().uuid().optional(),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;
