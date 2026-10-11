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
} from '@orch/contracts';
import { newJobStrings } from './strings.js';

/** Agent order as shown in the pickers (matches the prototype). */
export const AGENT_ORDER: readonly AgentId[] = ['claude', 'codex', 'agy', 'gemini', 'opencode'];

/** Only single mode is built here; the other modes arrive with S4-01. */
const ENABLED_MODES: readonly JobMode[] = ['single'];

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

/** JOB-09: the orchestrator default is the first usable account in account order, on Auto. */
export function defaultOrchestrator(accounts: readonly Account[]): AgentChoice | null {
  const first = accounts.find(isUsable);
  return first ? { agent: first.agent, account: 'auto' } : null;
}

/** Default workers: every agent that has at least one usable account, in picker order. */
export function defaultWorkers(accounts: readonly Account[]): AgentId[] {
  return AGENT_ORDER.filter((agent) => accounts.some((a) => a.agent === agent && isUsable(a)));
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

/** Start reads "Schedule for <time>" when the pinned orchestrator account is limited with a known reset. */
export function startButtonLabel(status: PinnedStatus | null): string {
  if (status?.limited) {
    const back = formatResetTime(status.resetsAt);
    if (back) return newJobStrings.footer.schedule(back);
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
