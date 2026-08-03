import { SessionProbe } from '@/features/auth/SessionProbe';

/**
 * Authenticated home shell (CSR). Full timeline lands in F2.
 * @see docs/frontend/01-architecture.md §7
 */
export default function HomePage() {
  return (
    <main className="mx-auto max-w-lg px-6 py-12">
      <SessionProbe />
    </main>
  );
}
