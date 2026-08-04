'use client';

/**
 * One interval for every timestamp on screen.
 * 100 cards with a timer each is 100 wakeups a second — a measurable battery
 * and INP cost on the most-rendered component in the app.
 * @see docs/frontend/04-modules/feature-modules.md — `post`
 */
import { useSyncExternalStore } from 'react';
import { formatRelativeTime } from '@/lib/relative-time';

export const TICK_INTERVAL_MS = 60_000;

const subscribers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let snapshot = Date.now();

function subscribe(onChange: () => void): () => void {
  subscribers.add(onChange);
  if (timer === null) {
    // The snapshot froze when the last subscriber left; anything mounting now
    // would otherwise format against a timestamp from that moment.
    snapshot = Date.now();
    timer = setInterval(() => {
      snapshot = Date.now();
      for (const notify of subscribers) notify();
    }, TICK_INTERVAL_MS);
  }
  return () => {
    subscribers.delete(onChange);
    if (subscribers.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): number {
  return snapshot;
}

/** Server render has no ticker; format once against the initial snapshot. */
function getServerSnapshot(): number {
  return snapshot;
}

export function useRelativeTime(iso: string): string {
  const now = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return formatRelativeTime(iso, now);
}
