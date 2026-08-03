import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '@/api-client';
import * as password from '@/data/session/password';
import { ResetPasswordForm } from './ResetPasswordForm';

async function fill(newPassword: string, confirm = newPassword) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/^new password$/i), newPassword);
  await user.type(screen.getByLabelText(/confirm/i), confirm);
  await user.click(screen.getByRole('button', { name: /reset password/i }));
}

describe('ResetPasswordForm (F1-T05c)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls onSuccess after the password is changed', async () => {
    const onSuccess = vi.fn();
    const spy = vi
      .spyOn(password, 'resetPassword')
      .mockResolvedValue(undefined);

    render(<ResetPasswordForm token="tok-123" onSuccess={onSuccess} />);
    await fill('new-password-1');

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
    });
    expect(spy).toHaveBeenCalledWith({
      token: 'tok-123',
      password: 'new-password-1',
    });
  });

  it('offers a way out when the link is invalid or expired', async () => {
    vi.spyOn(password, 'resetPassword').mockRejectedValue(
      new ApiError(400, {
        type: 'about:blank',
        title: 'Invalid or expired token',
        status: 400,
      }),
    );

    render(<ResetPasswordForm token="expired" />);
    await fill('new-password-1');

    await waitFor(() => {
      expect(screen.getByTestId('reset-error')).toHaveTextContent(
        /invalid or has expired/i,
      );
    });
    expect(
      screen.getByRole('link', { name: /request a new link/i }),
    ).toHaveAttribute('href', '/forgot-password');
  });

  it('renders the invalid-link state immediately when the URL has no token', () => {
    const spy = vi
      .spyOn(password, 'resetPassword')
      .mockResolvedValue(undefined);

    render(<ResetPasswordForm token={null} />);

    expect(screen.getByTestId('reset-error')).toHaveTextContent(
      /invalid or has expired/i,
    );
    expect(screen.queryByLabelText(/^new password$/i)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('blocks submission when the confirmation does not match', async () => {
    const spy = vi
      .spyOn(password, 'resetPassword')
      .mockResolvedValue(undefined);

    render(<ResetPasswordForm token="tok-123" />);
    await fill('new-password-1', 'different-password');

    await waitFor(() => {
      expect(screen.getByText(/do not match/i)).toBeInTheDocument();
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('attaches server password-policy errors to the password field', async () => {
    vi.spyOn(password, 'resetPassword').mockRejectedValue(
      new ApiError(422, {
        type: 'about:blank',
        title: 'Weak password',
        status: 422,
        errors: [{ field: 'password', message: 'That password is too common' }],
      }),
    );

    render(<ResetPasswordForm token="tok-123" />);
    await fill('new-password-1');

    await waitFor(() => {
      expect(screen.getByText(/too common/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('link', { name: /request a new link/i }),
    ).toBeNull();
  });

  it('lets the user retry after a network failure without re-entering the link', async () => {
    vi.spyOn(password, 'resetPassword').mockRejectedValue(new NetworkError());

    render(<ResetPasswordForm token="tok-123" />);
    await fill('new-password-1');

    await waitFor(() => {
      expect(screen.getByTestId('reset-error')).toHaveTextContent(/network/i);
    });
    expect(
      screen.getByRole('button', { name: /reset password/i }),
    ).toBeEnabled();
    expect(
      screen.queryByRole('link', { name: /request a new link/i }),
    ).toBeNull();
  });
});
