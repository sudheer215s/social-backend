'use client';

import type { ReactNode } from 'react';
import { AppShell } from '@/features/auth/AppShell';
import { RequireAuth } from '@/features/auth/RequireAuth';

/**
 * Authenticated app chrome. All routes under (app) require a session.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}
