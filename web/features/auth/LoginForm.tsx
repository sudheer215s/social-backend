'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { login, mapAuthError } from '@/data/session/auth';
import { Button, Input } from '@/ui';
import { loginSchema, type LoginValues } from './auth-schemas';
import { dispatchSession } from './session-store';

export type LoginFormProps = {
  /** Called after successful login (e.g. router push). */
  onSuccess?: () => void;
};

export function LoginForm({ onSuccess }: LoginFormProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    dispatchSession({ type: 'SUBMIT_LOGIN' });
    try {
      await login(values);
      dispatchSession({ type: 'LOGIN_OK' });
      onSuccess?.();
    } catch (err) {
      dispatchSession({ type: 'LOGIN_FAIL' });
      const mapped = mapAuthError(err);
      setFormError(mapped.message);
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="space-y-1">
        <label htmlFor="login-email" className="text-sm font-medium text-fg">
          Email
        </label>
        <Input
          id="login-email"
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

      <div className="space-y-1">
        <label htmlFor="login-password" className="text-sm font-medium text-fg">
          Password
        </label>
        <Input
          id="login-password"
          type="password"
          autoComplete="current-password"
          {...register('password')}
        />
        {errors.password ? (
          <p className="text-sm text-danger" role="alert">
            {errors.password.message}
          </p>
        ) : null}
      </div>

      {formError ? (
        <p
          className="text-sm text-danger"
          role="alert"
          data-testid="login-error"
        >
          {formError}
        </p>
      ) : null}

      <Button type="submit" variant="primary" disabled={isSubmitting}>
        {isSubmitting ? 'Signing in…' : 'Log in'}
      </Button>
    </form>
  );
}
