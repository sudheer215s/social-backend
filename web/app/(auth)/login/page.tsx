'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { LoginForm } from '@/features/auth/LoginForm';
import { safeNextPath } from '@/lib/safe-next';

function LoginContent() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get('next'));

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-12">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-fg">Log in</h1>
        <p className="text-sm text-fg-muted">
          New here?{' '}
          <a href="/register" className="text-accent">
            Create an account
          </a>
        </p>
      </div>
      <LoginForm
        onSuccess={() => {
          router.replace(next);
        }}
      />
      <p className="text-sm text-fg-muted">
        <a href="/forgot-password" className="text-accent">
          Forgot your password?
        </a>
      </p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="p-6">Loading…</main>}>
      <LoginContent />
    </Suspense>
  );
}
