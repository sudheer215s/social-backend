import type { Redis } from 'ioredis';

export function notificationStreamKey(userId: string): string {
  return `ntf:s:${userId}`;
}

export interface StreamEntry {
  streamId: string;
  notificationId: string;
  type: string;
  ts: string;
}

/**
 * Replay entries after `since` (exclusive). `since` null → empty (caller uses live tail).
 */
export async function readCatchUp(
  redis: Redis,
  userId: string,
  since: string | null,
  count = 200,
): Promise<StreamEntry[]> {
  if (!since || since === '$' || since === '0-0') {
    return [];
  }
  const key = notificationStreamKey(userId);
  // XRANGE key (since + COUNT n  — exclusive start via (
  const rows = (await redis.xrange(key, `(${since}`, '+', 'COUNT', count)) as [
    string,
    string[],
  ][];
  return rows.map(mapEntry).filter((e): e is StreamEntry => e !== null);
}

/**
 * Blocking read of new entries after cursor. Returns [] on timeout.
 */
export async function readLive(
  redis: Redis,
  userId: string,
  cursor: string,
  blockMs = 5000,
  count = 50,
): Promise<StreamEntry[]> {
  const key = notificationStreamKey(userId);
  // ioredis overloads struggle with BLOCK+COUNT; use call()
  const result = (await redis.call(
    'XREAD',
    'BLOCK',
    String(blockMs),
    'COUNT',
    String(count),
    'STREAMS',
    key,
    cursor,
  )) as [string, [string, string[]][]][] | null;
  if (!result || result.length === 0) return [];
  const streamRows = result[0]?.[1] ?? [];
  return streamRows.map(mapEntry).filter((e): e is StreamEntry => e !== null);
}

function mapEntry(row: [string, string[]]): StreamEntry | null {
  const [streamId, fields] = row;
  const map = new Map<string, string>();
  for (let i = 0; i + 1 < fields.length; i += 2) {
    map.set(fields[i]!, fields[i + 1]!);
  }
  const notificationId = map.get('id');
  if (!notificationId) return null;
  return {
    streamId,
    notificationId,
    type: map.get('type') ?? 'unknown',
    ts: map.get('ts') ?? '',
  };
}
