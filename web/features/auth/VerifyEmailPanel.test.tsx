import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '@/api-client';
import { queryKeys } from '@/data/keys';
import * as password from '@/data/session/password';
import { VerifyEmailPanel } from './VerifyEmailPanel';

function wrap(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
  return { ...result, client };
}

const expiredLink = new ApiError(400, {
  type: 'about:blank',
  title: 'Invalid or expired token',
  status: 400,
});

describe('VerifyEmailPanel (F1-T05d)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('verifies automatically on mount and reports success', async () => {
    const spy = vi.spyOn(password, 'verifyEmail').mockResolvedValue(undefined);

    wrap(<VerifyEmailPanel token="tok-123" />);

    await waitFor(() => {
      expect(screen.getByTestId('verify-verified')).toBeInTheDocument();
    });
    expect(spy).toHaveBeenCalledWith('tok-123');
  });

  it('invalidates the cached profile so gates unlock without a reload', async () => {
    vi.spyOn(password, 'verifyEmail').mockResolvedValue(undefined);

    const { client } = wrap(<VerifyEmailPanel token="tok-123" />);
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.me });
    });
  });

  it('verifies once even across re-renders (tokens are single-use)', async () => {
    const spy = vi.spyOn(password, 'verifyEmail').mockResolvedValue(undefined);

    const { rerender, client } = wrap(<VerifyEmailPanel token="tok-123" />);
    rerender(
      <QueryClientProvider client={client}>
        <VerifyEmailPanel token="tok-123" />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('verify-verified')).toBeInTheDocument();
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('renders an expired link as a normal state, not an error', async () => {
    vi.spyOn(password, 'verifyEmail').mockRejectedValue(expiredLink);

    wrap(<VerifyEmailPanel token="expired-token" />);

    await waitFor(() => {
      expect(screen.getByTestId('verify-invalid')).toHaveTextContent(
        /invalid or has expired/i,
      );
    });
    expect(screen.queryByTestId('verify-verified')).toBeNull();
    expect(
      screen.getByRole('link', { name: /back to log in/i }),
    ).toHaveAttribute('href', '/login');
  });

  it('does not call the API when the URL carries no token', async () => {
    const spy = vi.spyOn(password, 'verifyEmail').mockResolvedValue(undefined);

    wrap(<VerifyEmailPanel token={null} />);

    expect(await screen.findByTestId('verify-invalid')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('offers a retry after a network failure without discarding the token', async () => {
    const spy = vi
      .spyOn(password, 'verifyEmail')
      .mockRejectedValueOnce(new NetworkError())
      .mockResolvedValueOnce(undefined);

    wrap(<VerifyEmailPanel token="tok-123" />);

    const retry = await screen.findByRole('button', { name: /try again/i });
    expect(screen.queryByTestId('verify-invalid')).toBeNull();

    await userEvent.setup().click(retry);

    await waitFor(() => {
      expect(screen.getByTestId('verify-verified')).toBeInTheDocument();
    });
    expect(spy).toHaveBeenNthCalledWith(2, 'tok-123');
  });
});
