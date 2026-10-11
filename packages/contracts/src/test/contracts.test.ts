import { describe, expect, it } from 'vitest';
import {
  Account,
  AccountsFile,
  CHANNELS,
  ConfigFieldError,
  DoctorRunRequest,
  EngineRequest,
  JobSpec,
  AccountId,
  OrchEvent,
  ProviderLogin,
  SignInResult,
  SpecInitReport,
} from '../common/index.js';

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

describe('C-01 owner-approved additions', () => {
  const signIn = {
    accountId: 'codex-team',
    signedIn: true,
    keptSeparate: true,
    ready: true,
    identity: 'checked',
  } as const;

  it('SignInResult requires identity checked or unknown', () => {
    expect(SignInResult.safeParse(signIn).success).toBe(true);
    expect(SignInResult.safeParse({ ...signIn, identity: 'unknown' }).success).toBe(true);
    expect(SignInResult.safeParse({ ...signIn, identity: 'maybe' }).success).toBe(false);
    const withoutIdentity: Record<string, unknown> = { ...signIn };
    delete withoutIdentity.identity;
    expect(SignInResult.safeParse(withoutIdentity).success).toBe(false);
  });

  it('Account.providers takes {provider, kind} entries and stays optional (ACC-10)', () => {
    const account = {
      id: 'opencode-main',
      agent: 'opencode',
      name: 'Main',
      primary: true,
      use: true,
      state: 'available',
      profileDir: '/p/opencode-main',
      skillsShared: false,
    };
    expect(Account.safeParse(account).success).toBe(true);
    expect(
      Account.safeParse({ ...account, providers: [{ provider: 'GitHub Copilot', kind: 'subscription' }] }).success,
    ).toBe(true);
    expect(Account.safeParse({ ...account, providers: [{ id: 'x', signedIn: true }] }).success).toBe(false);
    expect(ProviderLogin.safeParse({ provider: 'OpenAI', kind: 'oauth' }).success).toBe(false);
  });

  it('DoctorRunRequest accepts an optional signInTwice flag only', () => {
    expect(DoctorRunRequest.safeParse({}).success).toBe(true);
    expect(DoctorRunRequest.safeParse({ signInTwice: true }).success).toBe(true);
    expect(DoctorRunRequest.safeParse({ signInTwice: 'yes' }).success).toBe(false);
    expect(DoctorRunRequest.safeParse({ signInTwice: true, other: 1 }).success).toBe(true);
  });

  it('SpecInitReport matches what the BMAD init reports', () => {
    const report = {
      added: [{ file: 'docs/stories/001-login.md', id: '1', title: 'Login story', criteriaCount: 3 }],
      skipped: ['003-existing.md'],
    };
    expect(SpecInitReport.safeParse(report).success).toBe(true);
    expect(SpecInitReport.safeParse({ added: [], skipped: [] }).success).toBe(true);
    expect(SpecInitReport.safeParse({ added: [{ ...report.added[0], criteriaCount: -1 }], skipped: [] }).success).toBe(false);
    expect(SpecInitReport.safeParse({ added: [] }).success).toBe(false);
  });

  it('ConfigFieldError allows a null line (whole-file errors)', () => {
    expect(ConfigFieldError.safeParse({ path: '', line: null, message: 'bad' }).success).toBe(true);
    expect(ConfigFieldError.safeParse({ path: 'limits.near_limit_at', line: 4, message: 'bad' }).success).toBe(true);
    expect(ConfigFieldError.safeParse({ path: 'x', line: '4', message: 'bad' }).success).toBe(false);
  });

  it('config.invalid event carries field errors', () => {
    const event = {
      type: 'config.invalid',
      errors: [{ path: 'routing', line: 2, message: 'Invalid enum value' }],
    };
    expect(OrchEvent.safeParse(event).success).toBe(true);
    expect(OrchEvent.safeParse({ type: 'config.invalid', errors: [{ path: 'routing' }] }).success).toBe(false);
    expect(OrchEvent.safeParse({ type: 'config.changed', source: 'file' }).success).toBe(true);
  });
});
