import { describe, expect, it } from 'vitest';
import { forgotPasswordSchema, resetPasswordSchema } from './auth-schemas';

describe('forgotPasswordSchema (F1-T05a)', () => {
  it('accepts a well-formed address', () => {
    expect(forgotPasswordSchema.safeParse({ email: 'a@b.com' }).success).toBe(
      true,
    );
  });

  it('rejects a malformed address without hinting at existence', () => {
    const result = forgotPasswordSchema.safeParse({ email: 'not-an-email' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.message).toBe(
        'Enter a valid email address',
      );
    }
  });
});

describe('resetPasswordSchema (F1-T05a)', () => {
  const valid = {
    password: 'new-password-1',
    confirmPassword: 'new-password-1',
  };

  it('accepts matching passwords', () => {
    expect(resetPasswordSchema.safeParse(valid).success).toBe(true);
  });

  it('reports a mismatch on the confirm field, not the password field', () => {
    const result = resetPasswordSchema.safeParse({
      ...valid,
      confirmPassword: 'different-1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path[0] === 'confirmPassword',
      );
      expect(issue?.message).toMatch(/match/i);
    }
  });

  it('enforces the same minimum length as registration', () => {
    const result = resetPasswordSchema.safeParse({
      password: 'short',
      confirmPassword: 'short',
    });
    expect(result.success).toBe(false);
  });
});
