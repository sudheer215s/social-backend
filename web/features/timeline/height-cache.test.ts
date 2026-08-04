import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearHeights,
  ESTIMATED_POST_HEIGHT,
  estimateHeight,
  flushHeights,
  HEIGHTS_STORAGE_KEY,
  MAX_CACHED_HEIGHTS,
  rememberHeight,
} from './height-cache';

describe('timeline height cache (F2-T05)', () => {
  beforeEach(() => {
    clearHeights();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('estimates an unmeasured post rather than guessing zero', () => {
    expect(estimateHeight('post_unknown')).toBe(ESTIMATED_POST_HEIGHT);
  });

  it('returns the measured height once a post has been seen', () => {
    rememberHeight('post_1', 240);

    expect(estimateHeight('post_1')).toBe(240);
  });

  it('ignores nonsense measurements', () => {
    rememberHeight('post_1', 0);
    rememberHeight('post_2', Number.NaN);

    expect(estimateHeight('post_1')).toBe(ESTIMATED_POST_HEIGHT);
    expect(estimateHeight('post_2')).toBe(ESTIMATED_POST_HEIGHT);
  });

  it('survives a reload through sessionStorage', () => {
    rememberHeight('post_1', 240);
    flushHeights();

    // A fresh page: in-memory state is gone, storage is not.
    clearHeights();

    expect(estimateHeight('post_1')).toBe(240);
  });

  it('keys heights by post ID so they survive reordering', () => {
    rememberHeight('post_a', 200);
    rememberHeight('post_b', 300);
    flushHeights();
    clearHeights();

    expect(estimateHeight('post_b')).toBe(300);
    expect(estimateHeight('post_a')).toBe(200);
  });

  it('bounds what it writes so a long session cannot fill storage', () => {
    for (let i = 0; i < MAX_CACHED_HEIGHTS + 50; i += 1) {
      rememberHeight(`post_${i}`, 100 + i);
    }
    flushHeights();

    const stored = JSON.parse(
      sessionStorage.getItem(HEIGHTS_STORAGE_KEY) ?? '{}',
    ) as Record<string, number>;
    expect(Object.keys(stored)).toHaveLength(MAX_CACHED_HEIGHTS);
    // The most recently measured posts are the ones worth keeping.
    expect(stored[`post_${MAX_CACHED_HEIGHTS + 49}`]).toBeDefined();
    expect(stored.post_0).toBeUndefined();
  });

  it('batches writes instead of touching storage on every measurement', () => {
    vi.useFakeTimers();

    rememberHeight('post_1', 200);
    rememberHeight('post_2', 210);
    rememberHeight('post_3', 220);
    expect(sessionStorage.getItem(HEIGHTS_STORAGE_KEY)).toBeNull();

    vi.runAllTimers();

    expect(
      JSON.parse(sessionStorage.getItem(HEIGHTS_STORAGE_KEY) ?? '{}'),
    ).toEqual({ post_1: 200, post_2: 210, post_3: 220 });
  });

  it('keeps working when storage is unavailable', () => {
    // Safari private mode: reading the property itself can throw.
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    clearHeights();

    expect(() => rememberHeight('post_1', 240)).not.toThrow();
    expect(() => flushHeights()).not.toThrow();
    // Still useful in memory for this page's lifetime.
    expect(estimateHeight('post_1')).toBe(240);
  });

  it('ignores corrupted storage instead of failing to render', () => {
    sessionStorage.setItem(HEIGHTS_STORAGE_KEY, '{not json');
    clearHeights();

    expect(estimateHeight('post_1')).toBe(ESTIMATED_POST_HEIGHT);
  });

  it('ignores stored entries that are not positive numbers', () => {
    sessionStorage.setItem(
      HEIGHTS_STORAGE_KEY,
      JSON.stringify({ post_1: 'tall', post_2: -5, post_3: 190 }),
    );
    clearHeights();

    expect(estimateHeight('post_1')).toBe(ESTIMATED_POST_HEIGHT);
    expect(estimateHeight('post_2')).toBe(ESTIMATED_POST_HEIGHT);
    expect(estimateHeight('post_3')).toBe(190);
  });
});
