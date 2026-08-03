/**
 * Safe post-login redirect targets.
 * Only same-origin relative paths; blocks open redirects.
 */

/** Allow only in-app relative paths (no protocol-relative //). */
export function safeNextPath(
  path: string | null | undefined,
  fallback = '/home',
): string {
  if (path === undefined || path === null || path === '') return fallback;
  if (!path.startsWith('/') || path.startsWith('//')) return fallback;
  // Block scheme-like tricks: /\\evil.com, /http:...
  if (path.includes('://')) return fallback;
  return path;
}

/** Build `/login?next=` preserving the destination. */
export function loginUrlWithNext(nextPath: string): string {
  const next = safeNextPath(nextPath);
  const params = new URLSearchParams({ next });
  return `/login?${params.toString()}`;
}
