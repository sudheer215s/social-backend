import { loginSchema, registerSchema } from './validation';

describe('registerSchema', () => {
  it('accepts a valid payload', () => {
    const parsed = registerSchema.parse({
      username: 'ada_lovelace',
      email: 'ada@example.com',
      password: 'long-enough-password',
    });
    expect(parsed.username).toBe('ada_lovelace');
  });

  it('rejects short passwords and bad usernames', () => {
    expect(() =>
      registerSchema.parse({
        username: 'ab',
        email: 'a@b.com',
        password: 'short',
      }),
    ).toThrow();
  });
});

describe('loginSchema', () => {
  it('requires identifier and password', () => {
    expect(() =>
      loginSchema.parse({ identifier: '', password: 'x' }),
    ).toThrow();
    expect(
      loginSchema.parse({ identifier: 'ada@example.com', password: 'x' }),
    ).toEqual({ identifier: 'ada@example.com', password: 'x' });
  });
});
