import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as auth from '@/data/session/auth';
import * as me from '@/data/queries/me';
import { AppShell } from './AppShell';
import { useSessionStore } from './session-store';

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

function wrap(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe('AppShell logout (F1-T04)', () => {
  beforeEach(() => {
    replace.mockClear();
    useSessionStore.getState()._reset();
    useSessionStore.setState({ status: 'authenticated' });
    vi.spyOn(me, 'useMe').mockReturnValue({
      data: { id: '1', username: 'a', email_verified: true },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof me.useMe>);
  });

  afterEach(() => {
    useSessionStore.getState()._reset();
    vi.restoreAllMocks();
  });

  it('logs out locally even if network fails and redirects home', async () => {
    const user = userEvent.setup();
    vi.spyOn(auth, 'logout').mockResolvedValue(undefined);

    wrap(
      <AppShell>
        <p>Feed</p>
      </AppShell>,
    );

    await user.click(screen.getByRole('button', { name: /log out/i }));

    await waitFor(() => {
      expect(auth.logout).toHaveBeenCalled();
      expect(replace).toHaveBeenCalledWith('/');
    });
    expect(useSessionStore.getState().status).toBe('anonymous');
  });
});
