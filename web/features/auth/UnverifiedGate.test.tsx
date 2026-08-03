import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as me from '@/data/queries/me';
import { UnverifiedGate, VerifyEmailBanner } from './UnverifiedGate';

function wrap(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe('UnverifiedGate (F1-T04)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children when email is verified', async () => {
    vi.spyOn(me, 'useMe').mockReturnValue({
      data: {
        id: '1',
        username: 'alice',
        email_verified: true,
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof me.useMe>);

    wrap(
      <UnverifiedGate action="post">
        <button type="button">Compose</button>
      </UnverifiedGate>,
    );

    expect(screen.getByRole('button', { name: 'Compose' })).toBeEnabled();
    expect(screen.queryByTestId('unverified-gate')).not.toBeInTheDocument();
  });

  it('disables children with a reason when unverified (not an error)', async () => {
    vi.spyOn(me, 'useMe').mockReturnValue({
      data: {
        id: '1',
        username: 'alice',
        email_verified: false,
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof me.useMe>);

    wrap(
      <UnverifiedGate action="post">
        <button type="button">Compose</button>
      </UnverifiedGate>,
    );

    expect(screen.getByTestId('unverified-gate')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      /verify your email to post/i,
    );
    // Control still in tree but non-interactive wrapper
    expect(screen.getByRole('button', { name: 'Compose' })).toBeInTheDocument();
  });
});

describe('VerifyEmailBanner (F1-T04)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows only when unverified', async () => {
    vi.spyOn(me, 'useMe').mockReturnValue({
      data: { id: '1', username: 'a', email_verified: false },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof me.useMe>);

    wrap(<VerifyEmailBanner />);
    await waitFor(() => {
      expect(screen.getByTestId('verify-email-banner')).toBeInTheDocument();
    });
  });

  it('hides when verified', () => {
    vi.spyOn(me, 'useMe').mockReturnValue({
      data: { id: '1', username: 'a', email_verified: true },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof me.useMe>);

    const { container } = wrap(<VerifyEmailBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});
