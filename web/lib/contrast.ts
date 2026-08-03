/**
 * WCAG 2.x relative luminance and contrast ratio helpers.
 * Used to assert design tokens meet AA (4.5:1 body, 3:1 large/UI).
 * @see docs/frontend/04-modules/design-system.md §2
 */

export type Rgb = readonly [number, number, number];

function channelToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** Relative luminance (WCAG), 0–1. */
export function relativeLuminance([r, g, b]: Rgb): number {
  const R = channelToLinear(r);
  const G = channelToLinear(g);
  const B = channelToLinear(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** Contrast ratio between two colours (WCAG), ≥ 1. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsAaBody(fg: Rgb, bg: Rgb): boolean {
  return contrastRatio(fg, bg) >= 4.5;
}

export function meetsAaLarge(fg: Rgb, bg: Rgb): boolean {
  return contrastRatio(fg, bg) >= 3;
}

/** Parse "R G B" token channel string (space-separated RGB 0–255). */
export function parseRgbChannels(channels: string): Rgb {
  const parts = channels.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Invalid RGB channels: ${channels}`);
  }
  const r = parts[0]!;
  const g = parts[1]!;
  const b = parts[2]!;
  return [r, g, b];
}
