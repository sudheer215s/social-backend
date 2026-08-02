import { createHash } from 'node:crypto';
import type { RedisClient } from './client';

export type IdempotencyBeginResult =
  | { outcome: 'acquired' }
  | { outcome: 'in_flight' }
  | { outcome: 'replay'; status: number; body: unknown }
  | { outcome: 'conflict' }; // same key, different body

export interface IdempotencyStore {
  begin(
    key: string,
    requestHash: string,
    inflightTtlSec?: number,
  ): Promise<IdempotencyBeginResult>;
  complete(
    key: string,
    requestHash: string,
    status: number,
    body: unknown,
    ttlSec?: number,
  ): Promise<void>;
  /** Drop in-flight marker after 5xx so the client may retry. */
  abandon(key: string): Promise<void>;
}

type Stored =
  | { state: 'in_flight'; requestHash: string }
  | {
      state: 'completed';
      requestHash: string;
      status: number;
      body: unknown;
    };

const DEFAULT_INFLIGHT = 60;
const DEFAULT_TTL = 24 * 60 * 60;

export function hashIdempotencyParts(
  userId: string,
  method: string,
  path: string,
  idempotencyKey: string,
): string {
  return createHash('sha256')
    .update(`${userId}\n${method}\n${path}\n${idempotencyKey}`, 'utf8')
    .digest('hex');
}

export function hashRequestBody(body: unknown): string {
  const raw =
    body === undefined
      ? ''
      : typeof body === 'string'
        ? body
        : stableStringify(body);
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export class RedisIdempotencyStore implements IdempotencyStore {
  constructor(
    private readonly redis: RedisClient,
    private readonly prefix = 'idem:',
  ) {}

  private k(key: string): string {
    return `${this.prefix}${key}`;
  }

  async begin(
    key: string,
    requestHash: string,
    inflightTtlSec = DEFAULT_INFLIGHT,
  ): Promise<IdempotencyBeginResult> {
    const redisKey = this.k(key);
    const existingRaw = await this.redis.get(redisKey);
    if (existingRaw) {
      return this.interpret(existingRaw, requestHash);
    }
    const payload: Stored = { state: 'in_flight', requestHash };
    const ok = await this.redis.set(
      redisKey,
      JSON.stringify(payload),
      'EX',
      inflightTtlSec,
      'NX',
    );
    if (ok === 'OK') return { outcome: 'acquired' };
    const raced = await this.redis.get(redisKey);
    if (!raced) return { outcome: 'acquired' }; // rare race after expiry
    return this.interpret(raced, requestHash);
  }

  async complete(
    key: string,
    requestHash: string,
    status: number,
    body: unknown,
    ttlSec = DEFAULT_TTL,
  ): Promise<void> {
    const payload: Stored = {
      state: 'completed',
      requestHash,
      status,
      body,
    };
    await this.redis.set(this.k(key), JSON.stringify(payload), 'EX', ttlSec);
  }

  async abandon(key: string): Promise<void> {
    await this.redis.del(this.k(key));
  }

  private interpret(raw: string, requestHash: string): IdempotencyBeginResult {
    let parsed: Stored;
    try {
      parsed = JSON.parse(raw) as Stored;
    } catch {
      return { outcome: 'acquired' };
    }
    if (parsed.requestHash !== requestHash) {
      return { outcome: 'conflict' };
    }
    if (parsed.state === 'in_flight') {
      return { outcome: 'in_flight' };
    }
    return {
      outcome: 'replay',
      status: parsed.status,
      body: parsed.body,
    };
  }
}

/** Process-local store for tests / REDIS_DISABLED. */
export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly map = new Map<
    string,
    { stored: Stored; expiresAt: number }
  >();

  async begin(
    key: string,
    requestHash: string,
    inflightTtlSec = DEFAULT_INFLIGHT,
  ): Promise<IdempotencyBeginResult> {
    await Promise.resolve();
    this.gc();
    const cur = this.map.get(key);
    if (cur) {
      return this.interpretStored(cur.stored, requestHash);
    }
    this.map.set(key, {
      stored: { state: 'in_flight', requestHash },
      expiresAt: Date.now() + inflightTtlSec * 1000,
    });
    return { outcome: 'acquired' };
  }

  async complete(
    key: string,
    requestHash: string,
    status: number,
    body: unknown,
    ttlSec = DEFAULT_TTL,
  ): Promise<void> {
    await Promise.resolve();
    this.map.set(key, {
      stored: { state: 'completed', requestHash, status, body },
      expiresAt: Date.now() + ttlSec * 1000,
    });
  }

  async abandon(key: string): Promise<void> {
    await Promise.resolve();
    this.map.delete(key);
  }

  private interpretStored(
    stored: Stored,
    requestHash: string,
  ): IdempotencyBeginResult {
    if (stored.requestHash !== requestHash) return { outcome: 'conflict' };
    if (stored.state === 'in_flight') return { outcome: 'in_flight' };
    return {
      outcome: 'replay',
      status: stored.status,
      body: stored.body,
    };
  }

  private gc(): void {
    const now = Date.now();
    for (const [k, v] of this.map) {
      if (v.expiresAt <= now) this.map.delete(k);
    }
  }
}
