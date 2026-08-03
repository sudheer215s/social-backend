import { z } from 'zod';
import { sanitizeUserText } from '../common/sanitize';

export const createReportSchema = z.object({
  targetType: z.enum(['user', 'post']),
  targetId: z.string().uuid(),
  reason: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_-]+$/i, 'reason must be a short code'),
  details: z
    .string()
    .max(2000)
    .optional()
    .default('')
    .transform((s) => sanitizeUserText(s)),
});

export type CreateReportInput = z.infer<typeof createReportSchema>;

export const updateReportStatusSchema = z.object({
  status: z.enum(['open', 'reviewing', 'resolved', 'dismissed']),
  note: z
    .string()
    .max(500)
    .optional()
    .default('')
    .transform((s) => sanitizeUserText(s)),
});

export type UpdateReportStatusInput = z.infer<typeof updateReportStatusSchema>;

export const listReportsQuerySchema = z.object({
  status: z
    .enum(['open', 'reviewing', 'resolved', 'dismissed'])
    .optional()
    .default('open'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export type ListReportsQuery = z.infer<typeof listReportsQuerySchema>;
