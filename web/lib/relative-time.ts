/**
 * Compact relative timestamps for post metadata.
 * Pure: the caller supplies `now`, so rendering is deterministic under test.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const absolute = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
});

export function formatRelativeTime(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';

  // Clock skew can put a server timestamp slightly in the future; a negative
  // age would render as "-1m", so clamp instead.
  const age = Math.max(0, now - then);

  if (age < MINUTE) return 'now';
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h`;
  if (age < WEEK) return `${Math.floor(age / DAY)}d`;
  return absolute.format(then);
}
