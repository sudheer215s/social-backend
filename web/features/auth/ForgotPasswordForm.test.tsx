import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '@/api-client';
import * as password from '@/data/session/password';
import { ForgotPasswordForm } from './ForgotPasswordForm';

async function submit(email: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/email/i), email);
  await user.click(screen.getByRole('button', { name: /send/i }));
}

describe('ForgotPasswordForm (F1-T05b)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows byte-identical copy for a registered and an unknown address', async () => {
    vi.spyOn(password, 'requestPasswordReset').mockResolvedValue(undefined);

    const known = render(<ForgotPasswordForm />);
    await submit('known@example.com');
    const knownCopy = await screen.findByTestId('forgot-ack');
    const knownText = knownCopy.textContent;
    known.unmount();

    render(<ForgotPasswordForm />);
    await submit('unknown@example.com');
    const unknownCopy = await screen.findByTestId('forgot-ack');

    expect(unknownText(knownText)).toBe(unknownCopy.textContent);
    expect(unknownCopy).toHaveTextContent(password.FORGOT_PASSWORD_ACK);
  });

  it('does not claim a link was sent when rate limited', async () => {
    vi.spyOn(password, 'requestPasswordReset').mockRejectedValue(
      new ApiError(429, {
        type: 'about:blank',
        title: 'Too many',
        status: 429,
        retryAfter: 60,
      }),
    );

    render(<ForgotPasswordForm />);
    await submit('a@example.com');

    await waitFor(() => {
      expect(screen.getByTestId('forgot-error')).toHaveTextContent(
        /60 seconds/,
      );
    });
    expect(screen.queryByTestId('forgot-ack')).toBeNull();
  });

  it('keeps the form usable after a network failure', async () => {
    vi.spyOn(password, 'requestPasswordReset').mockRejectedValue(
      new NetworkError(),
    );

    render(<ForgotPasswordForm />);
    await submit('a@example.com');

    await waitFor(() => {
      expect(screen.getByTestId('forgot-error')).toHaveTextContent(/network/i);
    });
    expect(screen.getByRole('button', { name: /send/i })).toBeEnabled();
    expect(screen.queryByTestId('forgot-ack')).toBeNull();
  });

  it('validates format client-side without calling the API', async () => {
    const spy = vi
      .spyOn(password, 'requestPasswordReset')
      .mockResolvedValue(undefined);

    render(<ForgotPasswordForm />);
    await submit('not-an-email');

    await waitFor(() => {
      expect(screen.getByText(/valid email address/i)).toBeInTheDocument();
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('replaces the form with the acknowledgement so it cannot be resubmitted', async () => {
    vi.spyOn(password, 'requestPasswordReset').mockResolvedValue(undefined);

    render(<ForgotPasswordForm />);
    await submit('a@example.com');

    await screen.findByTestId('forgot-ack');
    expect(screen.queryByRole('button', { name: /send/i })).toBeNull();
  });
});

/** Guards against a null textContent silently passing the comparison. */
function unknownText(value: string | null): string {
  expect(value).toBeTruthy();
  return value ?? '';
}
