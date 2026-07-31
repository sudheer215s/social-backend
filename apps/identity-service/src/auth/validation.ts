import { z } from 'zod';

export const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;

export const registerSchema = z.object({
  username: z
    .string()
    .regex(USERNAME_RE, 'username must be 3-30 chars: letters, digits, _'),
  email: z.string().email().max(320),
  password: z.string().min(10).max(128),
  displayName: z.string().min(1).max(80).optional(),
});

export const loginSchema = z.object({
  // email or username
  identifier: z.string().min(3).max(320),
  password: z.string().min(1).max(128),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
