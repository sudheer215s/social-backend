/**
 * Opaque base64url cursors for keyset pagination (api-conventions §3).
 */

export function encodeCursor(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor<T>(cursor: string): T {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    return JSON.parse(json) as T;
  } catch {
    throw new Error('invalid_cursor');
  }
}

export interface PageMeta {
  next_cursor: string | null;
  has_more: boolean;
}

/**
 * Take limit+1 rows; if extra exists, drop it and set has_more + next cursor
 * from the last *returned* item via `cursorFrom`.
 */
export function paginateRows<T>(
  rows: T[],
  limit: number,
  cursorFrom: (row: T) => unknown,
): { items: T[]; page: PageMeta } {
  const safe = Math.min(Math.max(limit, 1), 100);
  const hasMore = rows.length > safe;
  const items = hasMore ? rows.slice(0, safe) : rows;
  const last = items[items.length - 1];
  return {
    items,
    page: {
      has_more: hasMore,
      next_cursor:
        hasMore && last !== undefined ? encodeCursor(cursorFrom(last)) : null,
    },
  };
}
