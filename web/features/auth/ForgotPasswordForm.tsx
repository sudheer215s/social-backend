'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  FORGOT_PASSWORD_ACK,
  mapTokenActionError,
  requestPasswordReset,
} from '@/data/session/password';
import { Button, Input } from '@/ui';
import {
  forgotPasswordSchema,
  type ForgotPasswordValues,
} from './auth-schemas';

/**
 * The acknowledgement is unconditional: the data layer already collapses
 * "no such account" into success, and this form must not re-introduce a branch.
 * @see docs/frontend/03-flows.md §3
 */
export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await requestPasswordReset(values);
      setSent(true);
    } catch (err) {
      // Only account-independent failures reach here (rate limit, outage), so
      // reporting them cannot leak whether the address is registered.
      setFormError(mapTokenActionError(err).message);
    }
  });

  if (sent) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-fg" role="status" data-testid="forgot-ack">
          {FORGOT_PASSWORD_ACK}
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
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="space-y-1">
        <label htmlFor="forgot-email" className="text-sm font-medium text-fg">
          Email
        </label>
        <Input
          id="forgot-email"
          type="email"
          autoComplete="email"
          {...register('email')}
        />
        {errors.email ? (
          <p className="text-sm text-danger" role="alert">
            {errors.email.message}
          </p>
        ) : null}
      </div>

      {formError ? (
        <p
          className="text-sm text-danger"
          role="alert"
          data-testid="forgot-error"
        >
          {formError}
        </p>
      ) : null}

      <Button type="submit" variant="primary" disabled={isSubmitting}>
        {isSubmitting ? 'Sending…' : 'Send reset link'}
      </Button>
    </form>
  );
}
