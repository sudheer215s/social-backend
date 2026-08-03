'use client';

/**
 * Trivial authenticated surface for F0 exit criterion:
 * "A trivial authenticated screen renders against MSW end to end".
 * Real SessionBoundary lands in F1.
 */
import { useMe } from '@/data/queries/me';

export function SessionProbe() {
  const { data, isLoading, isError, error } = useMe(true);

  if (isLoading) {
    return <p role="status">Loading session…</p>;
  }

  if (isError) {
    return (
      <p role="alert">
        Session error
        {error instanceof Error ? `: ${error.message}` : ''}
      </p>
    );
  }

  if (!data) {
    return <p role="status">No session</p>;
  }

  return (
    <section aria-label="Current user">
      <h1>Hello, {data.display_name ?? data.username}</h1>
      <p data-testid="username">@{data.username}</p>
    </section>
  );
}
