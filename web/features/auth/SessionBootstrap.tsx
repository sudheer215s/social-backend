'use client';

import { useEffect } from 'react';
import { bootSession } from './boot-session';

/** Mounts once in the root providers to start the session machine. */
export function SessionBootstrap() {
  useEffect(() => {
    void bootSession();
  }, []);
  return null;
}
