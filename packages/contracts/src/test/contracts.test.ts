import { describe, expect, it } from 'vitest';
import { AccountsFile, EngineRequest, JobSpec, AccountId, CHANNELS } from '../common/index.js';

describe('accounts.yaml schema', () => {
  it('accepts the documented example', () => {
    const r = AccountsFile.safeParse({
      routing: 'primary-first',
      accounts: { claude: { personal: { primary: true }, work: {} }, codex: { personal: { primary: true }, team: { use: false } } },
      limits: { max_runs_per_account: 3, near_limit_at: '85%' },
      share_skills: true,
    });
    expect(r.success).toBe(true);
  });
  it('fills defaults for an empty file', () => {
    const r = AccountsFile.parse({});
    expect(r.routing).toBe('primary-first');
    expect(r.limits.max_runs_per_account).toBe(3);
  });
  it('rejects two primaries for one agent', () => {
    const r = AccountsFile.safeParse({ accounts: { codex: { a: { primary: true }, b: { primary: true } } } });
    expect(r.success).toBe(false);
  });
  it('rejects unknown agents and unknown keys', () => {
    expect(AccountsFile.safeParse({ accounts: { cursor: { x: {} } } }).success).toBe(false);
    expect(AccountsFile.safeParse({ routing: 'primary-first', colour: 'blue' }).success).toBe(false);
  });
});

describe('engine env allowlist', () => {
  const base = { op: 'session.start', agent: 'codex', cwd: '/r', readOnly: false } as const;
  it('accepts account variables', () => {
    expect(EngineRequest.safeParse({ ...base, env: { CODEX_HOME: '/p' } }).success).toBe(true);
  });
  it('rejects anything else, e.g. API keys', () => {
    expect(EngineRequest.safeParse({ ...base, env: { OPENAI_API_KEY: 'sk-x' } }).success).toBe(false);
  });
  it('rejects an empty env', () => {
    expect(EngineRequest.safeParse({ ...base, env: {} }).success).toBe(false);
  });
});

describe('ids and jobs', () => {
  it('account ids follow <agent>-<slug>', () => {
    expect(AccountId.safeParse('codex-team').success).toBe(true);
    expect(AccountId.safeParse('Codex Team').success).toBe(false);
  });
  it('compare mode needs at least two agents', () => {
    expect(JobSpec.safeParse({ mode: 'compare', goal: 'x', repoPath: '/r', agents: ['claude'] }).success).toBe(false);
  });
  it('lists every service channel', () => {
    expect(CHANNELS).toContain('accounts');
    expect(new Set(CHANNELS).size).toBe(CHANNELS.length);
  });
});
