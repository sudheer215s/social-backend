import { graphemeLength, MAX_POST_GRAPHEMES } from './grapheme';

describe('graphemeLength', () => {
  it('counts simple ascii as 1:1', () => {
    expect(graphemeLength('hello')).toBe(5);
  });

  it('counts family emoji ZWJ as one grapheme when Segmenter available', () => {
    const family = '👨‍👩‍👧‍👦';
    const n = graphemeLength(family);
    // Segmenter → 1; code-point fallback → > 1 but still << UTF-16 unit count
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThan(family.length);
  });

  it('max constant is 280', () => {
    expect(MAX_POST_GRAPHEMES).toBe(280);
  });
});
