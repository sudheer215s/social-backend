import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearScrollOffset,
  loadScrollOffset,
  saveScrollOffset,
  SCROLL_STORAGE_KEY,
} from './scroll-position';

describe('timeline scroll position (F2-T06)', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips a positive offset', () => {
    saveScrollOffset(1240);
    expect(loadScrollOffset()).toBe(1240);
    expect(sessionStorage.getItem(SCROLL_STORAGE_KEY)).toBe('1240');
  });

  it('rounds fractional offsets', () => {
    saveScrollOffset(100.6);
    expect(loadScrollOffset()).toBe(101);
  });

  it('rejects nonsense values', () => {
    saveScrollOffset(-10);
    saveScrollOffset(Number.NaN);
    expect(loadScrollOffset()).toBeNull();
  });

  it('clears the stored offset', () => {
    saveScrollOffset(500);
    clearScrollOffset();
    expect(loadScrollOffset()).toBeNull();
  });

  it('survives corrupt storage', () => {
    sessionStorage.setItem(SCROLL_STORAGE_KEY, 'nope');
    expect(loadScrollOffset()).toBeNull();
  });

  it('keeps working when storage is unavailable', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    });
    expect(() => saveScrollOffset(100)).not.toThrow();
    expect(loadScrollOffset()).toBeNull();
    expect(() => clearScrollOffset()).not.toThrow();
  });
});
