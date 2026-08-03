import { afterEach, describe, expect, it } from 'vitest';
import { env } from './env';

describe('env (F0-T01)', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('defaults API base URL for local gateway', () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    expect(env.apiBaseUrl()).toBe('http://127.0.0.1:3000');
  });

  it('reads NEXT_PUBLIC_API_BASE_URL when set', () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'https://api.example.com';
    expect(env.apiBaseUrl()).toBe('https://api.example.com');
  });
});
