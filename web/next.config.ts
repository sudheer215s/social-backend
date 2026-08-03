import type { NextConfig } from 'next';

/**
 * Next.js 15 App Router config for @social/web.
 * Authenticated routes are CSR; public routes may use SSR/ISR (docs/frontend/01-architecture.md §5).
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Standalone output for container deploys near the cluster.
  output: 'standalone',
  // Layer-boundary ESLint lives in package lint (F0-T03); do not fail builds on root Nest rules.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
