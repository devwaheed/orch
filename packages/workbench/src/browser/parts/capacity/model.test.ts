import { describe, expect, it } from 'vitest';
import type { Account, AccountId, AgentId, AgentInfo, MultiAccountSupport, Os, QuotaWindow, SpendToday } from '@orch/contracts';
import { buildCapacityModel, formatAge, formatSpendUsd } from './model.js';

const NOW = new Date('2026-10-11T12:00:00.000Z');

/** Mirror of the model's timeOnly: local wall-clock HH:MM. */
function localTime(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

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

  it('shows "Limited · HH:MM · back at HH:MM" for limited accounts', () => {
    const snap = baseSnapshot({
      accounts: [makeAccount('codex-personal')],
      limits: { 'codex-personal': { resetsAt: '2026-10-11T15:00:00Z' } },
    });
    const model = buildCapacityModel(snap);
    const acct = model.agents[0]!.accounts[0]!;
    expect(acct.stateLabel).toBe(`Limited · ${localTime('2026-10-11T15:00:00Z')}`);
    expect(acct.resetText).toBe(`back at ${localTime('2026-10-11T15:00:00Z')}`);
    expect(acct.railBorder).toBe('var(--warn-line)');
    expect(acct.pillColor).toBe('var(--warn)');
  });

  it('shows "Limited" without a time when the reset time is unknown', () => {
    const snap = baseSnapshot({
      accounts: [makeAccount('codex-personal', { state: 'limited' })],
    });
    const model = buildCapacityModel(snap);
    const acct = model.agents[0]!.accounts[0]!;
    expect(acct.stateLabel).toBe('Limited');
    expect(acct.resetText).toBe('');
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
    expect(acct.sourceText).toBe('Estimated locally');
    expect(acct.seenText).toBe('—');
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

  it('shows usage unknown for signed-in account with no windows (QTA-02)', () => {
    const snap = baseSnapshot({
      accounts: [makeAccount('claude-personal')],
    });
    const model = buildCapacityModel(snap);
    const acct = model.agents[0]!.accounts[0]!;
    expect(acct.hasWindows).toBe(false);
    expect(acct.topPct).toBeNull();
    expect(acct.bindingText).toBe('usage unknown');
    expect(acct.sourceText).toBe('—');
    expect(acct.seenText).toBe('—');
  });

  it('binding text shows "Not signed in" for signed_out accounts', () => {
    const snap = baseSnapshot({
      accounts: [makeAccount('claude-boss', { state: 'signed_out' })],
    });
    const model = buildCapacityModel(snap);
    const acct = model.agents[0]!.accounts[0]!;
    expect(acct.stateKind).toBe('signed_out');
    expect(acct.bindingText).toBe('Not signed in');
    expect(acct.pillColor).toBe('var(--err)');
  });

  it('binds to the window with the highest usage, not the first listed', () => {
    const snap = baseSnapshot({
      accounts: [makeAccount('claude-personal')],
      windows: [
        makeWindow('claude-personal', { window: '5h', usedPct: 40, resetsAt: '2026-10-11T16:00:00Z' }),
        makeWindow('claude-personal', { window: 'weekly', usedPct: 90, resetsAt: '2026-10-12T00:00:00Z' }),
      ],
    });
    const model = buildCapacityModel(snap);
    const acct = model.agents[0]!.accounts[0]!;
    expect(acct.topPct).toBe(90);
    expect(acct.bindingText).toBe('Weekly 90%');
    expect(acct.resetText).toBe(`resets ${localTime('2026-10-12T00:00:00Z')}`);
  });

  it('window rows show bare reset times and reported freshness', () => {
    const snap = baseSnapshot({
      accounts: [makeAccount('claude-personal')],
      windows: [makeWindow('claude-personal', { usedPct: 62, resetsAt: '2026-10-11T17:30:00Z' })],
    });
    const model = buildCapacityModel(snap);
    const acct = model.agents[0]!.accounts[0]!;
    expect(acct.windows[0]!.resetText).toBe(localTime('2026-10-11T17:30:00Z'));
    expect(acct.sourceText).toBe('Reported by CLI');
    expect(acct.seenText).toBe(formatAge('2026-10-11T11:30:00Z', NOW));
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
