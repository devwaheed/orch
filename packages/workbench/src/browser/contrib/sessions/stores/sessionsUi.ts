/**
 * Sessions area UI state: the filter, the selected session, the resume option the person
 * picked, and the last resume error. Session data itself lives in services/stores/sessions.ts.
 */
import { create } from 'zustand';
import type { OrchError, ResumeMode, SessionId } from '@orch/contracts';
import type { SessionFilter } from '../model/sessionsView.js';

export interface SessionsUiState {
  readonly filter: SessionFilter;
  readonly selectedId: SessionId | null;
  /** The option the person picked for the selected session; null means the default. */
  readonly chosenMode: ResumeMode | null;
  readonly resuming: boolean;
  readonly error: OrchError | null;
  setFilter(filter: SessionFilter): void;
  select(id: SessionId): void;
  chooseMode(mode: ResumeMode): void;
  setResuming(resuming: boolean): void;
  setError(error: OrchError | null): void;
}

export const useSessionsUiStore = create<SessionsUiState>()((set) => ({
  filter: 'all',
  selectedId: null,
  chosenMode: null,
  resuming: false,
  error: null,
  setFilter: (filter) => set({ filter, error: null }),
  select: (id) => set({ selectedId: id, chosenMode: null, error: null }),
  chooseMode: (mode) => set({ chosenMode: mode, error: null }),
  setResuming: (resuming) => set({ resuming }),
  setError: (error) => set({ error }),
}));
