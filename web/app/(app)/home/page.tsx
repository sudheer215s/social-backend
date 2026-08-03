'use client';

import { SessionBoundary, SessionProbe } from '@/features/auth';

/**
 * Authenticated home shell (CSR). Full timeline lands in F2.
 * @see docs/frontend/01-architecture.md §7
 */
export default function HomePage() {
  return (
    <SessionBoundary
      requireAuth
      fallback={
        <main className="mx-auto max-w-lg px-6 py-12">
          <p className="text-fg-muted">
            Please{' '}
            <a href="/login?next=/home" className="text-accent">
              log in
            </a>{' '}
            to view your home feed.
          </p>
        </main>
      }
    >
      <main className="mx-auto max-w-lg px-6 py-12">
        <SessionProbe />
      </main>
    </SessionBoundary>
  );
}
