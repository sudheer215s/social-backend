'use client';

/**
 * Unverified users may read but not post/follow/like — normal state, not an error.
 * @see docs/frontend/04-modules/feature-modules.md — UnverifiedGate
 */
import type { ReactElement, ReactNode } from 'react';
import { useMe } from '@/data/queries/me';
import { Skeleton } from '@/ui';

export type UnverifiedAction = 'post' | 'follow' | 'like' | 'generic';

export type UnverifiedGateProps = {
  action?: UnverifiedAction;
  children: ReactNode;
  /** Optional custom blocked UI; default is disabled children + reason. */
  fallback?: ReactNode;
};

const REASON: Record<UnverifiedAction, string> = {
  post: 'Verify your email to post',
  follow: 'Verify your email to follow people',
  like: 'Verify your email to like posts',
  generic: 'Verify your email to continue',
};

export function UnverifiedGate({
  action = 'generic',
  children,
  fallback,
}: UnverifiedGateProps) {
  const { data, isLoading, isError } = useMe(true);

  if (isLoading) {
    return <Skeleton className="h-11 w-full" label="Checking verification" />;
  }

  // Fail open for network errors on read-only paths would be wrong for writes;
  // treat unknown as unverified for mutating actions (safer).
  const verified = data?.email_verified === true;

  if (isError || !verified) {
    if (fallback !== undefined) return <>{fallback}</>;
    return (
      <div
        data-testid="unverified-gate"
        className="space-y-2 rounded-DEFAULT border border-border bg-bg-subtle p-3"
      >
        <p className="text-sm text-fg-muted" role="status">
          {REASON[action]}
        </p>
        <div className="pointer-events-none opacity-50" aria-disabled="true">
          {children}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

/** Shell banner — dismissible, non-blocking. */
export function VerifyEmailBanner({
  onDismiss,
}: {
  onDismiss?: () => void;
}): ReactElement | null {
  const { data, isLoading } = useMe(true);
  if (isLoading || !data || data.email_verified) return null;

  return (
    <div
      role="status"
      data-testid="verify-email-banner"
      className="flex items-center justify-between gap-3 border-b border-border bg-bg-subtle px-4 py-2 text-sm text-fg"
    >
      <p>Verify your email to post, follow, and like.</p>
      {onDismiss ? (
        <button
          type="button"
          className="min-h-tap min-w-tap text-fg-muted underline"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
