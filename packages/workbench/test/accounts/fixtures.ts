import type { Account, AccountId, AgentId, AgentInfo, MultiAccountSupport, Os, QuotaWindow } from '@orch/contracts';

export function account(
  id: string,
  agent: AgentId,
  overrides: Partial<Omit<Account, 'id' | 'agent'>> = {},
): Account {
  return {
    id: id as AccountId,
    agent,
    name: overrides.name ?? 'Work',
    primary: overrides.primary ?? false,
    use: overrides.use ?? true,
    state: overrides.state ?? 'available',
    emailMasked: overrides.emailMasked ?? 'a•••@acme.dev',
    plan: overrides.plan ?? 'Pro',
    profileDir: overrides.profileDir ?? `/home/u/.orch/profiles/${id}`,
    skillsShared: overrides.skillsShared ?? true,
    providers: overrides.providers,
    lastIsolationCheck: overrides.lastIsolationCheck,
  };
}

export function agent(
  id: AgentId,
  support: MultiAccountSupport,
  overrides: Partial<AgentInfo> = {},
): AgentInfo {
  const allOs: Record<Os, MultiAccountSupport> = { macos: support, linux: support, windows: support };
  return {
    id,
    displayName: overrides.displayName ?? id,
    command: overrides.command ?? id,
    installed: true,
    support,
    supportByOs: overrides.supportByOs ?? allOs,
    accountSetting: overrides.accountSetting ?? 'CLAUDE_CONFIG_DIR',
    sharedSkillsDir: overrides.sharedSkillsDir ?? '~/.claude/skills',
    sharedSkillsCount: overrides.sharedSkillsCount ?? 12,
    ...overrides,
  };
}

export function quotaWindow(accountId: string, usedPct: number, overrides: Partial<QuotaWindow> = {}): QuotaWindow {
  return {
    accountId: accountId as AccountId,
    window: overrides.window ?? '5h',
    usedPct,
    resetsAt: overrides.resetsAt ?? null,
    source: overrides.source ?? 'reported',
    seenAt: overrides.seenAt ?? '2026-10-11T10:00:00.000Z',
  };
}
