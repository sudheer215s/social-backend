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
        <a
          href="/login"
          className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-DEFAULT bg-accent px-4 text-sm font-medium text-accent-fg no-underline hover:opacity-90"
        >
          Log in
        </a>
        <a
          href="/register"
          className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-DEFAULT border border-border bg-bg-subtle px-4 text-sm font-medium text-fg no-underline hover:bg-bg-inset"
        >
          Sign up
        </a>
      </nav>
    </main>
  );
}
