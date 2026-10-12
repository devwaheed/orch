import { describe, expect, it } from 'vitest';
import type { AccountsFile } from '@orchagents/contracts';
import {
  addAvailability,
  accountsForBackground,
  buildAgentSections,
  isUsable,
  shareSkillsFor,
  supportText,
  usageText,
} from '../../src/browser/contrib/accounts/accountsView.js';
import { account, agent, quotaWindow } from './fixtures.js';

const noLimits = {};

describe('accountsForBackground', () => {
  it('keeps the in-progress account out of the Accounts view until the dialog completes', () => {
    const existing = account('codex-personal', 'codex');
    const draft = account('codex-client', 'codex', { name: 'Client' });
    expect(accountsForBackground([existing, draft], draft.id)).toEqual([existing]);
    expect(accountsForBackground([existing, draft], null)).toEqual([existing, draft]);
  });
});

describe('addAvailability (ACC-03)', () => {
  it('enables Add account for parallel agents on every OS, however many accounts exist', () => {
    const claude = agent('claude', 'parallel');
    expect(addAvailability(claude, 0, 'macos').enabled).toBe(true);
    expect(addAvailability(claude, 4, 'windows').enabled).toBe(true);
  });

  it('allows the first account on a single-account OS and disables it after that', () => {
    const agy = agent('agy', 'single', { displayName: 'Antigravity' });
    expect(addAvailability(agy, 0, 'macos').enabled).toBe(true);
    const full = addAvailability(agy, 1, 'macos');
    expect(full.enabled).toBe(false);
    expect(full.title).toBe('Antigravity allows one account on macOS');
  });

  it('disables Add account until the machine check verifies an unverified agent', () => {
    const oc = agent('opencode', 'unverified', { displayName: 'OpenCode' });
    const result = addAvailability(oc, 0, 'windows');
    expect(result.enabled).toBe(false);
    expect(result.title).toBe('Run the check first');
  });

  it('enables it once the check has made the agent parallel', () => {
    const oc = agent('opencode', 'parallel', { displayName: 'OpenCode' });
    expect(addAvailability(oc, 1, 'windows').enabled).toBe(true);
  });
});

describe('supportText per OS', () => {
  it('reads the support label for each state and OS name', () => {
    expect(supportText('parallel', 'linux')).toBe('Several accounts at once');
    expect(supportText('single', 'windows')).toBe('One account on Windows');
    expect(supportText('unverified', 'macos')).toBe('Not yet confirmed on macOS');
  });
});

describe('shareSkillsFor (ACC-09)', () => {
  const base: AccountsFile = {
    routing: 'primary-first',
    accounts: {},
    limits: { max_runs_per_account: 3, near_limit_at: '85%' },
    share_skills: true,
  };

  it('defaults to on when there is no file yet', () => {
    expect(shareSkillsFor(null, 'claude')).toBe(true);
  });

  it('reads a boolean for every agent', () => {
    expect(shareSkillsFor({ ...base, share_skills: false }, 'codex')).toBe(false);
  });

  it('reads a per-agent map, defaulting an unlisted agent to on', () => {
    const file = { ...base, share_skills: { codex: false } } as AccountsFile;
    expect(shareSkillsFor(file, 'codex')).toBe(false);
    expect(shareSkillsFor(file, 'claude')).toBe(true);
  });
});

describe('account rows', () => {
  it('shows the masked email and plan', () => {
    const [section] = buildAgentSections({
      agents: [agent('claude', 'parallel')],
      accounts: [account('claude-work', 'claude', { emailMasked: 'a•••@acme.dev', plan: 'Pro' })],
      windows: {},
      limits: noLimits,
      file: null,
      os: 'macos',
    });
    expect(section?.accounts[0]?.emailDisplay).toBe('a•••@acme.dev');
    expect(section?.accounts[0]?.plan).toBe('Pro');
  });

  it('uses the quota window reset time when the limited event has not arrived yet', () => {
    const limited = account('codex-personal', 'codex', { state: 'limited', name: 'Personal' });
    const [section] = buildAgentSections({
      agents: [agent('codex', 'parallel')],
      accounts: [limited],
      windows: { 'codex-personal:5h': quotaWindow('codex-personal', 100, { resetsAt: '2026-10-12T10:00:00Z' }) },
      limits: noLimits,
      file: null,
      os: 'macos',
    });
    const localTime = new Date('2026-10-12T10:00:00Z');
    const time = `${String(localTime.getHours()).padStart(2, '0')}:${String(localTime.getMinutes()).padStart(2, '0')}`;
    expect(section?.accounts[0]?.stateLabel).toBe(`Limited · ${time}`);
    expect(section?.accounts[0]?.usageText).toBe(`Limited until ${time}`);
  });

  it('marks a signed-out account, routes it nowhere and asks to sign in', () => {
    const signedOut = account('claude-work', 'claude', { state: 'signed_out' });
    const [section] = buildAgentSections({
      agents: [agent('claude', 'parallel')],
      accounts: [signedOut],
      windows: {},
      limits: noLimits,
      file: null,
      os: 'linux',
    });
    const row = section?.accounts[0];
    expect(row?.stateLabel).toBe('Signed out');
    expect(row?.tone).toBe('err');
    expect(row?.roleText).toBe('Unavailable until signed in');
    expect(row?.loginLabel).toBe('Sign in');
    expect(row?.canMakePrimary).toBe(false);
    expect(isUsable(signedOut, noLimits)).toBe(false);
  });

  it('explains roles: primary, backup and switched off', () => {
    const accounts = [
      account('claude-personal', 'claude', { primary: true, name: 'Personal' }),
      account('claude-work', 'claude', { name: 'Work' }),
      account('claude-team', 'claude', { name: 'Team', use: false }),
    ];
    const [section] = buildAgentSections({
      agents: [agent('claude', 'parallel')],
      accounts,
      windows: {},
      limits: noLimits,
      file: null,
      os: 'linux',
    });
    expect(section?.accounts.map((r) => r.roleText)).toEqual([
      'Primary · used first',
      'Backup · used when the primary is busy',
      'Switched off · never used',
    ]);
    expect(section?.accounts[2]?.dimmed).toBe(true);
    expect(section?.accounts[0]?.canMakePrimary).toBe(false);
    expect(section?.accounts[1]?.canMakePrimary).toBe(true);
  });

  it('shows a limited account with its reset time from the limit store', () => {
    const resetsAt = new Date(2026, 9, 11, 15, 0).toISOString();
    const limits = { 'codex-personal': { resetsAt } };
    const [section] = buildAgentSections({
      agents: [agent('codex', 'parallel', { displayName: 'Codex' })],
      accounts: [account('codex-personal', 'codex', { state: 'limited' })],
      windows: {},
      limits,
      file: null,
      os: 'macos',
    });
    expect(section?.accounts[0]?.stateLabel).toBe('Limited · 15:00');
    expect(section?.accounts[0]?.tone).toBe('limited');
    expect(section?.accounts[0]?.usageText).toBe('Limited until 15:00');
    expect(section?.summary).toBe('1 account · 0 usable now');
  });

  it('labels estimated windows with a tilde and reads reported ones plainly', () => {
    const acct = account('agy-main', 'agy', { state: 'estimated' });
    expect(usageText(acct, [quotaWindow('agy-main', 30, { window: 'daily', source: 'estimated' })], noLimits)).toBe(
      '~30% of daily',
    );
    const reported = account('claude-personal', 'claude');
    expect(usageText(reported, [quotaWindow('claude-personal', 62)], noLimits)).toBe('62% of 5-hour');
  });

  it('shows Usage when no window has been seen yet', () => {
    expect(usageText(account('claude-work', 'claude'), [], noLimits)).toBe('Usage');
  });

  it('counts only usable accounts in the summary', () => {
    const [section] = buildAgentSections({
      agents: [agent('claude', 'parallel')],
      accounts: [
        account('claude-personal', 'claude', { primary: true }),
        account('claude-work', 'claude', { state: 'signed_out' }),
        account('claude-team', 'claude', { use: false }),
      ],
      windows: {},
      limits: noLimits,
      file: null,
      os: 'linux',
    });
    expect(section?.summary).toBe('3 accounts · 1 usable now');
  });
});

describe('agent sections per OS', () => {
  it('adds the OS note for Antigravity on macOS and Windows only', () => {
    const agy = agent('agy', 'single', { displayName: 'Antigravity' });
    const onMac = buildAgentSections({ agents: [agy], accounts: [], windows: {}, limits: noLimits, file: null, os: 'macos' });
    const onLinux = buildAgentSections({ agents: [agy], accounts: [], windows: {}, limits: noLimits, file: null, os: 'linux' });
    expect(onMac[0]?.supportNote).toContain('Keychain');
    expect(onLinux[0]?.supportNote).toBeNull();
  });

  it('adds the OpenCode Windows note and the Claude Pro/Max note for OpenCode', () => {
    const oc = agent('opencode', 'unverified', { displayName: 'OpenCode' });
    const [section] = buildAgentSections({ agents: [oc], accounts: [], windows: {}, limits: noLimits, file: null, os: 'windows' });
    expect(section?.supportNote).toContain('%LOCALAPPDATA%');
    expect(section?.isOpenCode).toBe(true);
  });

  it('uses the bare setting name in the via label', () => {
    const [section] = buildAgentSections({
      agents: [agent('codex', 'parallel', { accountSetting: 'CODEX_HOME' })],
      accounts: [],
      windows: {},
      limits: noLimits,
      file: null,
      os: 'linux',
    });
    expect(section?.via).toBe('via CODEX_HOME');
  });

  it('shows the shared-skills wording for on and off', () => {
    const on = buildAgentSections({
      agents: [agent('claude', 'parallel', { sharedSkillsCount: 12 })],
      accounts: [],
      windows: {},
      limits: noLimits,
      file: null,
      os: 'linux',
    })[0];
    expect(on?.skillsShared).toBe(true);
    expect(on?.skillsText).toBe('12 skills (incl. saas-factory) shared with all claude accounts from');
    const off = buildAgentSections({
      agents: [agent('claude', 'parallel')],
      accounts: [],
      windows: {},
      limits: noLimits,
      file: { routing: 'primary-first', accounts: {}, limits: { max_runs_per_account: 3, near_limit_at: '85%' }, share_skills: { claude: false } },
      os: 'linux',
    })[0];
    expect(off?.skillsText).toBe('Each account only sees skills installed in its own folder, not');
  });
});
