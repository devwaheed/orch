/** Sessions store. Fed by session.changed; each event replaces the session it carries. */
import { create } from 'zustand';
import type { Session } from '@orchagents/contracts';

export interface SessionsState {
  readonly sessions: readonly Session[];
  setSessions(sessions: readonly Session[]): void;
  upsertSession(session: Session): void;
}

export const useSessionsStore = create<SessionsState>()((set) => ({
  sessions: [],
  setSessions: (sessions) => set({ sessions: [...sessions] }),
  upsertSession: (session) =>
    set((s) => {
      const index = s.sessions.findIndex((x) => x.id === session.id);
      if (index === -1) {
        return { sessions: [...s.sessions, session] };
      }
      return { sessions: s.sessions.map((x, i) => (i === index ? session : x)) };
    }),
}));
