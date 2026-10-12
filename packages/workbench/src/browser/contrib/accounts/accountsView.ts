/**
 * View model for the Accounts screen: per-agent sections, account rows, routing
 * and shared skills. Pure functions over contract objects; the screen only renders them.
 */
import type {
  Account,
  AccountId,
  AccountsFile,
  AgentId,
  AgentInfo,
  MultiAccountSupport,
  Os,
  QuotaWindow,
  RoutingRule,
} from '@orchagents/contracts';
import { accountsStrings as S, OS_NAME } from './strings.js';
import { formatResetTime, maskEmail } from './format.js';

export type PillTone = 'ok' | 'warn' | 'limited' | 'neutral' | 'err';

/** Per-account limit info, keyed by account id (quota store `limits`). */
export type LimitMap = Readonly<Record<string, { readonly resetsAt: string | null }>>;
export type WindowMap = Readonly<Record<string, QuotaWindow>>;

export interface AccountRowVM {
  readonly id: AccountId;
  readonly label: string;
  readonly isPrimary: boolean;
  readonly emailDisplay: string | null;
  readonly plan: string | null;
  readonly profileDir: string;
  readonly logins: readonly { readonly name: string; readonly kind: string }[];
  readonly roleText: string;
  readonly stateLabel: string;
  readonly tone: PillTone;
  readonly signedOut: boolean;
  readonly limited: boolean;
  readonly usageText: string;
  readonly use: boolean;
  readonly canMakePrimary: boolean;
  readonly loginLabel: string;
  readonly dimmed: boolean;
}

export type AddAvailability =
  | { readonly enabled: true; readonly title: string }
  | { readonly enabled: false; readonly title: string };

export interface AgentSectionVM {
  readonly id: AgentId;
  readonly name: string;
  readonly command: string;
  readonly summary: string;
  readonly support: MultiAccountSupport;
  readonly supportText: string;
  readonly supportTitle: string;
  readonly via: string;
  readonly supportNote: string | null;
  readonly isOpenCode: boolean;
  readonly add: AddAvailability;
  readonly skillsShared: boolean;
  readonly skillsText: string;
  readonly skillsDir: string | null;
  readonly accounts: readonly AccountRowVM[];
}

export const AGENT_ORDER: readonly AgentId[] = ['claude', 'codex', 'gemini', 'opencode', 'agy'];

/** An account is routed to (ACC-06): signed in, not limited, and switched on. */
export function isUsable(account: Account, limits: LimitMap): boolean {
  return account.state !== 'signed_out' && account.state !== 'limited' && !limits[account.id] && account.use;
}

/**
 * Whether "Add account" is enabled for an agent on this machine (ACC-03).
 * parallel: always. single: only while the agent has no account yet.
 * unverified: only after `orch doctor` has verified it (the agent's support then reads parallel).
 */
export function addAvailability(agent: AgentInfo, accountCount: number, os: Os): AddAvailability {
  const osName = OS_NAME[os];
  if (agent.support === 'parallel') {
    return { enabled: true, title: S.agent.addAnother(agent.displayName) };
  }
  if (agent.support === 'single') {
    if (accountCount === 0) {
      return { enabled: true, title: S.agent.addAnother(agent.displayName) };
    }
    return { enabled: false, title: S.agent.addSingleLimit(agent.displayName, osName) };
  }
  return { enabled: false, title: S.agent.addRunCheck };
}

export function supportText(support: MultiAccountSupport, os: Os): string {
  const osName = OS_NAME[os];
  if (support === 'parallel') return S.agent.supportParallel;
  if (support === 'single') return S.agent.supportSingle(osName);
  return S.agent.supportUnverified(osName);
}

/** Shared skills are on unless the file says otherwise (ACC-09). */
export function shareSkillsFor(file: AccountsFile | null | undefined, agent: AgentId): boolean {
  if (!file) return true;
  const value = file.share_skills;
  if (typeof value === 'boolean') return value;
  return value[agent] ?? true;
}

export function routingValue(file: AccountsFile | null | undefined): RoutingRule {
  return file?.routing ?? 'primary-first';
}

/** The window with the highest usage, used for the row's usage button. */
function topWindow(windows: readonly QuotaWindow[]): QuotaWindow | null {
  let best: QuotaWindow | null = null;
  for (const w of windows) {
    if (!best || w.usedPct > best.usedPct) best = w;
  }
  return best;
}

export function usageText(account: Account, windows: readonly QuotaWindow[], limits: LimitMap): string {
  const limit = limits[account.id];
  if (account.state === 'limited' || limit) {
    const time = formatResetTime(limit?.resetsAt ?? windows.find((window) => window.accountId === account.id)?.resetsAt);
    return time ? S.account.usageLimitedUntil(time) : S.account.stateLimited;
  }
  const top = topWindow(windows.filter((w) => w.accountId === account.id));
  if (!top) return S.account.usageUnknown;
  const pct = `${top.source === 'estimated' ? '~' : ''}${Math.round(top.usedPct)}%`;
  const label = S.account.windowLabel[top.window] ?? top.window;
  return S.account.usageOf(pct, label);
}

function stateLabelAndTone(account: Account, windows: readonly QuotaWindow[], limits: LimitMap): { label: string; tone: PillTone } {
  if (account.state === 'signed_out') return { label: S.account.stateSignedOut, tone: 'err' };
  if (account.state === 'limited' || limits[account.id]) {
    const time = formatResetTime(limits[account.id]?.resetsAt ?? windows.find((window) => window.accountId === account.id)?.resetsAt);
    return { label: time ? S.account.stateLimitedUntil(time) : S.account.stateLimited, tone: 'limited' };
  }
  if (account.state === 'near_limit') return { label: S.account.stateNearLimit, tone: 'warn' };
  if (account.state === 'estimated') return { label: S.account.stateEstimated, tone: 'neutral' };
  return { label: S.account.stateAvailable, tone: 'ok' };
}

function roleText(account: Account): string {
  if (account.state === 'signed_out') return S.account.roleUnavailable;
  if (!account.use) return S.account.roleOff;
  return account.primary ? S.account.rolePrimary : S.account.roleBackup;
}

export function accountRow(account: Account, windows: readonly QuotaWindow[], limits: LimitMap): AccountRowVM {
  const state = stateLabelAndTone(account, windows, limits);
  const signedOut = account.state === 'signed_out';
  return {
    id: account.id,
    label: account.name,
    isPrimary: account.primary,
    emailDisplay: maskEmail(account.emailMasked) ?? null,
    plan: account.type ?? account.plan ?? null,
    profileDir: account.profileDir,
    logins: (account.providers ?? []).map((p) => ({
      name: p.provider,
      kind: S.account.loginKind[p.kind],
    })),
    roleText: roleText(account),
    stateLabel: state.label,
    tone: state.tone,
    signedOut,
    limited: state.tone === 'limited',
    usageText: usageText(account, windows, limits),
    use: account.use,
    canMakePrimary: !account.primary && !signedOut,
    loginLabel: signedOut ? S.account.signIn : S.account.reLogin,
    dimmed: !account.use && !signedOut,
  };
}

export interface AgentViewInput {
  readonly agents: readonly AgentInfo[];
  readonly accounts: readonly Account[];
  readonly windows: WindowMap;
  readonly limits: LimitMap;
  readonly file: AccountsFile | null;
  readonly os: Os;
}

/** One section per agent, in the order the core lists them. */
export function buildAgentSections(input: AgentViewInput): AgentSectionVM[] {
  const windows = Object.values(input.windows);
  return input.agents.map((agent) => {
    const accounts = input.accounts.filter((a) => a.agent === agent.id);
    const usable = accounts.filter((a) => isUsable(a, input.limits)).length;
    const skillsShared = shareSkillsFor(input.file, agent.id);
    const note = S.supportNotes[agent.id]?.[input.os] ?? null;
    return {
      id: agent.id,
      name: agent.displayName,
      command: agent.command,
      summary: S.agent.accountsSummary(accounts.length, usable),
      support: agent.support,
      supportText: supportText(agent.support, input.os),
      supportTitle: S.supportHow[agent.id],
      via: S.agent.via(agent.accountSetting),
      supportNote: note,
      isOpenCode: agent.id === 'opencode',
      add: addAvailability(agent, accounts.length, input.os),
      skillsShared,
      skillsText: skillsShared
        ? S.agent.skillsShared(
            agent.sharedSkillsCount,
            agent.displayName,
            agent.sharedSkillNames?.includes('saas-factory') === true,
          )
        : S.agent.skillsNotShared,
      skillsDir: agent.sharedSkillsDir,
      accounts: accounts.map((a) => accountRow(a, windows.filter((w) => w.accountId === a.id), input.limits)),
    };
  });
}

export function accountById(accounts: readonly Account[], id: AccountId): Account | undefined {
  return accounts.find((a) => a.id === id);
}

/** Keep a newly created profile out of the Accounts screen until the dialog is completed. */
export function accountsForBackground(accounts: readonly Account[], draftAccountId: AccountId | null): readonly Account[] {
  return draftAccountId ? accounts.filter((account) => account.id !== draftAccountId) : accounts;
}
