'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ResetPasswordForm } from '@/features/auth/ResetPasswordForm';

function ResetPasswordContent() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token');

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-12">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-fg">
          Choose a new password
        </h1>
        <p className="text-sm text-fg-muted">
          Resetting signs you out everywhere, so you&apos;ll log in again with
          the new password.
        </p>
      </div>
      <ResetPasswordForm
        token={token}
        onSuccess={() => {
          router.replace('/login');
        }}
      />
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<main className="p-6">Loading…</main>}>
      <ResetPasswordContent />
    </Suspense>
  );
}
