// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Monorepo boundary rules (P0-T04):
 * - apps may only depend on @social/platform-* (not other apps)
 * - libs may not import apps
 */
const APP_PACKAGES = [
  '@social/api-gateway',
  '@social/identity-service',
  '@social/post-service',
  '@social/graph-service',
  '@social/timeline-service',
  '@social/notification-service',
  '@social/search-service',
  '@social/realtime-gateway',
  '@social/hello-service',
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      'eslint.config.mjs',
      'scripts/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
  {
    files: ['apps/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: APP_PACKAGES.map((name) => ({
            name,
            message:
              'Apps must not import other apps; use platform libs or HTTP/gRPC.',
          })),
          patterns: [
            {
              group: ['**/apps/*/src/**', '**/apps/*/src/*'],
              message:
                'Relative imports into another app are forbidden (service boundary).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['libs/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: APP_PACKAGES.map((name) => ({
            name,
            message: 'Platform libs must not depend on application packages.',
          })),
          patterns: [
            {
              group: ['**/apps/**'],
              message: 'Platform libs must not import from apps/.',
            },
          ],
        },
      ],
    },
  },
);
