'use client';

/**
 * Cold-boot orchestration — uses data/ for network, owns session machine.
 * @see docs/frontend/03-flows.md §2
 */
import {
  silentRefresh,
  subscribeSessionLost,
  resetSessionApiForTests,
} from '@/data/session/api';
import { dispatchSession } from './session-store';

let booted = false;

export function resetBootForTests(): void {
  booted = false;
  resetSessionApiForTests();
}

export async function bootSession(): Promise<void> {
  if (booted) return;
  booted = true;

  subscribeSessionLost((detail) => {
    dispatchSession({
      type: 'REFRESH_UNAUTHORIZED',
      reason: detail.reason,
    });
  });

  dispatchSession({ type: 'APP_MOUNT' });

  const result = await silentRefresh();
  if (result === 'ok') {
    dispatchSession({ type: 'REFRESH_OK' });
  } else if (result === 'unauthorized') {
    dispatchSession({ type: 'REFRESH_UNAUTHORIZED', reason: 'expired' });
  } else {
    dispatchSession({ type: 'NETWORK_ERROR' });
  }
}
