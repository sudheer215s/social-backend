'use client';

/**
 * Gates UI on the session machine. Unknown renders nothing (no auth flash).
 * Refreshing is transparent. Bootstrapping shows a real-layout skeleton.
 * @see docs/frontend/03-flows.md §1
 */
import type { ReactNode } from 'react';
import { Skeleton } from '@/ui';
import { useSessionStore } from './session-store';
import { isAuthenticatedStatus, isResolvingStatus } from './session-machine';

export type SessionBoundaryProps = {
  children: ReactNode;
  /** Content for anonymous visitors (e.g. redirect or public shell). */
  fallback?: ReactNode;
  /** When true, only authenticated/refreshing may see children. */
  requireAuth?: boolean;
};

export function SessionBoundary({
  children,
  fallback = null,
  requireAuth = false,
}: SessionBoundaryProps) {
  const status = useSessionStore((s) => s.status);
  const lostReason = useSessionStore((s) => s.lostReason);

  if (status === 'unknown') {
    return null;
  }

  if (status === 'bootstrapping') {
    return (
      <div
        className="mx-auto flex max-w-lg flex-col gap-4 px-6 py-12"
        data-testid="session-bootstrapping"
      >
        <Skeleton className="h-10 w-40" label="Loading session" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (status === 'offline') {
    return (
      <div role="status" className="px-6 py-4 text-fg-muted">
        You appear to be offline. We&apos;ll reconnect automatically.
      </div>
    );
  }

  if (requireAuth && !isAuthenticatedStatus(status)) {
    return (
      <div data-testid="session-anonymous-fallback">
        {fallback}
        {lostReason === 'security' ? (
          <p role="alert" className="px-6 text-sm text-danger">
            You were signed out for your protection. Please sign in again.
          </p>
        ) : null}
      </div>
    );
  }

  // authenticating / authenticated / refreshing / anonymous (when not required)
  return <>{children}</>;
}

export { isAuthenticatedStatus, isResolvingStatus };
