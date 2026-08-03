import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api-client';
import * as auth from '@/data/session/auth';
import { LoginForm } from './LoginForm';
import { useSessionStore } from './session-store';

describe('LoginForm (F1-T02)', () => {
  beforeEach(() => {
    useSessionStore.getState()._reset();
    useSessionStore.setState({ status: 'anonymous' });
  });

  afterEach(() => {
    useSessionStore.getState()._reset();
    vi.restoreAllMocks();
  });

  it('shows identical form-level error for 401 (anti-enumeration)', async () => {
    const user = userEvent.setup();
    vi.spyOn(auth, 'login').mockRejectedValue(
      new ApiError(401, {
        type: 'about:blank',
        title: 'nope',
        status: 401,
      }),
    );

    render(<LoginForm />);
    await user.type(screen.getByLabelText(/email/i), 'user@example.com');
    await user.type(screen.getByLabelText(/password/i), 'wrong-pass');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => {
      expect(screen.getByTestId('login-error')).toHaveTextContent(
        auth.INVALID_CREDENTIALS_MESSAGE,
      );
    });
    expect(useSessionStore.getState().status).toBe('anonymous');
  });

  it('calls onSuccess and moves to authenticated on success', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    vi.spyOn(auth, 'login').mockResolvedValue({
      access_token: 't',
      expires_in: 600,
    });

    render(<LoginForm onSuccess={onSuccess} />);
    await user.type(screen.getByLabelText(/email/i), 'user@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password12');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
    });
    expect(useSessionStore.getState().status).toBe('authenticated');
  });
});
