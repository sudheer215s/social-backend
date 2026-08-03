import { z } from 'zod';

export const createReportSchema = z.object({
  targetType: z.enum(['user', 'post']),
  targetId: z.string().uuid(),
  reason: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_-]+$/i, 'reason must be a short code'),
  details: z.string().max(2000).optional().default(''),
});

export type CreateReportInput = z.infer<typeof createReportSchema>;
