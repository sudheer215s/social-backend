import type { Config } from 'tailwindcss';

/**
 * Tailwind config — colours map to CSS variables from design-system tokens.
 * @see docs/frontend/04-modules/design-system.md §2
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './features/**/*.{ts,tsx}',
    './ui/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: 'rgb(var(--bg) / <alpha-value>)',
          subtle: 'rgb(var(--bg-subtle) / <alpha-value>)',
          inset: 'rgb(var(--bg-inset) / <alpha-value>)',
        },
        fg: {
          DEFAULT: 'rgb(var(--fg) / <alpha-value>)',
          muted: 'rgb(var(--fg-muted) / <alpha-value>)',
        },
        border: 'rgb(var(--border) / <alpha-value>)',
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          fg: 'rgb(var(--accent-fg) / <alpha-value>)',
        },
        danger: 'rgb(var(--danger) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
      },
      minHeight: {
        tap: 'var(--tap-min)',
      },
      minWidth: {
        tap: 'var(--tap-min)',
      },
      spacing: {
        // 4px base scale referenced by design-system
        px: '1px',
      },
    },
  },
  plugins: [],
};

export default config;
