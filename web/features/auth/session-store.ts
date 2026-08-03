'use client';

import { create } from 'zustand';
import {
  initialSession,
  sessionReduce,
  type SessionContext,
  type SessionEvent,
  type SessionLostReason,
  type SessionStatus,
} from './session-machine';

type SessionStore = SessionContext & {
  dispatch: (event: SessionEvent) => void;
  /** Test helper */
  _reset: () => void;
};

export const useSessionStore = create<SessionStore>((set, get) => ({
  ...initialSession,
  dispatch: (event) => {
    set(sessionReduce(get(), event));
  },
  _reset: () => set({ ...initialSession }),
}));

export function getSessionStatus(): SessionStatus {
  return useSessionStore.getState().status;
}

export function dispatchSession(event: SessionEvent): void {
  useSessionStore.getState().dispatch(event);
}

export type { SessionContext, SessionEvent, SessionLostReason, SessionStatus };
