'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { mapAuthError, register as registerUser } from '@/data/session/auth';
import { Button, Input } from '@/ui';
import { registerSchema, type RegisterValues } from './auth-schemas';
import { dispatchSession } from './session-store';

export type RegisterFormProps = {
  onSuccess?: () => void;
};

export function RegisterForm({ onSuccess }: RegisterFormProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    dispatchSession({ type: 'SUBMIT_LOGIN' });
    try {
      await registerUser(values);
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
        <label htmlFor="reg-email" className="text-sm font-medium text-fg">
          Email
        </label>
        <Input
          id="reg-email"
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
        <label htmlFor="reg-username" className="text-sm font-medium text-fg">
          Username
        </label>
        <Input
          id="reg-username"
          autoComplete="username"
          {...register('username')}
        />
        {errors.username ? (
          <p className="text-sm text-danger" role="alert">
            {errors.username.message}
          </p>
        ) : null}
      </div>

      <div className="space-y-1">
        <label htmlFor="reg-password" className="text-sm font-medium text-fg">
          Password
        </label>
        <Input
          id="reg-password"
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

      {formError ? (
        <p
          className="text-sm text-danger"
          role="alert"
          data-testid="register-error"
        >
          {formError}
        </p>
      ) : null}

      <Button type="submit" variant="primary" disabled={isSubmitting}>
        {isSubmitting ? 'Creating account…' : 'Sign up'}
      </Button>
    </form>
  );
}
