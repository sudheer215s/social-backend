/**
 * Measured post heights, keyed by post ID.
 *
 * Scroll restoration needs real heights *before* it sets an offset — with only
 * estimates the virtualiser lands the reader in the wrong place (risk FR3).
 * Keying by ID rather than index is what lets the heights survive a prepended
 * page or a reorder.
 * @see docs/frontend/04-modules/feature-modules.md — `timeline`
 * @see docs/frontend/03-flows.md §5
 */

export const HEIGHTS_STORAGE_KEY = 'timeline:heights:v1';

/** A post card before it is measured; close to the median rendered card. */
export const ESTIMATED_POST_HEIGHT = 180;

/** Roughly the materialised window; past that the reader has moved on. */
export const MAX_CACHED_HEIGHTS = 400;

const FLUSH_DELAY_MS = 500;

let heights: Map<string, number> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Storage access itself throws in Safari private mode, not just writes. */
function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function load(): Map<string, number> {
  if (heights) return heights;
  const loaded = new Map<string, number>();
  try {
    const raw = storage()?.getItem(HEIGHTS_STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const [id, value] of Object.entries(parsed)) {
          if (
            typeof value === 'number' &&
            Number.isFinite(value) &&
            value > 0
          ) {
            loaded.set(id, value);
          }
        }
      }
    }
  } catch {
    // Corrupt or unreadable: estimates are a worse start, not a broken one.
  }
  heights = loaded;
  return loaded;
}

export function estimateHeight(postId: string): number {
  return load().get(postId) ?? ESTIMATED_POST_HEIGHT;
}

export function rememberHeight(postId: string, height: number): void {
  if (!Number.isFinite(height) || height <= 0) return;
  const cache = load();
  if (cache.get(postId) === height) return;
  // Re-inserting moves the entry to the end, which is what makes the trim on
  // flush drop the posts the reader scrolled past longest ago.
  cache.delete(postId);
  cache.set(postId, height);

  if (flushTimer === null) {
    flushTimer = setTimeout(flushHeights, FLUSH_DELAY_MS);
  }
}

export function flushHeights(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const cache = load();
  const entries = [...cache.entries()].slice(-MAX_CACHED_HEIGHTS);
  try {
    storage()?.setItem(
      HEIGHTS_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(entries)),
    );
  } catch {
    // Quota or private mode: the in-memory cache still serves this page.
  }
}

/** Drops the in-memory copy. Storage is left alone — that is the point. */
export function clearHeights(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  heights = null;
}
