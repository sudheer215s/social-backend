/**
 * Hydrate notification pointers via notification-service HTTP.
 * Failures return empty — client still got the pointer event.
 */
export async function hydrateNotifications(
  baseUrl: string,
  userId: string,
  ids: string[],
  authorization?: string,
): Promise<unknown[]> {
  if (ids.length === 0) return [];
  const headers: Record<string, string> = { accept: 'application/json' };
  // Internal hydrate uses a service token header when no user JWT is available.
  // For SSE tickets we pass user id; notification batch requires JWT today.
  // Pointer-only delivery is the fallback.
  if (authorization) {
    headers.authorization = authorization;
  }
  headers['x-user-id'] = userId;
  try {
    const q = encodeURIComponent(ids.join(','));
    const res = await fetch(`${baseUrl}/v1/notifications/batch?ids=${q}`, {
      headers,
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { items?: unknown[] };
    return json.items ?? [];
  } catch {
    return [];
  }
}
