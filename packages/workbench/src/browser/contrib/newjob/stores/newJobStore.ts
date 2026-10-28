/**
 * New job draft: only what the user has picked. Defaults (JOB-08, JOB-09) are
 * not stored, so they keep following the accounts as they load or change.
 * A null pick means "use the default".
 */
import { create } from 'zustand';
import type { AgentChoice, AgentId, JobMode, LimitPolicy } from '@orchagents/contracts';
import {
  DEFAULT_LIMIT_POLICY,
  isModeEnabled,
  type JobFormValues,
} from '../newJobModel.js';

export interface AuditLineDraft {
  readonly id: string;
  readonly text: string;
}

export interface NewJobDraft {
  readonly title: string;
  readonly goal: string;
  readonly mode: JobMode;
  readonly orchestratorPick: AgentChoice | null;
  readonly workersPick: readonly AgentId[] | null;
  readonly commandChecks: readonly string[];
  readonly appAddress: string;
  readonly auditLines: readonly AuditLineDraft[];
  readonly dependsOn: readonly string[];
  readonly runNext: boolean;
  readonly onLimit: LimitPolicy;
  readonly compareAgentsPick: readonly AgentId[] | null;
  readonly combinePick: boolean | null;
  readonly councilAgentsPick: readonly AgentId[] | null;
  readonly councilRoundsPick: number | null;
  readonly rolesPick: Partial<Record<'planner' | 'coder' | 'reviewer', AgentId>> | null;
}

export const EMPTY_DRAFT: NewJobDraft = {
  title: '',
  goal: '',
  mode: 'single',
  orchestratorPick: null,
  workersPick: null,
  commandChecks: [],
  appAddress: '',
  auditLines: [],
  dependsOn: [],
  runNext: false,
  onLimit: DEFAULT_LIMIT_POLICY,
  compareAgentsPick: null,
  combinePick: null,
  councilAgentsPick: null,
  councilRoundsPick: null,
  rolesPick: null,
};

export interface NewJobDefaults {
  readonly orchestrator: AgentChoice | null;
  readonly workers: readonly AgentId[];
  readonly compareAgents: readonly AgentId[];
  readonly combine: boolean;
  readonly councilAgents: readonly AgentId[];
  readonly councilRounds: number;
  readonly roles: {
    readonly planner: AgentId;
    readonly coder: AgentId;
    readonly reviewer: AgentId;
  };
}

let nextAuditId = 1;
function newAuditId(): string {
  return `audit-${Date.now()}-${nextAuditId++}`;
}

/** The values the form shows and the spec is built from: picks where made, defaults elsewhere. */
export function effectiveValues(draft: NewJobDraft, defaults: NewJobDefaults): JobFormValues {
  return {
    title: draft.title,
    goal: draft.goal,
    mode: draft.mode,
    orchestrator: draft.orchestratorPick ?? defaults.orchestrator,
    workers: draft.workersPick ?? defaults.workers,
    commandChecks: draft.commandChecks,
    appAddress: draft.appAddress,
    auditLines: draft.auditLines,
    dependsOn: draft.dependsOn,
    runNext: draft.runNext,
    onLimit: draft.onLimit,
    compareAgents: draft.compareAgentsPick ?? defaults.compareAgents,
    combine: draft.combinePick ?? defaults.combine,
    councilAgents: draft.councilAgentsPick ?? defaults.councilAgents,
    councilRounds: draft.councilRoundsPick ?? defaults.councilRounds,
    roles: {
      planner: draft.rolesPick?.planner ?? defaults.roles.planner,
      coder: draft.rolesPick?.coder ?? defaults.roles.coder,
      reviewer: draft.rolesPick?.reviewer ?? defaults.roles.reviewer,
    },
  };
}

export interface NewJobDraftState extends NewJobDraft {
  setTitle(title: string): void;
  setGoal(goal: string): void;
  selectMode(mode: JobMode): void;
  pickOrchestrator(choice: AgentChoice): void;
  setWorkers(workers: readonly AgentId[]): void;
  addCommandCheck(run: string): void;
  removeCommandCheck(run: string): void;
  setAppAddress(address: string): void;
  addAuditLine(text?: string): string;
  updateAuditLine(id: string, text: string): void;
  removeAuditLine(id: string): void;
  toggleDependsOn(id: string): void;
  setRunNext(runNext: boolean): void;
  setOnLimit(policy: LimitPolicy): void;
  setCompareAgents(agents: readonly AgentId[]): void;
  toggleCompareAgent(agent: AgentId, defaultAgents?: readonly AgentId[]): void;
  setCombine(combine: boolean): void;
  setCouncilAgents(agents: readonly AgentId[]): void;
  toggleCouncilMember(agent: AgentId, defaultAgents?: readonly AgentId[]): void;
  setCouncilRounds(rounds: number): void;
  setRole(role: 'planner' | 'coder' | 'reviewer', agent: AgentId): void;
  reset(): void;
}

export const useNewJobDraft = create<NewJobDraftState>()((set) => ({
  ...EMPTY_DRAFT,
  setTitle: (title) => set({ title }),
  setGoal: (goal) => set({ goal }),
  selectMode: (mode) => set((s) => (isModeEnabled(mode) ? { mode } : { mode: s.mode })),
  pickOrchestrator: (choice) => set({ orchestratorPick: choice }),
  setWorkers(workers) {
    set({ workersPick: [...workers] });
  },
  addCommandCheck: (run) =>
    set((s) => (s.commandChecks.includes(run) ? {} : { commandChecks: [...s.commandChecks, run] })),
  removeCommandCheck: (run) => set((s) => ({ commandChecks: s.commandChecks.filter((c) => c !== run) })),
  setAppAddress: (appAddress) => set({ appAddress }),
  addAuditLine: (text) => {
    const id = newAuditId();
    set((s) => ({
      auditLines: [
        ...s.auditLines,
        {
          id,
          text: text !== undefined ? text : s.auditLines.length === 0 ? 'The goal is met' : '',
        },
      ],
    }));
    return id;
  },
  updateAuditLine: (id, text) =>
    set((s) => ({
      auditLines: s.auditLines.map((line) => (line.id === id ? { ...line, text } : line)),
    })),
  removeAuditLine: (id) =>
    set((s) => ({
      auditLines: s.auditLines.filter((line) => line.id !== id),
    })),
  toggleDependsOn: (id) =>
    set((s) => ({
      dependsOn: s.dependsOn.includes(id)
        ? s.dependsOn.filter((specId) => specId !== id)
        : [...s.dependsOn, id],
    })),
  setRunNext: (runNext) => set({ runNext }),
  setOnLimit: (onLimit) => set({ onLimit }),
  setCompareAgents: (agents) => set({ compareAgentsPick: [...agents] }),
  toggleCompareAgent: (agent, defaultAgents) =>
    set((s) => {
      const current = s.compareAgentsPick ?? defaultAgents ?? ['claude', 'codex'];
      const next = current.includes(agent)
        ? current.filter((a) => a !== agent)
        : [...current, agent];
      return { compareAgentsPick: next };
    }),
  setCombine: (combine) => set({ combinePick: combine }),
  setCouncilAgents: (agents) => set({ councilAgentsPick: [...agents] }),
  toggleCouncilMember: (agent, defaultAgents) =>
    set((s) => {
      const current = s.councilAgentsPick ?? defaultAgents ?? ['claude', 'codex', 'opencode'];
      const next = current.includes(agent)
        ? current.filter((a) => a !== agent)
        : [...current, agent];
      return { councilAgentsPick: next };
    }),
  setCouncilRounds: (rounds) => set({ councilRoundsPick: rounds }),
  setRole: (role, agent) =>
    set((s) => ({
      rolesPick: {
        ...(s.rolesPick ?? {}),
        [role]: agent,
      },
    })),
  reset: () => set({ ...EMPTY_DRAFT }),
}));

/** Fills the New spec title and goal from another area (Specs → Run next step) and leaves the picks alone. */
export function prefillNewSpec(title: string, body: string): void {
  useNewJobDraft.setState({ title, goal: body });
}

/** Fills the New job goal from another area (Specs → Run next step) and leaves the picks alone. */
export function prefillNewJob(goal: string): void {
  useNewJobDraft.setState({ goal });
}
