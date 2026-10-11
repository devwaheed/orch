/**
 * Local store for auto-resume checkbox state per run.
 * The core host does not send autoResume in run events (contract gap),
 * so we track it locally with the database default (true) as the initial value.
 */
import { create } from 'zustand';

interface AutoResumeState {
  readonly states: Readonly<Record<string, boolean>>;
  getAutoResume(runId: string): boolean;
  setAutoResume(runId: string, on: boolean): void;
}

export const useAutoResumeStore = create<AutoResumeState>()((set, get) => ({
  states: {},
  getAutoResume: (runId) => get().states[runId] ?? true,
  setAutoResume: (runId, on) =>
    set((s) => ({ states: { ...s.states, [runId]: on } })),
}));