import { Button } from '@/ui';

/**
 * Logged-out landing (static). Authenticated home lives under (app)/home.
 * @see docs/frontend/01-architecture.md §7
 */
export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-6 px-6 py-12">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-fg">
          Social
        </h1>
        <p className="text-fg-muted">A distributed social media client.</p>
      </div>
      <nav aria-label="Account" className="flex flex-wrap gap-3">
        <Button asChild variant="primary">
          <a href="/login">Log in</a>
        </Button>
        <Button asChild variant="secondary">
          <a href="/register">Sign up</a>
        </Button>
      </nav>
    </main>
  );
}
