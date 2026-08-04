/**
 * Persisted window scroll offset for the home timeline.
 *
 * Restored *after* height-cache hydrate and *before* paint so a virtualised
 * list does not jump (risk FR3).
 * @see docs/frontend/03-flows.md §5 — Scroll restoration
 */

export const SCROLL_STORAGE_KEY = 'timeline:scroll:home:v1';

/** Storage access itself throws in Safari private mode. */
function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function saveScrollOffset(offset: number): void {
  if (!Number.isFinite(offset) || offset < 0) return;
  try {
    storage()?.setItem(SCROLL_STORAGE_KEY, String(Math.round(offset)));
  } catch {
    // private mode / quota — restoration is best-effort
  }
}

export function loadScrollOffset(): number | null {
  try {
    const raw = storage()?.getItem(SCROLL_STORAGE_KEY);
    if (raw === null || raw === undefined || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  } catch {
    return null;
  }
}

export function clearScrollOffset(): void {
  try {
    storage()?.removeItem(SCROLL_STORAGE_KEY);
  } catch {
    // ignore
  }
}
