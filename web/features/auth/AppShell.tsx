'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { logout } from '@/data/session/auth';
import { Button } from '@/ui';
import { dispatchSession } from './session-store';
import { VerifyEmailBanner } from './UnverifiedGate';

/**
 * Minimal authenticated chrome (nav + logout). Expand in later F1 tasks.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  async function onLogout() {
    setBusy(true);
    try {
      await logout();
      queryClient.clear();
      dispatchSession({ type: 'LOGOUT' });
      router.replace('/');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <nav aria-label="Primary" className="flex items-center gap-4">
            <a href="/home" className="font-semibold text-fg no-underline">
              Social
            </a>
            <a href="/home" className="text-sm text-fg-muted no-underline">
              Home
            </a>
          </nav>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              void onLogout();
            }}
          >
            {busy ? 'Signing out…' : 'Log out'}
          </Button>
        </div>
      </header>
      {!bannerDismissed ? (
        <VerifyEmailBanner onDismiss={() => setBannerDismissed(true)} />
      ) : null}
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
