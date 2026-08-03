import { z } from 'zod';

const emailField = z.string().email('Enter a valid email address');
const passwordField = z
  .string()
  .min(8, 'Password must be at least 8 characters');

/** Client-side format validation only — no email existence checks. */
export const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z.object({
  email: emailField,
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must be at most 30 characters')
    .regex(
      /^[a-zA-Z0-9_]+$/,
      'Username may only contain letters, numbers, and underscores',
    ),
  password: passwordField,
});

export const forgotPasswordSchema = z.object({ email: emailField });

export const resetPasswordSchema = z
  .object({
    password: passwordField,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
