import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './relative-time';

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatRelativeTime (F2-T02)', () => {
  it('collapses anything under a minute to "now"', () => {
    expect(formatRelativeTime(ago(0), NOW)).toBe('now');
    expect(formatRelativeTime(ago(59 * SECOND), NOW)).toBe('now');
  });

  it('counts minutes up to an hour', () => {
    expect(formatRelativeTime(ago(MINUTE), NOW)).toBe('1m');
    expect(formatRelativeTime(ago(59 * MINUTE), NOW)).toBe('59m');
  });

  it('counts hours up to a day', () => {
    expect(formatRelativeTime(ago(HOUR), NOW)).toBe('1h');
    expect(formatRelativeTime(ago(23 * HOUR), NOW)).toBe('23h');
  });

  it('counts days up to a week', () => {
    expect(formatRelativeTime(ago(DAY), NOW)).toBe('1d');
    expect(formatRelativeTime(ago(6 * DAY), NOW)).toBe('6d');
  });

  it('switches to an absolute date after a week', () => {
    const result = formatRelativeTime(ago(8 * DAY), NOW);
    expect(result).not.toMatch(/[dhm]$/);
    expect(result).toMatch(/7/);
  });

  it('never renders a negative age from clock skew', () => {
    expect(
      formatRelativeTime(new Date(NOW + 30 * SECOND).toISOString(), NOW),
    ).toBe('now');
  });

  it('returns an empty string for an unparseable timestamp', () => {
    expect(formatRelativeTime('not-a-date', NOW)).toBe('');
  });
});
