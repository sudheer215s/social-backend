'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { queryKeys } from '@/data/keys';
import {
  mapTokenActionError,
  verifyEmail,
  type TokenActionError,
} from '@/data/session/password';
import { Button } from '@/ui';

export type VerifyEmailPanelProps = {
  /** Token from the emailed link; `null` when the URL is missing or mangled. */
  token: string | null;
  onVerified?: () => void;
};

type Status = 'verifying' | 'verified' | 'invalid' | 'retryable';

/**
 * Verification tokens are single-use, so this fires exactly once per mount and
 * only offers a retry for failures that did not consume the token.
 */
export function VerifyEmailPanel({ token, onVerified }: VerifyEmailPanelProps) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>(
    token === null ? 'invalid' : 'verifying',
  );
  const [failure, setFailure] = useState<TokenActionError | null>(null);
  const attempted = useRef(false);

  const run = useCallback(async () => {
    if (token === null) return;
    setStatus('verifying');
    setFailure(null);
    try {
      await verifyEmail(token);
      // Capabilities are derived from the cached profile — drop it so the
      // banner and gates unlock without a reload.
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      setStatus('verified');
      onVerified?.();
    } catch (err) {
      const mapped = mapTokenActionError(err);
      setFailure(mapped);
      setStatus(mapped.kind === 'invalid_token' ? 'invalid' : 'retryable');
    }
  }, [token, queryClient, onVerified]);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    void run();
  }, [run]);

  if (status === 'verifying') {
    return (
      <p className="text-sm text-fg-muted" role="status">
        Verifying your email…
      </p>
    );
  }

  if (status === 'verified') {
    return (
      <div className="space-y-3" data-testid="verify-verified">
        <p className="text-sm text-fg" role="status">
          Your email is verified. You can post, follow, and like.
        </p>
        <p className="text-sm text-fg-muted">
          <a href="/home" className="text-accent">
            Go to your timeline
          </a>
        </p>
      </div>
    );
  }

  if (status === 'invalid') {
    return (
      <div className="space-y-3">
        <p
          className="text-sm text-fg"
          role="status"
          data-testid="verify-invalid"
        >
          This verification link is invalid or has expired.
        </p>
        <p className="text-sm text-fg-muted">
          <a href="/login" className="text-accent">
            Back to log in
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p
        className="text-sm text-danger"
        role="alert"
        data-testid="verify-error"
      >
        {failure?.message ?? 'Something went wrong. Please try again.'}
      </p>
      <Button
        type="button"
        variant="primary"
        onClick={() => {
          void run();
        }}
      >
        Try again
      </Button>
    </div>
  );
}
