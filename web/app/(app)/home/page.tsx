'use client';

import { SessionProbe } from '@/features/auth';

/**
 * Authenticated home shell (CSR). Full timeline lands in F2.
 * Auth guard lives in (app)/layout via RequireAuth.
 * @see docs/frontend/01-architecture.md §7
 */
export default function HomePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-fg">Home</h1>
      <SessionProbe />
    </div>
  );
}
