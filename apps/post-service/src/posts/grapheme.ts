/**
 * User-perceived character count (grapheme clusters), not UTF-16 code units.
 * Falls back to code-point count when Segmenter is unavailable.
 */
export function graphemeLength(text: string): number {
  if (text.length === 0) return 0;
  try {
    // Node 22+ / modern runtimes
    const Seg = (
      Intl as unknown as {
        Segmenter?: new (
          locales?: string | string[],
          options?: { granularity: string },
        ) => { segment: (s: string) => Iterable<unknown> };
      }
    ).Segmenter;
    if (Seg) {
      const segmenter = new Seg(undefined, { granularity: 'grapheme' });
      let n = 0;
      for (const _ of segmenter.segment(text)) n += 1;
      return n;
    }
  } catch {
    // fall through
  }
  return [...text].length;
}

export const MAX_POST_GRAPHEMES = 280;
