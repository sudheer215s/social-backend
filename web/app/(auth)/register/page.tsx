'use client';

import { useRouter } from 'next/navigation';
import { RegisterForm } from '@/features/auth/RegisterForm';

export default function RegisterPage() {
  const router = useRouter();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-12">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-fg">Create account</h1>
        <p className="text-sm text-fg-muted">
          Already have an account?{' '}
          <a href="/login" className="text-accent">
            Log in
          </a>
        </p>
      </div>
      <RegisterForm
        onSuccess={() => {
          router.replace('/home');
        }}
      />
    </main>
  );
}
