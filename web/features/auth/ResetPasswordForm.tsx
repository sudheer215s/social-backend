'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  mapTokenActionError,
  resetPassword,
  type TokenActionError,
} from '@/data/session/password';
import { Button, Input } from '@/ui';
import { resetPasswordSchema, type ResetPasswordValues } from './auth-schemas';

export type ResetPasswordFormProps = {
  /** Token from the emailed link; `null` when the URL is missing or mangled. */
  token: string | null;
  /** Called once the password is changed — the caller sends the user to login. */
  onSuccess?: () => void;
};

const MISSING_TOKEN: TokenActionError = {
  kind: 'invalid_token',
  message:
    'This link is invalid or has expired. Request a new one to continue.',
  recoverable: true,
};

export function ResetPasswordForm({
  token,
  onSuccess,
}: ResetPasswordFormProps) {
  const [failure, setFailure] = useState<TokenActionError | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
  });

  // A missing token is the same dead end as a rejected one — say so before the
  // user types a password they will lose.
  const state = token === null ? MISSING_TOKEN : failure;

  const onSubmit = handleSubmit(async (values) => {
    if (token === null) return;
    setFailure(null);
    try {
      await resetPassword({ token, password: values.password });
      onSuccess?.();
    } catch (err) {
      const mapped = mapTokenActionError(err);
      if (mapped.fieldErrors?.password) {
        setError('password', { message: mapped.fieldErrors.password });
        return;
      }
      setFailure(mapped);
    }
  });

  return (
    <div className="space-y-4">
      {state ? (
        <div className="space-y-2">
          <p
            className="text-sm text-danger"
            role="alert"
            data-testid="reset-error"
          >
            {state.message}
          </p>
          {state.kind === 'invalid_token' ? (
            <p className="text-sm text-fg-muted">
              <a href="/forgot-password" className="text-accent">
                Request a new link
              </a>
            </p>
          ) : null}
        </div>
      ) : null}

      {token === null ? null : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="space-y-1">
            <label
              htmlFor="reset-password"
              className="text-sm font-medium text-fg"
            >
              New password
            </label>
            <Input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              {...register('password')}
            />
            {errors.password ? (
              <p className="text-sm text-danger" role="alert">
                {errors.password.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-1">
            <label
              htmlFor="reset-confirm"
              className="text-sm font-medium text-fg"
            >
              Confirm new password
            </label>
            <Input
              id="reset-confirm"
              type="password"
              autoComplete="new-password"
              {...register('confirmPassword')}
            />
            {errors.confirmPassword ? (
              <p className="text-sm text-danger" role="alert">
                {errors.confirmPassword.message}
              </p>
            ) : null}
          </div>

          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? 'Resetting…' : 'Reset password'}
          </Button>
        </form>
      )}
    </div>
  );
}
