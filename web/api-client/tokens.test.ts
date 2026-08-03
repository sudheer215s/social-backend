import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokens } from './tokens';

describe('tokens store (F0-T05)', () => {
  beforeEach(() => {
    tokens.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T12:00:00.000Z'));
  });

  afterEach(() => {
    tokens.clear();
    vi.useRealTimers();
  });

  it('returns null when empty', () => {
    expect(tokens.get()).toBeNull();
  });

  it('returns the token within its TTL (with 5s safety margin)', () => {
    tokens.set('access-1', 600); // 10 minutes
    expect(tokens.get()).toBe('access-1');
  });

  it('returns null after TTL minus 5s safety margin', () => {
    tokens.set('access-1', 10); // 10s server TTL → expiresAt = now + 5s
    expect(tokens.get()).toBe('access-1');
    vi.advanceTimersByTime(4_999);
    expect(tokens.get()).toBe('access-1');
    vi.advanceTimersByTime(2);
    expect(tokens.get()).toBeNull();
  });

  it('clear removes the token', () => {
    tokens.set('access-1', 600);
    tokens.clear();
    expect(tokens.get()).toBeNull();
  });

  it('needsProactiveRefresh is false with plenty of TTL left', () => {
    tokens.set('access-1', 600);
    expect(tokens.needsProactiveRefresh()).toBe(false);
  });

  it('needsProactiveRefresh is true within 60s of effective expiry', () => {
    tokens.set('access-1', 60); // effective ~55s remaining
    // advance so remaining effective TTL < 60s (always true here)
    // With ttl 60s and 5s margin, expiresAt = now+55s → needs proactive immediately
    expect(tokens.needsProactiveRefresh()).toBe(true);
  });

  it('needsProactiveRefresh is false when no token', () => {
    expect(tokens.needsProactiveRefresh()).toBe(false);
  });
});
