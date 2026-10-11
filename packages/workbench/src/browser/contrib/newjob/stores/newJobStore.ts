/**
 * New job draft: only what the user has picked. Defaults (JOB-08, JOB-09) are
 * not stored, so they keep following the accounts as they load or change.
 * A null pick means "use the default".
 */
import { create } from 'zustand';
import type { AgentChoice, AgentId, JobMode, LimitPolicy } from '@orch/contracts';
import {
  DEFAULT_LIMIT_POLICY,
  isModeEnabled,
  type JobFormValues,
} from '../newJobModel.js';

export interface NewJobDraft {
  readonly goal: string;
  readonly mode: JobMode;
  readonly orchestratorPick: AgentChoice | null;
  readonly workersPick: readonly AgentId[] | null;
  readonly commandChecks: readonly string[];
  readonly onLimit: LimitPolicy;
}

export const EMPTY_DRAFT: NewJobDraft = {
  goal: '',
  mode: 'single',
  orchestratorPick: null,
  workersPick: null,
  commandChecks: [],
  onLimit: DEFAULT_LIMIT_POLICY,
};

export interface NewJobDefaults {
  readonly orchestrator: AgentChoice | null;
  readonly workers: readonly AgentId[];
}

/** The values the form shows and the spec is built from: picks where made, defaults elsewhere. */
export function effectiveValues(draft: NewJobDraft, defaults: NewJobDefaults): JobFormValues {
  return {
    goal: draft.goal,
    mode: draft.mode,
    orchestrator: draft.orchestratorPick ?? defaults.orchestrator,
    workers: draft.workersPick ?? defaults.workers,
    commandChecks: draft.commandChecks,
    onLimit: draft.onLimit,
  };
}

export interface NewJobDraftState extends NewJobDraft {
  setGoal(goal: string): void;
  selectMode(mode: JobMode): void;
  pickOrchestrator(choice: AgentChoice): void;
  setWorkers(workers: readonly AgentId[]): void;
  addCommandCheck(run: string): void;
  removeCommandCheck(run: string): void;
  setOnLimit(policy: LimitPolicy): void;
  reset(): void;
}

export const useNewJobDraft = create<NewJobDraftState>()((set) => ({
  ...EMPTY_DRAFT,
  setGoal: (goal) => set({ goal }),
  // Modes that are not built yet cannot be selected.
  selectMode: (mode) => set((s) => (isModeEnabled(mode) ? { mode } : { mode: s.mode })),
  pickOrchestrator: (choice) => set({ orchestratorPick: choice }),
  setWorkers: (workers) => set({ workersPick: [...workers] }),
  addCommandCheck: (run) =>
    set((s) => (s.commandChecks.includes(run) ? {} : { commandChecks: [...s.commandChecks, run] })),
  removeCommandCheck: (run) => set((s) => ({ commandChecks: s.commandChecks.filter((c) => c !== run) })),
  setOnLimit: (onLimit) => set({ onLimit }),
  reset: () => set({ ...EMPTY_DRAFT }),
}));
