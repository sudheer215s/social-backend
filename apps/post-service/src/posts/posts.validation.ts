import { z } from 'zod';
import { graphemeLength, MAX_POST_GRAPHEMES } from './grapheme';

export const createPostSchema = z
  .object({
    content: z.string().optional().default(''),
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
    const g = graphemeLength(content);
    if (g > MAX_POST_GRAPHEMES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `content exceeds ${MAX_POST_GRAPHEMES} graphemes (got ${g})`,
        path: ['content'],
      });
    }
  });

export type CreatePostInput = z.infer<typeof createPostSchema>;
