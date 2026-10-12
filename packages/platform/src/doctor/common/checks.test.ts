import { describe, expect, it } from 'vitest';
import type { ProcessOutcome } from './doctor.js';
import {
  agentVersionCheck,
  diskCheck,
  cliOnPathCheck,
  engineCheck,
  gitCheck,
  isolationCheck,
  signInFailedCheck,
  skillsCheck,
  worktreeCheck,
} from './checks.js';
import { DOCTOR_COPY } from './strings.js';

const ran = (stdout: string, exitCode = 0, stderr = ''): ProcessOutcome => ({ kind: 'ran', exitCode, stdout, stderr });
const notFound: ProcessOutcome = { kind: 'not_found' };
const didNotStart: ProcessOutcome = { kind: 'did_not_start' };

describe('agentVersionCheck', () => {
  const base = { agent: 'claude' as const, name: 'Claude Code', command: 'claude', testedVersions: '>=2.0.0 <3.0.0' };

  it('passes when the version is in the tested range', () => {
    const c = agentVersionCheck({ ...base, outcome: ran('2.0.14 (Claude Code)\n') });
    expect(c).toEqual({
      id: 'agent.claude',
      agent: 'claude',
      title: 'Claude Code 2.0.14 is installed',
      status: 'pass',
    });
  });

  it('warns with a fix when the agent is not installed', () => {
    const c = agentVersionCheck({ ...base, outcome: notFound });
    expect(c.status).toBe('warn');
    expect(c.title).toBe('Claude Code is not installed');
    expect(c.fix).toContain('`claude`');
  });

  it('warns with a fix when the version is outside the tested range', () => {
    const c = agentVersionCheck({ ...base, outcome: ran('3.1.0 (Claude Code)') });
    expect(c.status).toBe('warn');
    expect(c.title).toBe('Claude Code 3.1.0 is outside the tested range (>=2.0.0 <3.0.0)');
    expect(c.fix).toBeTruthy();
  });

  it('warns when the version cannot be read', () => {
    const c = agentVersionCheck({ ...base, outcome: ran('something else') });
    expect(c.status).toBe('warn');
    expect(c.fix).toBeTruthy();
  });

  it('warns when the tested range uses a form orch cannot compare', () => {
    const c = agentVersionCheck({ ...base, testedVersions: '*', outcome: ran('2.0.14') });
    expect(c.status).toBe('warn');
    expect(c.fix).toBeTruthy();
  });

  it('reads the version from stderr when stdout has none', () => {
    const c = agentVersionCheck({ ...base, outcome: ran('', 0, '2.0.14') });
    expect(c.status).toBe('pass');
  });

  it('fails with a fix when the command exits non-zero', () => {
    const c = agentVersionCheck({ ...base, outcome: ran('', 1, 'boom') });
    expect(c.status).toBe('fail');
    expect(c.fix).toContain('claude --version');
  });

  it('fails with a fix when the command cannot start', () => {
    const c = agentVersionCheck({ ...base, outcome: didNotStart });
    expect(c.status).toBe('fail');
    expect(c.title).toBe(DOCTOR_COPY.agent.didNotStart('Claude Code'));
  });
});

describe('gitCheck', () => {
  it('passes when git runs', () => {
    expect(gitCheck(ran('git version 2.39.5')).status).toBe('pass');
  });

  it('fails with a fix when git is missing', () => {
    const c = gitCheck(notFound);
    expect(c.status).toBe('fail');
    expect(c.fix).toBeTruthy();
  });

  it('fails when git exits non-zero or cannot start', () => {
    expect(gitCheck(ran('', 2)).status).toBe('fail');
    expect(gitCheck(didNotStart).status).toBe('fail');
  });
});

describe('worktreeCheck', () => {
  it('passes when worktree list works in the throwaway repo', () => {
    expect(worktreeCheck(ran('/tmp/x  (bare)')).status).toBe('pass');
  });

  it('fails with a fix when worktree list fails', () => {
    const c = worktreeCheck(ran('', 129));
    expect(c.status).toBe('fail');
    expect(c.fix).toBeTruthy();
    expect(worktreeCheck(notFound).status).toBe('fail');
  });

  it('warns when the throwaway repo could not be made', () => {
    const c = worktreeCheck('untested');
    expect(c.status).toBe('warn');
    expect(c.fix).toBeTruthy();
  });
});

describe('engineCheck', () => {
  it('passes when the engine answers', () => {
    expect(engineCheck({ ok: true, value: { engineVersion: '7.5.6' } }).status).toBe('pass');
  });

  it('passes when the expected version matches', () => {
    expect(engineCheck({ ok: true, value: { engineVersion: '7.5.6' } }, '7.5.6').status).toBe('pass');
  });

  it('warns when the engine reports another version than expected', () => {
    const c = engineCheck({ ok: true, value: { engineVersion: '7.5.5' } }, '7.5.6');
    expect(c.status).toBe('warn');
    expect(c.title).toBe('The engine is version 7.5.5, not 7.5.6');
    expect(c.fix).toBeTruthy();
  });

  it('fails with a fix when the engine does not answer', () => {
    const c = engineCheck({ ok: false, error: { code: 'engine_unavailable', message: 'x' } });
    expect(c.status).toBe('fail');
    expect(c.title).toBe('The engine is not running.');
    expect(c.fix).toBeTruthy();
  });
});

describe('isolationCheck', () => {
  const base = { agent: 'codex' as const, name: 'Codex' };

  it('passes when the two throwaway accounts show different masked identities', () => {
    const c = isolationCheck({ ...base, supported: true, first: 'a•••@acme.dev', second: 'b•••@acme.dev' });
    expect(c.status).toBe('pass');
    expect(c.id).toBe('isolation.codex');
  });

  it('fails with a fix when both accounts show the same identity', () => {
    const c = isolationCheck({ ...base, supported: true, first: 'a•••@acme.dev', second: 'a•••@acme.dev' });
    expect(c.status).toBe('fail');
    expect(c.title).toBe('Two Codex accounts show the same sign-in');
    expect(c.fix).toBeTruthy();
  });

  it('fails with a fix when either account cannot be confirmed as signed in', () => {
    const c = isolationCheck({ ...base, supported: true, first: 'a•••@acme.dev', second: null });
    expect(c.status).toBe('fail');
    expect(c.fix).toBeTruthy();
  });

  it('warns with a fix when the agent has no who-am-I command', () => {
    const c = isolationCheck({ ...base, supported: false, first: null, second: null });
    expect(c.status).toBe('warn');
    expect(c.title).toBe('orch cannot check Codex sign-ins on its own');
    expect(c.fix).toBeTruthy();
  });

  it('builds the failure for a throwaway account that was not signed in', () => {
    const c = signInFailedCheck('codex', 'Codex', 'Try again.');
    expect(c.status).toBe('fail');
    expect(c.fix).toBe('Try again.');
    expect(signInFailedCheck('codex', 'Codex', undefined).fix).toBe(DOCTOR_COPY.isolation.signInNotDoneFix);
  });
});

describe('skillsCheck', () => {
  const base = { agent: 'claude' as const, name: 'Claude Code' };

  it('passes when the shared skills are linked into the account', () => {
    expect(skillsCheck({ ...base, sharedExists: true, linked: true }).status).toBe('pass');
  });

  it('passes when there is no shared skills folder yet, since nothing is linked then (ACC-09)', () => {
    expect(skillsCheck({ ...base, sharedExists: false, linked: false }).status).toBe('pass');
  });

  it('fails with a fix when the shared folder exists but the link is missing', () => {
    const c = skillsCheck({ ...base, sharedExists: true, linked: false });
    expect(c.status).toBe('fail');
    expect(c.fix).toBeTruthy();
  });

  it('warns when the test account could not be made', () => {
    const c = skillsCheck({ ...base, sharedExists: true, linked: 'untested' });
    expect(c.status).toBe('warn');
    expect(c.fix).toBeTruthy();
  });
});

describe('diskCheck', () => {
  it('passes when free space is at or above the threshold', () => {
    expect(diskCheck(1000, 1000).status).toBe('pass');
    expect(diskCheck(5000, 1000).status).toBe('pass');
  });

  it('fails with a fix when free space is below the threshold', () => {
    const c = diskCheck(999, 1000);
    expect(c.status).toBe('fail');
    expect(c.fix).toBeTruthy();
  });

  it('warns with a fix when free space cannot be measured', () => {
    const c = diskCheck(null, 1000);
    expect(c.status).toBe('warn');
    expect(c.fix).toBeTruthy();
  });
});

describe('cliOnPathCheck (INS-05)', () => {
  it('uses the install action for each platform and always warns rather than fails', () => {
    expect(cliOnPathCheck(false, 'macos', 'dmg')).toMatchObject({
      id: 'cli_on_path', status: 'warn',
      fix: 'Choose "Install orch command" in the orch menu or the command palette.',
    });
    expect(cliOnPathCheck(false, 'linux', 'deb').fix).toBe('Reinstall the orch package to restore /usr/bin/orch.');
    expect(cliOnPathCheck(false, 'windows', 'nsis').fix).toBe('Reinstall orch to add the orch command to your PATH.');
    expect(cliOnPathCheck(true, 'linux', 'appimage').status).toBe('pass');
  });
});
