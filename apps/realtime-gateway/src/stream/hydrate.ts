/**
 * Hydrate notification pointers via notification-service.
 * Uses service token so realtime does not need the user's JWT on the wire.
 */
export async function hydrateNotifications(
  baseUrl: string,
  userId: string,
  ids: string[],
  serviceToken?: string,
): Promise<Map<string, unknown>> {
  const map = new Map<string, unknown>();
  if (ids.length === 0) return map;
  const headers: Record<string, string> = {
    accept: 'application/json',
    'x-user-id': userId,
  };
  if (serviceToken) {
    headers['x-service-token'] = serviceToken;
  }
  try {
    const q = encodeURIComponent(ids.join(','));
    const res = await fetch(`${baseUrl}/v1/notifications/batch?ids=${q}`, {
      headers,
    });
    if (!res.ok) return map;
    const json = (await res.json()) as {
      items?: Array<{ id?: string } & Record<string, unknown>>;
    };
    for (const item of json.items ?? []) {
      if (typeof item.id === 'string') {
        map.set(item.id, item);
      }
    }
  } catch {
    // pointer-only fallback
  }
  return map;
}
