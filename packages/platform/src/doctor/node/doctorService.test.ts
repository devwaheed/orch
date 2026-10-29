import { mkdir, mkdtemp, readdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountId, type AgentAdapter, type AgentId, type DoctorCheck, type Result } from '@orchagents/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeAdapter } from '../../adapters/node/claude.js';
import { ProfilesService, currentOs } from '../../profiles/node/profilesService.js';
import type { IProfilesService } from '../../profiles/common/profiles.js';
import type { ProcessOutcome, ProcessRunner } from '../common/doctor.js';
import { DoctorService, type DoctorServiceOptions } from './doctorService.js';

const ran = (stdout: string, exitCode = 0): ProcessOutcome => ({ kind: 'ran', exitCode, stdout, stderr: '' });
const notFound: ProcessOutcome = { kind: 'not_found' };

/** Answers commands from a table keyed by the argv joined with spaces; anything else is not found. */
function fakeRunner(table: Record<string, ProcessOutcome | ((cwd?: string) => ProcessOutcome)>): ProcessRunner & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async run(argv, options) {
      calls.push([...argv]);
      const key = argv.join(' ');
      const match = Object.keys(table).find((k) => key === k || key.startsWith(`${k} `));
      const entry = match === undefined ? undefined : table[match];
      if (entry === undefined) return notFound;
      return typeof entry === 'function' ? entry(options?.cwd) : entry;
    },
  };
}

/** Signed-in identity per profile folder name, as the who-am-I output would show it. */
function whoAmIOutput(email: string | null): string {
  return email === null ? JSON.stringify({ loggedIn: false }) : JSON.stringify({ loggedIn: true, email, subscriptionType: 'pro' });
}

class NoWhoAmI extends ClaudeAdapter {
  override whoAmICommand(): null {
    return null;
  }
}

class SingleAccountClaude extends ClaudeAdapter {
  override readonly supportByOs = { macos: 'single', linux: 'single', windows: 'single' } as const;
}

describe('DoctorService', () => {
  let base: string;
  let home: string;
  let root: string;
  let shared: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'orch-doctor-test-'));
    home = join(base, 'home');
    root = join(home, '.orch', 'profiles');
    shared = join(home, '.claude', 'skills');
    await mkdir(shared, { recursive: true });
    await writeFile(join(shared, 'review.md'), 'skill');
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  function realProfiles(adapters: readonly AgentAdapter[]): ProfilesService {
    return new ProfilesService({
      profilesRoot: root,
      homeDir: home,
      os: currentOs(),
      adapterFor: (agent: AgentId) => adapters.find((a) => a.id === agent),
    });
  }

  /** Healthy machine: claude 2.0.14, git works, engine answers. */
  function healthyTable(extra: Record<string, ProcessOutcome | ((cwd?: string) => ProcessOutcome)> = {}) {
    return {
      'claude --version': ran('2.0.14 (Claude Code)'),
      'git --version': ran('git version 2.39.5'),
      'git init -q': ran(''),
      'git worktree list': ran(''),
      ...extra,
    };
  }

  function options(over: Partial<DoctorServiceOptions> & { runner: ProcessRunner; adapters?: AgentAdapter[] }): DoctorServiceOptions {
    const adapters = over.adapters ?? [new ClaudeAdapter()];
    const { adapters: _ignored, ...rest } = over;
    void _ignored;
    return {
      agents: adapters,
      profiles: realProfiles(adapters),
      engine: { ping: async () => ({ ok: true, value: { engineVersion: '7.5.6' } }) },
      signIn: async () => ({ ok: true, value: undefined }),
      os: currentOs(),
      homeDir: home,
      dataDir: join(home, '.orch'),
      orchVersion: '1.0.0-beta.1',
      minFreeBytes: 1,
      tempDir: base,
      ...rest,
    } as DoctorServiceOptions;
  }

  async function run(opts: DoctorServiceOptions, req?: { signInTwice?: boolean }) {
    const result = await new DoctorService(opts).run(req);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    return result.value;
  }

  function find(checks: DoctorCheck[], id: string): DoctorCheck {
    const c = checks.find((x) => x.id === id);
    if (!c) throw new Error(`no check ${id}: ${checks.map((x) => x.id).join(', ')}`);
    return c;
  }

  it('passes every check on a healthy machine, and reports os, versions', async () => {
    const report = await run(options({ runner: fakeRunner(healthyTable()) }));

    expect(report.os).toBe(currentOs());
    expect(report.orchVersion).toBe('1.0.0-beta.1');
    expect(report.engineVersion).toBe('7.5.6');
    expect(report.checks.map((c) => [c.id, c.status])).toEqual([
      ['cli_on_path', 'warn'],
      ['agent.claude', 'pass'],
      ['git', 'pass'],
      ['git.worktrees', 'pass'],
      ['engine', 'pass'],
      ['skills.claude', 'pass'],
      ['disk', 'pass'],
    ]);
  });

  it('checks orch using a temporary PATH folder and reports pass after a launcher appears', async () => {
    const pathFolder = join(base, 'path');
    await mkdir(pathFolder);
    const missing = await run(options({ runner: fakeRunner(healthyTable()), pathEnv: pathFolder, installKind: 'dev' }));
    expect(find(missing.checks, 'cli_on_path')).toMatchObject({
      status: 'warn',
      fix: currentOs() === 'windows'
        ? 'Reinstall orch to add the orch command to your PATH.'
        : 'Choose "Install orch command" in the orch menu or the command palette.',
    });

    const executable = join(pathFolder, currentOs() === 'windows' ? 'orch.cmd' : 'orch');
    await writeFile(executable, currentOs() === 'windows' ? '@echo off\r\n' : '#!/bin/sh\n');
    if (currentOs() !== 'windows') {
      const { chmod } = await import('node:fs/promises');
      await chmod(executable, 0o755);
    }
    const found = await run(options({ runner: fakeRunner(healthyTable()), pathEnv: pathFolder, installKind: 'dev' }));
    expect(find(found.checks, 'cli_on_path').status).toBe('pass');
  });

  it('warns when the agent is not installed, and does not fail the other checks', async () => {
    const runner = fakeRunner(healthyTable({ 'claude --version': notFound }));
    const report = await run(options({ runner }));
    const agent = find(report.checks, 'agent.claude');
    expect(agent.status).toBe('warn');
    expect(agent.fix).toBeTruthy();
    expect(agent.agent).toBe('claude');
  });

  it('warns when the agent version is outside its tested range', async () => {
    const report = await run(options({ runner: fakeRunner(healthyTable({ 'claude --version': ran('3.0.0') })) }));
    expect(find(report.checks, 'agent.claude').status).toBe('warn');
  });

  it('fails when git is missing, and worktrees fail with it', async () => {
    const report = await run(options({ runner: fakeRunner(healthyTable({ 'git --version': notFound, 'git init -q': notFound })) }));
    expect(find(report.checks, 'git').status).toBe('fail');
    expect(find(report.checks, 'git.worktrees').status).toBe('fail');
    expect(find(report.checks, 'git.worktrees').fix).toBeTruthy();
  });

  it('fails worktrees when worktree list exits non-zero in the throwaway repo', async () => {
    const runner = fakeRunner(healthyTable({ 'git worktree list': ran('', 129) }));
    const report = await run(options({ runner }));
    expect(find(report.checks, 'git.worktrees').status).toBe('fail');
  });

  it('removes the throwaway git repo after the worktree check', async () => {
    const seen: string[] = [];
    const runner = fakeRunner(
      healthyTable({
        'git worktree list': (cwd) => {
          if (cwd) seen.push(cwd);
          return ran('');
        },
      }),
    );
    await run(options({ runner }));
    expect(seen).toHaveLength(1);
    const left = await readdir(base);
    expect(left.some((name) => name.startsWith('orch-doctor-'))).toBe(false);
  });

  it('warns when the throwaway git repo cannot be made', async () => {
    const blocker = join(base, 'not-a-folder');
    await writeFile(blocker, 'x');
    const report = await run(options({ runner: fakeRunner(healthyTable()), tempDir: blocker }));
    expect(find(report.checks, 'git.worktrees').status).toBe('warn');
  });

  it('fails the engine check when the engine does not answer', async () => {
    const report = await run(
      options({
        runner: fakeRunner(healthyTable()),
        engine: { ping: async () => ({ ok: false, error: { code: 'engine_unavailable', message: 'down' } }) },
      }),
    );
    expect(find(report.checks, 'engine').status).toBe('fail');
    expect(report.engineVersion).toBe('');
  });

  it('fails the engine check when ping throws, without throwing from run()', async () => {
    const report = await run(
      options({
        runner: fakeRunner(healthyTable()),
        engine: {
          ping: async () => {
            throw new Error('boom');
          },
        },
      }),
    );
    expect(find(report.checks, 'engine').status).toBe('fail');
  });

  it('warns when the engine reports another version than expected', async () => {
    const report = await run(options({ runner: fakeRunner(healthyTable()), expectedEngineVersion: '7.5.5' }));
    expect(find(report.checks, 'engine').status).toBe('warn');
  });

  it('reports a failed runner call as a failed command, without throwing', async () => {
    const runner: ProcessRunner = {
      run: async (argv) => {
        if (argv[0] === 'claude') throw new Error('spawn exploded');
        return ran('git version 2.39.5');
      },
    };
    const report = await run(options({ runner }));
    expect(find(report.checks, 'agent.claude').status).toBe('fail');
  });

  describe('disk space', () => {
    it('fails when free space is below the required minimum', async () => {
      const report = await run(options({ runner: fakeRunner(healthyTable()), minFreeBytes: Number.MAX_SAFE_INTEGER }));
      expect(find(report.checks, 'disk').status).toBe('fail');
    });

    it('warns when free space cannot be measured', async () => {
      const report = await run(options({ runner: fakeRunner(healthyTable()), measureFreeBytes: async () => null }));
      expect(find(report.checks, 'disk').status).toBe('warn');
    });

    it('measures the real disk by default', async () => {
      const report = await run(options({ runner: fakeRunner(healthyTable()) }));
      expect(find(report.checks, 'disk').status).toBe('pass');
    });
  });

  describe('shared skills', () => {
    it('passes when the throwaway account links to the shared skills folder, and removes the account', async () => {
      const report = await run(options({ runner: fakeRunner(healthyTable()) }));
      expect(find(report.checks, 'skills.claude').status).toBe('pass');
      expect(await readdir(root)).toEqual([]);
    });

    it('passes when there is no shared skills folder yet', async () => {
      await rm(shared, { recursive: true, force: true });
      const report = await run(options({ runner: fakeRunner(healthyTable()) }));
      expect(find(report.checks, 'skills.claude').status).toBe('pass');
    });

    it('fails when the shared folder exists but the account link is missing', async () => {
      const profiles: IProfilesService = {
        create: async ({ agent }) => {
          const dir = join(root, `${agent}-unlinked`);
          await mkdir(dir, { recursive: true });
          return { ok: true, value: { accountId: AccountId.parse(`${agent}-unlinked`), profileDir: dir, skillsShared: false } };
        },
        remove: async () => ({ ok: true, value: undefined }),
        setSharedSkills: async () => ({ ok: true, value: false }),
        sessionEnv: async () => ({ ok: true, value: {} }),
      };
      const report = await run(options({ runner: fakeRunner(healthyTable()), profiles }));
      const skills = find(report.checks, 'skills.claude');
      expect(skills.status).toBe('fail');
      expect(skills.fix).toBeTruthy();
    });

    it('warns when the throwaway account cannot be made', async () => {
      const profiles: IProfilesService = {
        create: async () => ({ ok: false, error: { code: 'internal', message: 'no', fix: 'x' } }),
        remove: async () => ({ ok: true, value: undefined }),
        setSharedSkills: async () => ({ ok: true, value: false }),
        sessionEnv: async () => ({ ok: true, value: {} }),
      };
      const report = await run(options({ runner: fakeRunner(healthyTable()), profiles }));
      expect(find(report.checks, 'skills.claude').status).toBe('warn');
    });

    it('detects a link that points somewhere else', async () => {
      const elsewhere = join(base, 'elsewhere');
      await mkdir(elsewhere, { recursive: true });
      const profiles: IProfilesService = {
        create: async ({ agent }) => {
          const dir = join(root, `${agent}-wrong`);
          await mkdir(dir, { recursive: true });
          await symlink(elsewhere, join(dir, 'skills'));
          return { ok: true, value: { accountId: AccountId.parse(`${agent}-wrong`), profileDir: dir, skillsShared: true } };
        },
        remove: async () => ({ ok: true, value: undefined }),
        setSharedSkills: async () => ({ ok: true, value: false }),
        sessionEnv: async () => ({ ok: true, value: {} }),
      };
      const report = await run(options({ runner: fakeRunner(healthyTable()), profiles }));
      expect(find(report.checks, 'skills.claude').status).toBe('fail');
    });
  });

  describe('isolation (only when the user opts in to signing in twice)', () => {
    /** A runner that answers who-am-I per CLAUDE_CONFIG_DIR, so the two throwaway accounts can differ. */
    function identityRunner(identityFor: (dir: string) => string | null): ProcessRunner {
      return {
        async run(argv, options) {
          const key = argv.join(' ');
          if (key === 'claude --version') return ran('2.0.14');
          if (key === 'git --version') return ran('git version 2.39.5');
          if (argv[0] === 'git') return ran('');
          if (key === 'claude auth status --json') {
            const dir = options?.env?.CLAUDE_CONFIG_DIR ?? '';
            return ran(whoAmIOutput(identityFor(dir)));
          }
          return notFound;
        },
      };
    }

    /** Signs in only the throwaway folders named in `emails`; any other folder fails like a cancelled sign-in. */
    function signInMap(emails: Record<string, string>) {
      return async (_agent: AgentId, profileDir: string): Promise<Result<void>> => {
        const folder = profileDir.split(/[\\/]/).pop() ?? '';
        if (emails[folder] === undefined) {
          return { ok: false, error: { code: 'internal', message: 'not signed in', fix: 'Sign in again.' } };
        }
        return { ok: true, value: undefined };
      };
    }

    it('is not run unless signInTwice is set', async () => {
      const report = await run(options({ runner: identityRunner(() => 'a•••@acme.dev') }));
      expect(report.checks.some((c) => c.id.startsWith('isolation.'))).toBe(false);
    });

    it('passes when the two throwaway accounts show different accounts, then removes them', async () => {
      const signedIn: Record<string, string> = {};
      const runner = identityRunner((dir) => (dir.endsWith('claude-orch-doctor-a') ? 'a•••@acme.dev' : 'b•••@acme.dev'));
      const report = await run(
        options({
          runner,
          signIn: async (agent, profileDir) => {
            signedIn[profileDir] = agent;
            return { ok: true, value: undefined };
          },
        }),
        { signInTwice: true },
      );
      expect(Object.keys(signedIn)).toHaveLength(2);
      expect(find(report.checks, 'isolation.claude').status).toBe('pass');
      expect(await readdir(root)).toEqual([]);
    });

    it('fails when both throwaway accounts show the same account', async () => {
      const report = await run(options({ runner: identityRunner(() => 'a•••@acme.dev') }), { signInTwice: true });
      const c = find(report.checks, 'isolation.claude');
      expect(c.status).toBe('fail');
      expect(c.fix).toBeTruthy();
    });

    it('fails when an account is not signed in (who-am-I shows nobody)', async () => {
      const report = await run(
        options({ runner: identityRunner((dir) => (dir.endsWith('-a') ? 'a•••@acme.dev' : null)) }),
        { signInTwice: true },
      );
      expect(find(report.checks, 'isolation.claude').status).toBe('fail');
    });

    it('fails with the sign-in fix when a throwaway account is not signed in', async () => {
      const report = await run(
        options({ runner: identityRunner(() => 'a•••@acme.dev'), signIn: signInMap({}) }),
        { signInTwice: true },
      );
      const c = find(report.checks, 'isolation.claude');
      expect(c.status).toBe('fail');
      expect(c.fix).toBe('Sign in again.');
      expect(await readdir(root)).toEqual([]);
    });

    it('warns when the agent has no who-am-I command', async () => {
      const adapter = new NoWhoAmI();
      const report = await run(
        options({ adapters: [adapter], runner: identityRunner(() => 'x'), profiles: realProfiles([adapter]) }),
        { signInTwice: true },
      );
      const c = find(report.checks, 'isolation.claude');
      expect(c.status).toBe('warn');
      expect(c.fix).toBeTruthy();
      expect(await readdir(root)).toEqual([]);
    });

    it('is skipped for an agent that supports only one account on this OS', async () => {
      const adapter = new SingleAccountClaude();
      const report = await run(
        options({ adapters: [adapter], runner: identityRunner(() => 'x'), profiles: realProfiles([adapter]) }),
        { signInTwice: true },
      );
      expect(report.checks.some((c) => c.id === 'isolation.claude')).toBe(false);
    });

    it('fails with the profiles error when a throwaway account cannot be made', async () => {
      const profiles: IProfilesService = {
        create: async () => ({ ok: false, error: { code: 'internal', message: 'Could not set up the account folder.', fix: 'Try again.' } }),
        remove: async () => ({ ok: true, value: undefined }),
        setSharedSkills: async () => ({ ok: true, value: false }),
        sessionEnv: async () => ({ ok: true, value: {} }),
      };
      const report = await run(options({ runner: identityRunner(() => 'x'), profiles }), { signInTwice: true });
      const c = find(report.checks, 'isolation.claude');
      expect(c.status).toBe('fail');
      expect(c.title).toBe('Could not set up the account folder.');
      expect(c.fix).toBe('Try again.');
    });
  });

  it('never throws, even when the adapter list is empty', async () => {
    const report = await run(options({ adapters: [], runner: fakeRunner(healthyTable()) }));
    expect(report.checks.map((c) => c.id)).toEqual(['cli_on_path', 'git', 'git.worktrees', 'engine', 'disk']);
  });
});
