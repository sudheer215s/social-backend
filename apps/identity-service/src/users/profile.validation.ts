import { z } from 'zod';
import { USERNAME_RE } from '../auth/validation';
import { sanitizeUserText } from '../common/sanitize';

export const updateProfileSchema = z
  .object({
    displayName: z
      .string()
      .min(1)
      .max(80)
      .nullable()
      .optional()
      .transform((v) => (v == null ? v : sanitizeUserText(v))),
    bio: z
      .string()
      .max(500)
      .nullable()
      .optional()
      .transform((v) => (v == null ? v : sanitizeUserText(v))),
    avatarMediaId: z.string().min(1).max(128).nullable().optional(),
    visibility: z.enum(['public', 'followers']).optional(),
    username: z
      .string()
      .regex(USERNAME_RE, 'username must be 3-30 chars: letters, digits, _')
      .optional(),
  })
  .refine(
    (v) =>
      v.displayName !== undefined ||
      v.bio !== undefined ||
      v.avatarMediaId !== undefined ||
      v.visibility !== undefined ||
      v.username !== undefined,
    { message: 'at least one field is required' },
  );

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
