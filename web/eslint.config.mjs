// @ts-check
import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Six-layer import rules for the web client.
 * @see docs/frontend/01-architecture.md §6
 * @see docs/frontend/05-cross-cutting/testing.md §3
 *
 * Dependency direction (downward only):
 *   routes → features → data → clients → ui → platform
 *
 * Only api-client may call global `fetch` (FE-0013).
 */

/** @param {string[]} groups */
function ban(groups, message) {
  return {
    patterns: groups.map((group) => ({ group: [group], message })),
  };
}

export default tseslint.config(
  {
    ignores: [
      '**/.next/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/dist/**',
      'next-env.d.ts',
      'eslint.config.mjs',
      'vitest.config.ts',
      'postcss.config.mjs',
      'tailwind.config.ts',
      'api-client/generated/**',
      'scripts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
  // ui/ — no data layer, no features, no api-client
  {
    files: ['ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        ban(
          [
            '@/data',
            '@/data/**',
            '@/features',
            '@/features/**',
            '@/api-client',
            '@/api-client/**',
            '@/realtime',
            '@/realtime/**',
            '../data',
            '../data/**',
            '../features',
            '../features/**',
            '../api-client',
            '../api-client/**',
            '**/data/**',
            '**/api-client/**',
            '**/features/**',
          ],
          'ui/ may not import data, features, api-client, or realtime.',
        ),
      ],
    },
  },
  // features/ — must go through data/, never api-client directly
  {
    files: ['features/**/*.{ts,tsx}'],
    ignores: ['features/**/*.{test,spec}.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        ban(
          [
            '@/api-client',
            '@/api-client/**',
            '../api-client',
            '../api-client/**',
            '../../api-client',
            '../../api-client/**',
            '**/api-client/**',
          ],
          'features/ must not call api-client directly — use data/ hooks.',
        ),
      ],
    },
  },
  // Only api-client may call fetch
  {
    files: [
      'app/**/*.{ts,tsx}',
      'features/**/*.{ts,tsx}',
      'data/**/*.{ts,tsx}',
      'realtime/**/*.{ts,tsx}',
      'ui/**/*.{ts,tsx}',
      'lib/**/*.{ts,tsx}',
      'mocks/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message:
            'Only api-client may call fetch (auth, retries, problem+json, trace).',
        },
      ],
    },
  },
  {
    files: ['api-client/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': 'off',
    },
  },
);
