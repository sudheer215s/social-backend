'use client';

import { ForgotPasswordForm } from '@/features/auth/ForgotPasswordForm';

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-12">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-fg">Reset your password</h1>
        <p className="text-sm text-fg-muted">
          Enter your email and we&apos;ll send you a link to choose a new
          password.
        </p>
      </div>
      <ForgotPasswordForm />
    </main>
  );
}
