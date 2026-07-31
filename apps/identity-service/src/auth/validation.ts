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
  identifier: z.string().min(3).max(320),
  password: z.string().min(1).max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(512),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(20).max(512),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().max(320),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(512),
  newPassword: z.string().min(10).max(128),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
