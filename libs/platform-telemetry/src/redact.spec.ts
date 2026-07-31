import { REDACTED_VALUE, redactSensitive } from './redact';

describe('redactSensitive', () => {
  it('redacts password, token, authorization, refresh_token, email, ip', () => {
    const result = redactSensitive({
      password: 'hunter2',
      token: 'abc',
      authorization: 'Bearer x',
      refresh_token: 'r1',
      email: 'a@b.com',
      ip: '1.2.3.4',
      username: 'alice',
    }) as Record<string, unknown>;

    expect(result.password).toBe(REDACTED_VALUE);
    expect(result.token).toBe(REDACTED_VALUE);
    expect(result.authorization).toBe(REDACTED_VALUE);
    expect(result.refresh_token).toBe(REDACTED_VALUE);
    expect(result.email).toBe(REDACTED_VALUE);
    expect(result.ip).toBe(REDACTED_VALUE);
    expect(result.username).toBe('alice');
  });

  it('is case-insensitive on keys', () => {
    const result = redactSensitive({
      Password: 'x',
      EMAIL: 'a@b.com',
    }) as Record<string, unknown>;
    expect(result.Password).toBe(REDACTED_VALUE);
    expect(result.EMAIL).toBe(REDACTED_VALUE);
  });

  it('redacts nested objects and arrays', () => {
    const result = redactSensitive({
      user: { email: 'a@b.com', name: 'Ada' },
      items: [{ token: 't' }, { ok: true }],
    }) as {
      user: Record<string, unknown>;
      items: Record<string, unknown>[];
    };

    expect(result.user.email).toBe(REDACTED_VALUE);
    expect(result.user.name).toBe('Ada');
    expect(result.items[0]?.token).toBe(REDACTED_VALUE);
    expect(result.items[1]?.ok).toBe(true);
  });

  it('leaves primitives and null alone', () => {
    expect(redactSensitive(null)).toBeNull();
    expect(redactSensitive('plain')).toBe('plain');
    expect(redactSensitive(42)).toBe(42);
  });
});
