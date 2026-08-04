'use client';

/**
 * The `X-Degraded` side channel, exposed to features without giving them
 * api-client. @see docs/frontend/04-modules/api-client.md §8
 */
import { degradation } from '@/api-client';

export function subscribeDegraded(
  listener: (scopes: string[]) => void,
): () => void {
  return degradation.subscribe(listener);
}
