import { z } from 'zod';

export const createPostSchema = z
  .object({
    content: z.string().max(280).optional().default(''),
    mediaRefs: z.array(z.string().min(1).max(128)).max(4).optional(),
    replyToId: z.string().uuid().optional(),
    repostOfId: z.string().uuid().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.replyToId && v.repostOfId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Cannot set both replyToId and repostOfId',
        path: ['replyToId'],
      });
    }
    const content = v.content ?? '';
    if (!v.repostOfId && content.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'content is required unless repostOfId is set',
        path: ['content'],
      });
    }
  });

export type CreatePostInput = z.infer<typeof createPostSchema>;
