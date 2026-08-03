'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { VerifyEmailPanel } from '@/features/auth/VerifyEmailPanel';

function VerifyEmailContent() {
  const params = useSearchParams();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-12">
      <h1 className="text-2xl font-semibold text-fg">Verify your email</h1>
      <VerifyEmailPanel token={params.get('token')} />
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<main className="p-6">Loading…</main>}>
      <VerifyEmailContent />
    </Suspense>
  );
}
