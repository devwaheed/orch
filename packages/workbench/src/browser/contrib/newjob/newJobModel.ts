/**
 * Pure view-model for New job: builds the JobSpec from form state, applies the
 * always-on guardrails (JOB-05, JOB-06), picks defaults (JOB-08, JOB-09), decides
 * which modes are enabled, and tracks the live CLI line request.
 * No React and no services here, so every rule is testable on its own.
 */
import {
  AgentId,
  Check,
  JobSpec,
  LimitPolicy,
  type Account,
  type AccountState,
  type AgentChoice,
  type JobMode,
  type PickAccountResult,
} from '@orchagents/contracts';
import { newJobStrings } from './strings.js';

/** Agent order as shown in the pickers (matches the prototype). */
export const AGENT_ORDER: readonly AgentId[] = ['claude', 'codex', 'agy', 'gemini', 'opencode'];

/** All four job modes are enabled (S4-01, JOB-08). */
export const ENABLED_MODES: readonly JobMode[] = ['single', 'compare', 'council', 'autoloop'];

/** JOB-09: Council rounds options 3, 5, 8 with default 5. */
export const COUNCIL_ROUNDS_OPTIONS = [3, 5, 8] as const;
export const DEFAULT_COUNCIL_ROUNDS = 5;

/** JOB-09: Autoloop roles. */
export const AUTOLOOP_ROLES = [
  { role: 'planner' as const, label: 'Planner', desc: 'agrees the plan with you', aria: 'Planner agent' },
  { role: 'coder' as const, label: 'Coder', desc: 'writes the changes', aria: 'Coder agent' },
  { role: 'reviewer' as const, label: 'Reviewer', desc: 'checks each step', aria: 'Reviewer agent' },
] as const;

/** JOB-08: default onLimit. */
export const DEFAULT_LIMIT_POLICY: LimitPolicy = 'switch-account';

/** JOB-05 and JOB-06: always on, cannot be removed by the user or an agent. */
export const GUARDRAIL_CHECKS: readonly Check[] = [
  { kind: 'guardrail', rule: 'no_new_suppressions' },
  { kind: 'guardrail', rule: 'protected_files' },
];

/** Presets from the design's "Add:" row that map to a complete check without extra values. */
export const PRESET_COMMAND_CHECKS: readonly string[] = ['npm run build'];

export interface JobFormValues {
  readonly goal: string;
  readonly mode: JobMode;
  readonly orchestrator: AgentChoice | null;
  readonly workers: readonly AgentId[];
  /** Command runs the user added, in the order added. */
  readonly commandChecks: readonly string[];
  readonly onLimit: LimitPolicy;
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

export function isModeEnabled(mode: JobMode): boolean {
  return ENABLED_MODES.includes(mode);
}

/** The guardrails are always present, exactly once, first. User checks follow them. */
export function withGuardrails(checks: readonly Check[]): Check[] {
  const userChecks = checks.filter((check) => check.kind !== 'guardrail');
  return [...GUARDRAIL_CHECKS, ...userChecks];
}

/**
 * Builds the JobSpec for a single-mode job from the form.
 * Returns null while the form cannot produce a valid spec (no goal, no repo,
 * no orchestrator, no worker), so the CLI line and Start stay off.
 */
export function buildSingleJobSpec(values: JobFormValues, repoPath: string): JobSpec | null {
  if (values.mode !== 'single') return null;
  if (repoPath.length === 0 || values.orchestrator === null) return null;
  const candidate = {
    mode: 'single' as const,
    goal: values.goal.trim(),
    repoPath,
    checks: withGuardrails(values.commandChecks.map((run): Check => ({ kind: 'command', run }))),
    onLimit: values.onLimit,
    orchestrator: values.orchestrator,
    workers: [...values.workers],
  };
  const parsed = JobSpec.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * Builds a JobSpec for any mode from the form values.
 * Returns null if the form is invalid or incomplete.
 */
export function buildJobSpec(values: JobFormValues, repoPath: string): JobSpec | null {
  if (repoPath.length === 0 || values.goal.trim().length === 0) return null;

  if (values.mode === 'single') {
    return buildSingleJobSpec(values, repoPath);
  }

  if (values.mode === 'compare') {
    if (values.compareAgents.length < 2 || values.compareAgents.length > 5) return null;
    const candidate = {
      mode: 'compare' as const,
      goal: values.goal.trim(),
      repoPath,
      checks: withGuardrails(values.commandChecks.map((run): Check => ({ kind: 'command', run }))),
      onLimit: values.onLimit,
      agents: [...values.compareAgents],
      combine: values.combine,
    };
    const parsed = JobSpec.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }

  if (values.mode === 'council') {
    if (values.councilAgents.length < 2 || values.councilAgents.length > 5) return null;
    if (!COUNCIL_ROUNDS_OPTIONS.includes(values.councilRounds as 3 | 5 | 8)) return null;
    const candidate = {
      mode: 'council' as const,
      goal: values.goal.trim(),
      repoPath,
      checks: withGuardrails(values.commandChecks.map((run): Check => ({ kind: 'command', run }))),
      onLimit: values.onLimit,
      agents: [...values.councilAgents],
      maxRounds: values.councilRounds,
    };
    const parsed = JobSpec.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }

  if (values.mode === 'autoloop') {
    if (!values.roles.planner || !values.roles.coder || !values.roles.reviewer) return null;
    const candidate = {
      mode: 'autoloop' as const,
      goal: values.goal.trim(),
      repoPath,
      checks: withGuardrails(values.commandChecks.map((run): Check => ({ kind: 'command', run }))),
      onLimit: values.onLimit,
      roles: {
        planner: values.roles.planner,
        coder: values.roles.coder,
        reviewer: values.roles.reviewer,
      },
    };
    const parsed = JobSpec.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }

  return null;
}

/** JOB-09: the orchestrator default is the first usable account in account order, on Auto. */
export function defaultOrchestrator(accounts: readonly Account[]): AgentChoice | null {
  const first = accounts.find(isUsable);
  return first ? { agent: first.agent, account: 'auto' } : null;
}

/** Default workers: every agent that has at least one usable account, in picker order. */
export function defaultWorkers(accounts: readonly Account[]): AgentId[] {
  return AGENT_ORDER.filter((agent) => accounts.some((a) => a.agent === agent && isUsable(a)));
}

/** JOB-09: Default 2–5 agents for Compare mode (first usable accounts, minimum 2). */
export function defaultCompareAgents(accounts: readonly Account[]): AgentId[] {
  const usable = defaultWorkers(accounts);
  if (usable.length >= 2) return usable.slice(0, 5);
  // Fall back to first two in AGENT_ORDER
  return ['claude', 'codex'];
}

/** JOB-08, JOB-09: combine defaults on. */
export function defaultCombine(): boolean {
  return true;
}

/** JOB-09: Council members default 2–5 (first usable accounts, default 3). */
export function defaultCouncilAgents(accounts: readonly Account[]): AgentId[] {
  const usable = defaultWorkers(accounts);
  if (usable.length >= 2) return usable.slice(0, 5);
  return ['claude', 'codex', 'opencode'];
}

/** JOB-09: Council rounds default 5. */
export function defaultCouncilRounds(): number {
  return DEFAULT_COUNCIL_ROUNDS;
}

/** JOB-09: Autoloop roles default Planner, Coder, Reviewer. */
export function defaultRoles(accounts: readonly Account[]): { planner: AgentId; coder: AgentId; reviewer: AgentId } {
  const usable = defaultWorkers(accounts);
  const p = usable[0] ?? 'claude';
  const c = usable[1] ?? usable[0] ?? 'codex';
  const r = usable[2] ?? usable[0] ?? 'gemini';
  return { planner: p, coder: c, reviewer: r };
}

/** An account can take work when it is signed in, not limited and not switched off. */
export function isUsable(account: Pick<Account, 'state' | 'use'>): boolean {
  return account.state !== 'signed_out' && account.state !== 'limited' && account.use;
}

export type AccountTone = 'ok' | 'warn' | 'err' | 'neutral';

export function accountTone(state: AccountState): AccountTone {
  switch (state) {
    case 'available':
      return 'ok';
    case 'near_limit':
    case 'limited':
      return 'warn';
    case 'signed_out':
      return 'err';
    case 'estimated':
      return 'neutral';
  }
}

/** Local 24-hour HH:mm for a reset time, or null when the time is unknown. */
export function formatResetTime(resetsAt: string | null | undefined): string | null {
  if (!resetsAt) return null;
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return null;
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Sub-line under an account option: plan, then its state (or "limited until"). */
export function accountOptionSub(account: Account, resetsAt: string | null | undefined): string {
  const plan = account.plan ?? '';
  let state: string;
  if (account.state === 'limited') {
    const back = formatResetTime(resetsAt);
    state = back ? newJobStrings.orchestrator.pinnedLimited(back) : newJobStrings.accountState.limited.toLowerCase();
  } else {
    state = newJobStrings.accountState[account.state].toLowerCase();
  }
  return plan ? `${plan} · ${state}` : state;
}

/** Sub-line under Auto, from the core's routing decision (ACC-06). */
export function autoOptionSub(pick: PickAccountResult | undefined, accountName: (accountId: string) => string | null): string {
  if (!pick) return '';
  if (pick.kind === 'account') {
    const name = accountName(pick.accountId);
    return name ? newJobStrings.orchestrator.autoUses(name) : '';
  }
  return newJobStrings.orchestrator.noRoom;
}

export interface PinnedStatus {
  readonly account: Account;
  readonly limited: boolean;
  readonly near: boolean;
  readonly resetsAt: string | null;
}

/** The status of the orchestrator's pinned account, or null when Auto is picked. */
export function pinnedStatus(
  choice: AgentChoice | null,
  accounts: readonly Account[],
  limits: Readonly<Record<string, { resetsAt: string | null }>>,
): PinnedStatus | null {
  if (!choice || choice.account === 'auto') return null;
  const accountId = choice.account;
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return null;
  return {
    account,
    limited: account.state === 'limited',
    near: account.state === 'near_limit',
    resetsAt: limits[accountId]?.resetsAt ?? null,
  };
}

/** The warning under the orchestrator picker, or null. */
export function orchestratorWarning(
  status: PinnedStatus | null,
  agentName: string,
  autoFallbackName: string | null,
): string | null {
  if (!status) return null;
  const fallback = autoFallbackName ?? newJobStrings.orchestrator.fallbackAccount;
  if (status.limited) {
    const back = formatResetTime(status.resetsAt);
    return back
      ? newJobStrings.orchestrator.warningLimited(agentName, status.account.name, back, fallback)
      : newJobStrings.orchestrator.warningLimitedNoTime(agentName, status.account.name, fallback);
  }
  if (status.near) return newJobStrings.orchestrator.warningNear(agentName, status.account.name);
  return null;
}

/**
 * Mode change swaps the start button label:
 * Start job (or Schedule for <time>) · Ask N agents · Start council · Start with the Planner
 * (screens.md "Start a job", Main.dc.html line 2513).
 */
export function startButtonLabel(
  modeOrStatus: JobMode | PinnedStatus | null,
  statusOrCompareCount?: PinnedStatus | null | number,
  compareAgentCount?: number,
): string {
  if (modeOrStatus === null || typeof modeOrStatus === 'object') {
    const status = modeOrStatus as PinnedStatus | null;
    if (status?.limited) {
      const back = formatResetTime(status.resetsAt);
      if (back) return newJobStrings.footer.schedule(back);
    }
    return newJobStrings.footer.start;
  }

  const mode = modeOrStatus;
  const status = typeof statusOrCompareCount === 'object' ? statusOrCompareCount : null;
  const count = typeof statusOrCompareCount === 'number' ? statusOrCompareCount : (compareAgentCount ?? 0);

  if (mode === 'single') {
    if (status?.limited) {
      const back = formatResetTime(status.resetsAt);
      if (back) return newJobStrings.footer.schedule(back);
    }
    return newJobStrings.footer.start;
  }

  if (mode === 'compare') {
    return newJobStrings.footer.askAgents(count);
  }

  if (mode === 'council') {
    return newJobStrings.footer.startCouncil;
  }

  if (mode === 'autoloop') {
    return newJobStrings.footer.startPlanner;
  }

  return newJobStrings.footer.start;
}

export interface LatestGate {
  next(): number;
  isLatest(ticket: number): boolean;
}

/** Latest-wins sequencing: a reply is applied only if no newer request started after it. */
export function createLatestGate(): LatestGate {
  let latest = 0;
  return {
    next() {
      latest += 1;
      return latest;
    },
    isLatest(ticket: number) {
      return ticket === latest;
    },
  };
}

export type CliLineState =
  | { readonly status: 'idle'; readonly command: null; readonly message: null }
  | { readonly status: 'loading'; readonly command: null; readonly message: null }
  | { readonly status: 'ready'; readonly command: string; readonly message: null }
  | { readonly status: 'failed'; readonly command: null; readonly message: string };

export const cliIdle: CliLineState = { status: 'idle', command: null, message: null };
export const cliLoading: CliLineState = { status: 'loading', command: null, message: null };

export function cliReady(command: string): CliLineState {
  return { status: 'ready', command, message: null };
}

export function cliFailed(message: string): CliLineState {
  return { status: 'failed', command: null, message };
}
