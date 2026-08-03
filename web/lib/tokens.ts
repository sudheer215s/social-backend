/**
 * Design token RGB channels (source of truth for contrast tests).
 * CSS mirrors these in styles/globals.css.
 * @see docs/frontend/04-modules/design-system.md §2
 */

export const lightTokens = {
  bg: '255 255 255',
  'bg-subtle': '249 250 251',
  'bg-inset': '243 244 246',
  fg: '17 24 39',
  'fg-muted': '107 114 128',
  border: '229 231 235',
  accent: '29 78 216',
  'accent-fg': '255 255 255',
  danger: '185 28 28',
  success: '21 128 61',
} as const;

export const darkTokens = {
  bg: '3 7 18',
  'bg-subtle': '17 24 39',
  'bg-inset': '31 41 55',
  fg: '243 244 246',
  'fg-muted': '156 163 175',
  border: '55 65 81',
  // Darker blue so white label text meets 4.5:1 (blue-500 fails AA for body text)
  accent: '37 99 235',
  'accent-fg': '255 255 255',
  danger: '248 113 113',
  success: '74 222 128',
} as const;

export type TokenName = keyof typeof lightTokens;

/** Pairs that must meet WCAG AA body contrast (4.5:1). */
export const bodyContrastPairs: ReadonlyArray<readonly [TokenName, TokenName]> =
  [
    ['fg', 'bg'],
    ['fg', 'bg-subtle'],
    ['fg', 'bg-inset'],
    ['fg-muted', 'bg'],
    ['accent-fg', 'accent'],
  ];

/** Pairs that must meet WCAG AA large/UI contrast (3:1). */
export const largeContrastPairs: ReadonlyArray<
  readonly [TokenName, TokenName]
> = [
  ['accent', 'bg'],
  ['danger', 'bg'],
  ['success', 'bg'],
];
