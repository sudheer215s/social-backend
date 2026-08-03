/**
 * Logged-out landing (static). Authenticated home lives under (app)/home.
 * @see docs/frontend/01-architecture.md §7
 */
export default function LandingPage() {
  return (
    <main>
      <h1>Social</h1>
      <p>A distributed social media client.</p>
      <nav aria-label="Account">
        <a href="/login">Log in</a>
        <a href="/register">Sign up</a>
      </nav>
    </main>
  );
}
