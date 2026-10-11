import { describe, expect, it } from 'vitest';
import type { Account, AccountId, AgentId, AgentInfo, MultiAccountSupport, Os, QuotaWindow, SpendToday } from '@orch/contracts';
import { buildCapacityModel, formatAge, formatSpendUsd } from './model.js';

const NOW = new Date('2026-10-11T12:00:00.000Z');

function makeAccount(
  id: string,
  overrides: Partial<Account> = {},
): Account {
  return {
    id: id as AccountId,
    agent: id.split('-')[0] as AgentId,
    name: id.split('-')[1] ?? id,
    primary: false,
    use: true,
    state: 'available',
    profileDir: `~/profiles/${id}`,
    skillsShared: false,
    ...overrides,
  } as Account;
}

function makeWindow(
  accountId: string,
  overrides: Partial<QuotaWindow> = {},
): QuotaWindow {
  return {
    accountId: accountId as AccountId,
    window: '5h',
    usedPct: 50,
    resetsAt: '2026-10-11T17:30:00Z',
    source: 'reported',
    seenAt: '2026-10-11T11:30:00Z',
    ...overrides,
  };
}

const OS_MAP: Record<Os, MultiAccountSupport> = {
  macos: 'parallel',
  linux: 'parallel',
  windows: 'parallel',
};

const AGENTS: AgentInfo[] = [
  { id: 'claude' as AgentId, displayName: 'Claude Code', command: 'claude', installed: true, support: 'parallel', supportByOs: OS_MAP, accountSetting: 'CLAUDE_CONFIG_DIR', sharedSkillsDir: null, sharedSkillsCount: 0 },
  { id: 'codex' as AgentId, displayName: 'Codex', command: 'codex', installed: true, support: 'parallel', supportByOs: OS_MAP, accountSetting: 'CODEX_HOME', sharedSkillsDir: null, sharedSkillsCount: 0 },
];

function baseSnapshot(opts: {
  accounts?: Account[];
  windows?: QuotaWindow[];
  limits?: Record<string, { resetsAt: string | null }>;
  spendToday?: SpendToday | null;
  expandedAccount?: AccountId | null;
  runCounts?: Record<string, number>;
  holding?: Record<string, string>;
} = {}) {
  const windows = (opts.windows ?? []).reduce(
    (acc, w) => ({ ...acc, [`${w.accountId}:${w.window}`]: w }),
    {} as Record<string, QuotaWindow>,
  );
  return {
    accounts: opts.accounts ?? [],
    agents: AGENTS,
    windows,
    limits: opts.limits ?? {},
    spendToday: opts.spendToday ?? null,
    now: NOW,
    expandedAccount: opts.expandedAccount ?? null,
    runCounts: opts.runCounts ?? {},
    holding: opts.holding ?? {},
  };
}

describe('buildCapacityModel', () => {
  it('groups accounts by agent in insertion order', () => {
    const snap = baseSnapshot({
      accounts: [makeAccount('claude-personal'), makeAccount('codex-team'), makeAccount('claude-work')],
      windows: [makeWindow('claude-personal'), makeWindow('codex-team')],
    });
    const model = buildCapacityModel(snap);
    expect(model.agents.map((g) => g.agentId)).toEqual(['claude', 'codex']);
    expect(model.agents[0]!.accounts.map((a) => a.accountId)).toEqual(['claude-personal', 'claude-work']);
    expect(model.agents[1]!.accounts.map((a) => a.accountId)).toEqual(['codex-team']);
  });

  it('shows "Signed out" for signed_out accounts', () => {
    const snap = baseSnapshot({
      accounts: [makeAccount('claude-boss', { state: 'signed_out' })],
    });
    const model = buildCapacityModel(snap);
    expect(model.agents[0]!.accounts[0]!.stateLabel).toBe('Signed out');
    expect(model.agents[0]!.accounts[0]!.stateKind).toBe('signed_out');
  });

  it('shows "Limited · back at HH:MM" for limited accounts', () => {
    const snap = baseSnapshot({
      accounts: [makeAccount('codex-personal')],
      limits: { 'codex-personal': { resetsAt: '2026-10-11T15:00:00Z' } },
    });
    const model = buildCapacityModel(snap);
    const acct = model.agents[0]!.accounts[0]!;
    expect(acct.stateLabel).toBe('Limited');
    expect(acct.resetText).toBe('back at 15:00');
    expect(acct.railBorder).toBe('var(--warn-line)');
  });

  it('shows "Near limit" when usedPct >= 85', () => {
    const w = makeWindow('claude-personal', { usedPct: 91, resetsAt: '2026-10-11T16:10:00Z' });
    const snap = baseSnapshot({
      accounts: [makeAccount('claude-personal')],
      windows: [w],
    });
    const model = buildCapacityModel(snap);
    const acct = model.agents[0]!.accounts[0]!;
    expect(acct.stateLabel).toBe('Near limit');
  });

  it('shows estimated state when windows are stale (QTA-05)', () => {
    const w = makeWindow('claude-personal', {
      usedPct: 90,
      seenAt: '2026-10-11T05:00:00.000Z',
      resetsAt: '2026-10-11T17:00:00Z',
    });
    const snap = baseSnapshot({
      accounts: [makeAccount('claude-personal')],
      windows: [w],
    });
    const model = buildCapacityModel(snap);
    const acct = model.agents[0]!.accounts[0]!;
    expect(acct.stateKind).toBe('estimated');
    expect(acct.stateLabel).toBe('Available · est.');
  });

  it('shows "Available · est." for estimated windows', () => {
    const snap = baseSnapshot({
      accounts: [makeAccount('agy-main', { agent: 'agy' as AgentId })],
      windows: [makeWindow('agy-main', { usedPct: 30, source: 'estimated', window: 'daily' })],
    });
    const model = buildCapacityModel(snap);
    const acct = model.agents[0]!.accounts[0]!;
    expect(acct.stateKind).toBe('estimated');
    expect(acct.stateLabel).toBe('Available · est.');
    expect(acct.windows[0]!.estimated).toBe(true);
    expect(acct.windows[0]!.bar).toContain('repeating-linear-gradient');
  });

  it('shows "Available" for fresh windows under 85%', () => {
    const snap = baseSnapshot({
      accounts: [makeAccount('claude-personal')],
      windows: [makeWindow('claude-personal', { usedPct: 42 })],
    });
    const model = buildCapacityModel(snap);
    expect(model.agents[0]!.accounts[0]!.stateLabel).toBe('Available');
  });

  it('binding text includes "~" prefix for estimated windows (QTA-02)', () => {
    const snap = baseSnapshot({
      accounts: [makeAccount('agy-main', { agent: 'agy' as AgentId })],
      windows: [makeWindow('agy-main', { usedPct: 30, source: 'estimated', window: 'daily' })],
    });
    const model = buildCapacityModel(snap);
    expect(model.agents[0]!.accounts[0]!.bindingText).toBe('Daily ~30%');
  });

  it('formats spend as $X.XX', () => {
    expect(formatSpendUsd(4.12)).toBe('$4.12');
    expect(formatSpendUsd(0)).toBe('$0.00');
  });

  it('shows expandable/collapsible state', () => {
    const snap = baseSnapshot({
      accounts: [makeAccount('claude-personal')],
      windows: [makeWindow('claude-personal')],
      expandedAccount: 'claude-personal' as AccountId,
    });
    const model = buildCapacityModel(snap);
    const acct = model.agents[0]!.accounts[0]!;
    expect(acct.expanded).toBe(true);
    expect(acct.chevron).toBe('rotate(180deg)');
  });

  it('does not group estimated bars by repeating-linear-gradient when reported', () => {
    const snap = baseSnapshot({
      accounts: [makeAccount('claude-personal')],
      windows: [makeWindow('claude-personal', { usedPct: 42 })],
    });
    const model = buildCapacityModel(snap);
    expect(model.agents[0]!.accounts[0]!.windows[0]!.bar).toBe('var(--ok-dot)');
  });

  it('passes spendToday through to the model', () => {
    const snap = baseSnapshot({
      accounts: [],
      spendToday: { usd: 4.12, fromApiKeysOnly: false },
    });
    const model = buildCapacityModel(snap);
    expect(model.spendToday).toEqual({ usd: 4.12, fromApiKeysOnly: false });
  });

  it('shows usage unknown for signed-in account with no windows', () => {
    const snap = baseSnapshot({
      accounts: [makeAccount('claude-personal')],
    });
    const model = buildCapacityModel(snap);
    const acct = model.agents[0]!.accounts[0]!;
    expect(acct.hasWindows).toBe(false);
    expect(acct.topPct).toBeNull();
  });
});

describe('formatAge', () => {
  it('formats minutes ago', () => {
    expect(formatAge('2026-10-11T11:50:00Z', NOW)).toBe('10 min ago');
  });

  it('formats hours ago', () => {
    expect(formatAge('2026-10-11T05:00:00Z', NOW)).toBe('7 h ago');
  });

  it('formats just now', () => {
    expect(formatAge('2026-10-11T12:00:00Z', NOW)).toBe('just now');
  });
});
