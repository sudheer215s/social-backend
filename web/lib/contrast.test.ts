import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  meetsAaBody,
  meetsAaLarge,
  parseRgbChannels,
  relativeLuminance,
} from './contrast';
import {
  bodyContrastPairs,
  darkTokens,
  largeContrastPairs,
  lightTokens,
  type TokenName,
} from './tokens';

function pairRatio(
  tokens: Record<TokenName, string>,
  fg: TokenName,
  bg: TokenName,
): number {
  return contrastRatio(
    parseRgbChannels(tokens[fg]),
    parseRgbChannels(tokens[bg]),
  );
}

describe('contrast helpers (F0-T02)', () => {
  it('computes known black/white contrast as 21:1', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
  });

  it('relative luminance of white is 1', () => {
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
  });

  it('parses space-separated RGB channels', () => {
    expect(parseRgbChannels('29 78 216')).toEqual([29, 78, 216]);
  });
});

describe('light tokens WCAG AA (F0-T02)', () => {
  it.each(bodyContrastPairs)('%s on %s meets 4.5:1', (fg, bg) => {
    expect(pairRatio(lightTokens, fg, bg)).toBeGreaterThanOrEqual(4.5);
    expect(
      meetsAaBody(
        parseRgbChannels(lightTokens[fg]),
        parseRgbChannels(lightTokens[bg]),
      ),
    ).toBe(true);
  });

  it.each(largeContrastPairs)('%s on %s meets 3:1', (fg, bg) => {
    expect(pairRatio(lightTokens, fg, bg)).toBeGreaterThanOrEqual(3);
    expect(
      meetsAaLarge(
        parseRgbChannels(lightTokens[fg]),
        parseRgbChannels(lightTokens[bg]),
      ),
    ).toBe(true);
  });
});

describe('dark tokens WCAG AA (F0-T02)', () => {
  it.each(bodyContrastPairs)('%s on %s meets 4.5:1', (fg, bg) => {
    expect(pairRatio(darkTokens, fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(largeContrastPairs)('%s on %s meets 3:1', (fg, bg) => {
    expect(pairRatio(darkTokens, fg, bg)).toBeGreaterThanOrEqual(3);
  });
});
