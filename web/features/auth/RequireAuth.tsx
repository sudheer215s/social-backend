'use client';

/**
 * Client-side auth guard for (app) routes.
 * Anonymous users are redirected to /login?next=<current path>.
 * @see docs/frontend/03-flows.md §1
 * @see docs/frontend/04-modules/feature-modules.md — SessionBoundary
 */
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { loginUrlWithNext } from '@/lib/safe-next';
import { SessionBoundary } from './SessionBoundary';
import { isAuthenticatedStatus } from './session-machine';
import { useSessionStore } from './session-store';

export type RequireAuthProps = {
  children: ReactNode;
};

export function RequireAuth({ children }: RequireAuthProps) {
  const status = useSessionStore((s) => s.status);
  const pathname = usePathname() || '/home';
  const router = useRouter();

  useEffect(() => {
    if (status === 'anonymous' || status === 'authenticating') {
      router.replace(loginUrlWithNext(pathname));
    }
  }, [status, pathname, router]);

  return (
    <SessionBoundary
      requireAuth
      fallback={
        <div
          className="mx-auto max-w-lg px-6 py-12 text-fg-muted"
          data-testid="require-auth-redirecting"
        >
          Redirecting to log in…
        </div>
      }
    >
      {isAuthenticatedStatus(status) ? children : null}
    </SessionBoundary>
  );
}
