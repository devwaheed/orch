import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { ok, err } from '@orchagents/base';
import type {
  Account,
  AccountId,
  AgentId,
  DoctorReport,
  IAccountsService,
  IDoctorService,
  IJobsService,
  IQuotaService,
  IRunsService,
  ISessionsService,
  Job,
  JobId,
  JobSpec,
  QuotaWindow,
  Run,
  RunId,
  Session,
  SessionId,
  SignInResult,
  WorktreeId,
} from '@orchagents/contracts';
import { ChannelClient } from '@orchagents/platform/src/channels/common/client.js';
import { createInProcessTransportPair } from '@orchagents/platform/src/channels/common/inProcess.js';
import { ChannelServer } from '@orchagents/platform/src/channels/common/server.js';
import { describe, expect, it } from 'vitest';
import { ExitCode } from '../common/exitCodes.js';
import { findGitRoot, runCli } from '../node/cli.js';
import { createServicesFromClient, type CliServices } from '../node/client.js';
import {
  createCliSocketTransport,
  getDefaultSocketPath,
  getDefaultTokenPath,
} from '../node/socketTransport.js';

function createFakeServices(onJobStart?: (spec: JobSpec) => void): {
  services: CliServices;
  server: ChannelServer;
  dispose: () => void;
} {
  const [transportA, transportB] = createInProcessTransportPair();
  const server = new ChannelServer();
  server.handleConnection(transportA);

  const fakeAccounts: Account[] = [
    {
      id: 'claude-personal' as AccountId,
      agent: 'claude',
      name: 'Personal',
      primary: true,
      use: true,
      state: 'available',
      emailMasked: 'a•••@gmail.com',
      plan: 'Max',
      profileDir: '/Users/test/.orch/profiles/claude-personal',
      skillsShared: true,
    },
    {
      id: 'claude-work' as AccountId,
      agent: 'claude',
      name: 'Work',
      primary: false,
      use: true,
      state: 'near_limit',
      emailMasked: 'a•••@acme.dev',
      plan: 'Pro',
      profileDir: '/Users/test/.orch/profiles/claude-work',
      skillsShared: true,
    },
    {
      id: 'codex-personal' as AccountId,
      agent: 'codex',
      name: 'Personal',
      primary: true,
      use: true,
      state: 'limited',
      emailMasked: 'a•••@gmail.com',
      plan: 'Plus',
      profileDir: '/Users/test/.orch/profiles/codex-personal',
      skillsShared: true,
    },
    {
      id: 'codex-team' as AccountId,
      agent: 'codex',
      name: 'Team',
      primary: false,
      use: true,
      state: 'available',
      emailMasked: 'a•••@acme.dev',
      plan: 'Team',
      profileDir: '/Users/test/.orch/profiles/codex-team',
      skillsShared: true,
    },
  ];

  const fakeAccountsService: Partial<IAccountsService> = {
    list: async () => ok(fakeAccounts),
    add: async (req) =>
      ok({
        id: `${req.agent}-${req.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` as AccountId,
        agent: req.agent,
        name: req.name,
        primary: false,
        use: true,
        state: 'available',
        emailMasked: 'n•••@client.com',
        profileDir: `/Users/test/.orch/profiles/${req.agent}-${req.name.toLowerCase()}`,
        skillsShared: true,
      }),
    signIn: async (accountId) =>
      ok({
        accountId,
        signedIn: true,
        emailMasked: 'n•••@client.com',
        keptSeparate: true,
        ready: true,
      } as SignInResult),
  };

  const fakeDoctorReport: DoctorReport = {
    os: 'macos',
    orchVersion: '1.0.0',
    engineVersion: '7.5.6',
    checks: [
      { id: 'agent_installed', title: 'agent installed and version in tested range', status: 'pass' },
      { id: 'git_worktrees', title: 'git supports worktrees', status: 'pass' },
      { id: 'engine_ping', title: 'engine ping', status: 'pass' },
      { id: 'shared_skills', title: 'shared skills visible in each profile', status: 'pass' },
      { id: 'disk_space', title: 'disk space', status: 'pass' },
    ],
  };

  const fakeDoctorService: Partial<IDoctorService> = {
    run: async () => ok(fakeDoctorReport),
  };

  const fakeJob: Job = {
    id: 'j-01' as JobId,
    title: 'fix the failing test',
    spec: {
      mode: 'single',
      goal: 'fix the failing test',
      repoPath: '/repo',
      checks: [{ kind: 'command', run: 'npm test' }],
      onLimit: 'switch-account',
      orchestrator: { agent: 'claude', account: 'auto' },
      workers: ['claude'],
    },
    status: 'running',
    step: { name: 'Implement', index: 1, total: 3, attempt: 1, looping: false },
    createdAt: '2026-10-11T12:00:00Z',
    scheduledFor: null,
  };

  const fakeJobsService: Partial<IJobsService> = {
    list: async () => ok([fakeJob]),
    start: async (spec: JobSpec) => {
      onJobStart?.(spec);
      return ok({
        ...fakeJob,
        title: spec.goal,
        spec,
      });
    },
  };

  const fakeRuns: Run[] = [
    {
      id: 'r-01' as RunId,
      jobId: 'j-01' as JobId,
      parentId: null,
      depth: 0,
      role: 'orchestrator',
      task: 'Plan OAuth login',
      agent: 'claude',
      accountId: 'claude-personal' as AccountId,
      status: 'running',
      worktree: null,
      readOnly: true,
      sessionId: 's-0f9d' as SessionId,
      startedAt: '2026-10-11T12:00:00Z',
      resumesAt: null,
    },
    {
      id: 'r-02' as RunId,
      jobId: 'j-01' as JobId,
      parentId: 'r-01' as RunId,
      depth: 1,
      role: 'implementer',
      task: 'Implement callback',
      agent: 'claude',
      accountId: 'claude-personal' as AccountId,
      status: 'running',
      worktree: 'orch/r-02' as WorktreeId,
      readOnly: false,
      sessionId: 's-7a1c' as SessionId,
      startedAt: '2026-10-11T12:05:00Z',
      resumesAt: null,
    },
    {
      id: 'r-04' as RunId,
      jobId: 'j-01' as JobId,
      parentId: 'r-01' as RunId,
      depth: 1,
      role: 'implementer',
      task: 'Refactor middleware',
      agent: 'codex',
      accountId: 'codex-personal' as AccountId,
      status: 'paused_limit',
      worktree: 'orch/r-04' as WorktreeId,
      readOnly: false,
      sessionId: 's-91e0' as SessionId,
      startedAt: '2026-10-11T12:10:00Z',
      resumesAt: '2026-10-11T15:00:00Z',
    },
  ];

  const fakeRunsService: Partial<IRunsService> = {
    list: async () => ok(fakeRuns),
    lines: async () => ok([]),
    resumeOn: async (runId, accountId) => {
      const match = fakeRuns.find((r) => r.id === runId);
      if (!match) return err({ code: 'not_found', message: `Run ${runId} not found` });
      return ok({ ...match, accountId, agent: accountId.split('-')[0] as AgentId });
    },
  };

  const fakeWindows: QuotaWindow[] = [
    {
      accountId: 'claude-personal' as AccountId,
      window: '5h',
      usedPct: 62,
      resetsAt: '2026-10-11T17:30:00Z',
      source: 'reported',
      seenAt: '2026-10-11T12:00:00Z',
    },
    {
      accountId: 'codex-personal' as AccountId,
      window: '5h',
      usedPct: 100,
      resetsAt: '2026-10-11T15:00:00Z',
      source: 'reported',
      seenAt: '2026-10-11T12:00:00Z',
    },
    {
      accountId: 'agy-main' as AccountId,
      window: 'daily',
      usedPct: 30,
      resetsAt: null,
      source: 'estimated',
      seenAt: '2026-10-11T12:00:00Z',
    },
  ];

  const fakeQuotaService: Partial<IQuotaService> = {
    windows: async () => ok(fakeWindows),
  };

  const fakeSessions: Session[] = [
    {
      id: 's-91e0' as SessionId,
      jobId: 'j-01' as JobId,
      runId: 'r-04' as RunId,
      title: 'Add OAuth login',
      agent: 'codex',
      accountId: 'codex-personal' as AccountId,
      cliSessionId: '91e0',
      status: 'paused',
      worktree: 'orch/r-04' as WorktreeId,
      startedAt: '2026-10-11T12:00:00Z',
      lastActivityAt: '2026-10-11T12:46:00Z',
      tokens: 4200,
      position: { step: 'Refactor', index: 1, total: 3, attempt: 1 },
      handedOffTo: null,
      handedOffFrom: null,
    },
    {
      id: 's-c410' as SessionId,
      jobId: 'j-01' as JobId,
      runId: 'r-03' as RunId,
      title: 'Add OAuth login',
      agent: 'gemini',
      accountId: 'gemini-google' as AccountId,
      cliSessionId: 'c410',
      status: 'ended',
      worktree: 'main (ro)' as WorktreeId,
      startedAt: '2026-10-11T12:00:00Z',
      lastActivityAt: '2026-10-11T12:32:00Z',
      tokens: 3100,
      position: { step: 'Review', index: 1, total: 1, attempt: 1 },
      handedOffTo: null,
      handedOffFrom: null,
    },
  ];

  const fakeSessionsService: Partial<ISessionsService> = {
    list: async () => ok(fakeSessions),
  };

  server.registerService('accounts', fakeAccountsService);
  server.registerService('doctor', fakeDoctorService);
  server.registerService('jobs', fakeJobsService);
  server.registerService('runs', fakeRunsService);
  server.registerService('quota', fakeQuotaService);
  server.registerService('sessions', fakeSessionsService);

  const client = new ChannelClient(transportB);
  const services = createServicesFromClient(client);

  return {
    services,
    server,
    dispose: () => {
      client.dispose();
      server.dispose();
      transportA.close();
      transportB.close();
    },
  };
}

describe('orch CLI', () => {
  describe('plain orch (CLI-04, CLI-05)', () => {
    it('prints help without opening when stdout is not a TTY or CI is set', async () => {
      const output: string[] = [];
      let opened = false;
      const code = await runCli([], { stdout: (text) => output.push(text), stdoutIsTTY: false, openApp: () => { opened = true; } });
      expect(code).toBe(ExitCode.Success);
      expect(output[0]).toContain('Usage: orch');
      expect(opened).toBe(false);
      const ciCode = await runCli([], { stdout: (text) => output.push(text), stdoutIsTTY: true, env: { CI: '1' }, openApp: () => { opened = true; } });
      expect(ciCode).toBe(ExitCode.Success);
      expect(opened).toBe(false);
    });

    it('opens a git root, and rejects existing paths outside repositories', async () => {
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-cli-'));
      try {
        const root = path.join(temp, 'repo');
        const nested = path.join(root, 'src');
        fs.mkdirSync(nested, { recursive: true });
        fs.writeFileSync(path.join(root, '.git'), 'gitdir: elsewhere');
        expect(findGitRoot(nested)).toBe(root);
        let opened: string | undefined;
        const code = await runCli([nested], { stdoutIsTTY: true, platform: 'linux', env: { DISPLAY: ':0' }, openApp: (repo) => { opened = repo; } });
        expect(code).toBe(ExitCode.Success);
        expect(opened).toBe(root);
        let openedPlain = false;
        expect(await runCli([], { stdoutIsTTY: true, platform: 'linux', env: { DISPLAY: ':0' }, openApp: () => { openedPlain = true; } })).toBe(ExitCode.Success);
        expect(openedPlain).toBe(true);
        const outside = path.join(temp, 'outside');
        fs.mkdirSync(outside);
        const errors: string[] = [];
        expect(await runCli([outside], { stdoutIsTTY: true, platform: 'linux', env: { DISPLAY: ':0' }, stderr: (text) => errors.push(text), openApp: () => undefined })).toBe(ExitCode.InvalidUsage);
        expect(errors).toEqual([`${outside} isn't inside a git repository.`]);
      } finally {
        fs.rmSync(temp, { recursive: true, force: true });
      }
    });

    it('prints a no-display status when the core is available and exit 3 otherwise', async () => {
      const { services, dispose } = createFakeServices();
      try {
        const output: string[] = [];
        const code = await runCli([], { services, stdoutIsTTY: true, platform: 'linux', env: {}, stdout: (text) => output.push(text), openApp: () => undefined });
        expect(code).toBe(ExitCode.Success);
        expect(output[0]).toContain('Engine: ready');
        expect(output[0]).toContain('Usable accounts:');
        expect(output[0]).toContain('Running jobs:');
        expect(output[0]).toContain('Run orch --help for all commands.');
        const errors: string[] = [];
        // An empty home: no core socket there, whatever runs on this machine (never the real ~/.orch).
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-cli-'));
        expect(await runCli([], { home, stdoutIsTTY: true, platform: 'linux', env: {}, stderr: (text) => errors.push(text), openApp: () => undefined })).toBe(ExitCode.EngineUnavailable);
        expect(errors).toEqual(['No display found. Start orch without a window with: orch serve']);
      } finally {
        dispose();
      }
    });

    it('formats the injected app and engine versions exactly', async () => {
      const output: string[] = [];
      expect(await runCli(['--version'], { stdout: (text) => output.push(text), appVersion: '2.3.4', engineVersion: '7.5.6' })).toBe(ExitCode.Success);
      expect(output).toEqual(['orch 2.3.4 · engine 7.5.6']);
    });
  });

  it('orch accounts lists accounts in formatted table', async () => {
    const { services, dispose } = createFakeServices();
    try {
      const output: string[] = [];
      const code = await runCli(['accounts'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.Success);
      expect(output).toMatchSnapshot();
      expect(output.join('\n')).toContain('claude@personal');
      expect(output.join('\n')).toContain('available');
    } finally {
      dispose();
    }
  });

  it('orch accounts add <agent> "<name>" verifies account and prints status', async () => {
    const { services, dispose } = createFakeServices();
    try {
      const output: string[] = [];
      const code = await runCli(['accounts', 'add', 'codex', 'Client'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.Success);
      expect(output).toMatchSnapshot();
      expect(output.join('\n')).toContain('✓ Signed in as n•••@client.com');
      expect(output.join('\n')).toContain('✓ Kept separate: in its own private folder.');
      expect(output.join('\n')).toContain('✓ Ready: usage tracking is on and orch can route work to it.');
    } finally {
      dispose();
    }
  });

  it('orch doctor runs diagnostics and reports passing checks', async () => {
    const { services, dispose } = createFakeServices();
    try {
      const output: string[] = [];
      const code = await runCli(['doctor'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.Success);
      expect(output).toMatchSnapshot();
      expect(output.join('\n')).toContain('✓ agent installed and version in tested range');
      expect(output.join('\n')).toContain('✓ engine ping');
    } finally {
      dispose();
    }
  });

  it('orch doctor returns exit code 1 when check fails', async () => {
    const [transportA, transportB] = createInProcessTransportPair();
    const server = new ChannelServer();
    server.handleConnection(transportA);
    server.registerService('doctor', {
      run: async () =>
        ok({
          os: 'macos',
          orchVersion: '1.0.0',
          engineVersion: '7.5.6',
          checks: [
            { id: 'engine_ping', title: 'engine ping', status: 'fail', fix: 'Start the engine host process.' },
          ],
        }),
    });
    const client = new ChannelClient(transportB);
    const services = createServicesFromClient(client);

    try {
      const output: string[] = [];
      const code = await runCli(['doctor'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.ProblemFound);
      expect(output.join('\n')).toContain('✗ engine ping');
      expect(output.join('\n')).toContain('Fix: Start the engine host process.');
    } finally {
      client.dispose();
      server.dispose();
      transportA.close();
      transportB.close();
    }
  });

  it('orch run starts a single-mode job with checks', async () => {
    const { services, dispose } = createFakeServices();
    try {
      const output: string[] = [];
      const code = await runCli(
        ['run', 'fix the failing test', '--check', 'npm test', '--orchestrator', 'claude@personal'],
        {
          services,
          stdout: (msg) => output.push(msg),
        },
      );

      expect(code).toBe(ExitCode.Success);
      expect(output).toMatchSnapshot();
      expect(output.join('\n')).toContain('✓ started job j-01 · fix the failing test');
    } finally {
      dispose();
    }
  });

  it('round-trips command, web and file-rule checks through the displayed CLI line', async () => {
    const original: JobSpec = {
      mode: 'single',
      goal: 'ship the endpoint',
      repoPath: '/repo',
      orchestrator: { agent: 'claude', account: 'auto' },
      workers: ['claude'],
      checks: [
        { kind: 'command', run: 'npm test' },
        { kind: 'http', url: 'http://localhost:3000/health', expectStatus: 200 },
        { kind: 'file_rule', allow: ['src/**', 'test files/**'] },
      ],
      onLimit: 'switch-account',
    };
    // Matches jobSpecToCommand's formatted output, asserted in the platform formatter tests.
    const cliLine = 'orch run "ship the endpoint" --check "npm test" --web-check "http://localhost:3000/health" --allow "src/**" --allow "test files/**" --orchestrator claude';
    const args = [...cliLine.matchAll(/"(?:\\.|[^"\\])*"|\S+/g)].map(([token]) =>
      token.startsWith('"') ? JSON.parse(token) as string : token,
    );
    const received: JobSpec[] = [];
    const { services, dispose } = createFakeServices((spec) => received.push(spec));
    try {
      const code = await runCli(args.slice(1), { services, stdout: () => undefined });
      expect(code).toBe(ExitCode.Success);
      expect(received[0]?.checks).toEqual(original.checks);
    } finally {
      dispose();
    }
  });

  it('orch ps lists active runs with status and worktree', async () => {
    const { services, dispose } = createFakeServices();
    try {
      const output: string[] = [];
      const code = await runCli(['ps'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.Success);
      expect(output).toMatchSnapshot();
      expect(output.join('\n')).toContain('r-01');
      expect(output.join('\n')).toContain('main (ro)');
      expect(output.join('\n')).toContain('paused·limit');
    } finally {
      dispose();
    }
  });

  it('orch limits shows quota windows and usage percentages', async () => {
    const { services, dispose } = createFakeServices();
    try {
      const output: string[] = [];
      const code = await runCli(['limits'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.Success);
      expect(output).toMatchSnapshot();
      expect(output.join('\n')).toContain('claude@personal');
      expect(output.join('\n')).toContain('62%');
      expect(output.join('\n')).toContain('17:30');
    } finally {
      dispose();
    }
  });

  it('orch sessions --resumable matches artboard text', async () => {
    const { services, dispose } = createFakeServices();
    try {
      const output: string[] = [];
      const code = await runCli(['sessions', '--resumable'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.Success);
      expect(output).toMatchSnapshot();
      expect(output.join('\n')).toContain('s-91e0');
      expect(output.join('\n')).toContain('codex@personal');
      expect(output.join('\n')).toContain('paused·limit');
    } finally {
      dispose();
    }
  });

  describe('--json flag', () => {
    it('orch accounts --json outputs contract objects', async () => {
      const { services, dispose } = createFakeServices();
      try {
        const output: string[] = [];
        const code = await runCli(['accounts', '--json'], {
          services,
          stdout: (msg) => output.push(msg),
        });

        expect(code).toBe(ExitCode.Success);
        const parsed: unknown = JSON.parse(output.join(''));
        expect(Array.isArray(parsed)).toBe(true);
        expect((parsed as Account[])[0]?.id).toBe('claude-personal');
      } finally {
        dispose();
      }
    });

    it('orch doctor --sign-in-twice asks the service to run the isolation checks', async () => {
    const [transportA, transportB] = createInProcessTransportPair();
    const server = new ChannelServer();
    server.handleConnection(transportA);
    const requests: unknown[] = [];
    server.registerService('doctor', {
      run: async (req?: unknown) => {
        requests.push(req);
        return ok({ os: 'macos', orchVersion: '1.0.0', engineVersion: '7.5.6', checks: [] });
      },
    });
    const client = new ChannelClient(transportB);
    const services = createServicesFromClient(client);

    try {
      await runCli(['doctor', '--sign-in-twice'], { services, stdout: () => undefined });
      await runCli(['doctor'], { services, stdout: () => undefined });

      // Without the flag the request carries no signInTwice, so the isolation checks stay off.
      expect(requests).toHaveLength(2);
      expect(requests[0]).toEqual({ signInTwice: true });
      expect((requests[1] as { signInTwice?: boolean } | undefined)?.signInTwice).toBeUndefined();
    } finally {
      client.dispose();
      server.dispose();
      transportA.close();
    }
  });

  it('orch doctor --json outputs contract report', async () => {
      const { services, dispose } = createFakeServices();
      try {
        const output: string[] = [];
        const code = await runCli(['doctor', '--json'], {
          services,
          stdout: (msg) => output.push(msg),
        });

        expect(code).toBe(ExitCode.Success);
        const parsed: unknown = JSON.parse(output.join(''));
        expect((parsed as DoctorReport).orchVersion).toBe('1.0.0');
      } finally {
        dispose();
      }
    });

    it('orch run --json outputs contract job', async () => {
      const { services, dispose } = createFakeServices();
      try {
        const output: string[] = [];
        const code = await runCli(['run', 'fix failing test', '--json'], {
          services,
          stdout: (msg) => output.push(msg),
        });

        expect(code).toBe(ExitCode.Success);
        const parsed: unknown = JSON.parse(output.join(''));
        expect((parsed as Job).id).toBe('j-01');
      } finally {
        dispose();
      }
    });

    it('orch ps --json outputs contract runs array', async () => {
      const { services, dispose } = createFakeServices();
      try {
        const output: string[] = [];
        const code = await runCli(['ps', '--json'], {
          services,
          stdout: (msg) => output.push(msg),
        });

        expect(code).toBe(ExitCode.Success);
        const parsed: unknown = JSON.parse(output.join(''));
        expect(Array.isArray(parsed)).toBe(true);
        expect((parsed as Run[])[0]?.id).toBe('r-01');
      } finally {
        dispose();
      }
    });

    it('orch limits --json outputs contract quota windows array', async () => {
      const { services, dispose } = createFakeServices();
      try {
        const output: string[] = [];
        const code = await runCli(['limits', '--json'], {
          services,
          stdout: (msg) => output.push(msg),
        });

        expect(code).toBe(ExitCode.Success);
        const parsed: unknown = JSON.parse(output.join(''));
        expect(Array.isArray(parsed)).toBe(true);
        expect((parsed as QuotaWindow[])[0]?.accountId).toBe('claude-personal');
      } finally {
        dispose();
      }
    });

    it('orch move --json outputs contract run', async () => {
      const { services, dispose } = createFakeServices();
      try {
        const output: string[] = [];
        const code = await runCli(['move', 'r-02', '--to', 'codex@team', '--json'], {
          services,
          stdout: (msg) => output.push(msg),
        });

        expect(code).toBe(ExitCode.Success);
        const parsed = JSON.parse(output.join(''));
        expect(parsed.id).toBe('r-02');
        expect(parsed.accountId).toBe('codex-team');
      } finally {
        dispose();
      }
    });
  });

  describe('orch uninstall (S5-05, CLI-01, SEC-05)', () => {
    it('removes only ~/.orch in the given home and returns success with --yes', async () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-cli-uninstall-'));
      try {
        fs.mkdirSync(path.join(home, '.orch', 'logs'), { recursive: true });
        fs.writeFileSync(path.join(home, '.orch', 'logs', 'app.log'), 'x\n');
        const repo = path.join(home, 'repos', 'acme');
        fs.mkdirSync(repo, { recursive: true });
        fs.writeFileSync(path.join(repo, 'README.md'), 'acme\n');

        const output: string[] = [];
        const code = await runCli(['uninstall', '--yes'], { home, stdout: (msg) => output.push(msg) });

        expect(code).toBe(ExitCode.Success);
        expect(fs.existsSync(path.join(home, '.orch'))).toBe(false);
        expect(fs.existsSync(path.join(repo, 'README.md'))).toBe(true);
        expect(output.join('\n')).toContain('orch uninstalled');
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('returns problem-found for a symlinked ~/.orch', async () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-cli-uninstall-'));
      try {
        const target = path.join(home, 'elsewhere');
        fs.mkdirSync(target, { recursive: true });
        fs.symlinkSync(target, path.join(home, '.orch'), 'dir');

        const output: string[] = [];
        const code = await runCli(['uninstall', '--yes'], { home, stdout: (msg) => output.push(msg) });

        expect(code).toBe(ExitCode.ProblemFound);
        expect(fs.lstatSync(path.join(home, '.orch')).isSymbolicLink()).toBe(true);
        // The symlink target is never deleted.
        expect(fs.existsSync(target)).toBe(true);
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });
  });

  describe('orch bug-report (BUG-01, BUG-02, CLI-01)', () => {
    it('creates bundle locally without running core host, exits 0 and prints the full path', async () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-cli-bugreport-'));
      try {
        fs.mkdirSync(path.join(home, '.orch', 'logs'), { recursive: true });
        fs.writeFileSync(path.join(home, '.orch', 'logs', 'test.log'), 'test log content\n');

        const output: string[] = [];
        const stderr: string[] = [];
        const code = await runCli(['bug-report'], {
          home,
          stdout: (msg) => output.push(msg),
          stderr: (msg) => stderr.push(msg),
        });

        expect(code).toBe(ExitCode.Success);
        expect(stderr).toEqual([]);
        expect(output).toHaveLength(1);
        const zipPath = output[0]!;
        expect(fs.existsSync(zipPath)).toBe(true);
        expect(zipPath).toContain(path.join(home, '.orch', 'bug-reports'));
        expect(path.basename(zipPath)).toMatch(/^orch-bug-report-\d{8}-\d{6}\.zip$/);
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('creates bundle in specified --out folder', async () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-cli-bugreport-'));
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-cli-custom-out-'));
      try {
        const output: string[] = [];
        const code = await runCli(['bug-report', '--out', outDir], {
          home,
          stdout: (msg) => output.push(msg),
        });

        expect(code).toBe(ExitCode.Success);
        expect(output).toHaveLength(1);
        const zipPath = output[0]!;
        expect(fs.existsSync(zipPath)).toBe(true);
        expect(zipPath.startsWith(outDir)).toBe(true);
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    });

    it('rejects invalid --out with exit code 2', async () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-cli-bugreport-'));
      const tempFile = path.join(home, 'not-a-folder.txt');
      fs.writeFileSync(tempFile, 'file');
      try {
        const stderr: string[] = [];
        const code = await runCli(['bug-report', '--out', tempFile], {
          home,
          stderr: (msg) => stderr.push(msg),
        });

        expect(code).toBe(ExitCode.InvalidUsage);
        expect(stderr.join(' ')).toContain('not a folder');
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('queries doctor over channel when core host is reachable', async () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-cli-bugreport-'));
      const { services, dispose } = createFakeServices();
      try {
        const output: string[] = [];
        const code = await runCli(['bug-report'], {
          home,
          services,
          stdout: (msg) => output.push(msg),
        });

        expect(code).toBe(ExitCode.Success);
        expect(output).toHaveLength(1);
        expect(fs.existsSync(output[0]!)).toBe(true);
      } finally {
        dispose();
        fs.rmSync(home, { recursive: true, force: true });
      }
    });
  });

  describe('Exit codes (CLI-02)', () => {
    it('reports when this CLI cannot start the headless host', async () => {
      const stderr: string[] = [];
      const code = await runCli(['serve'], { stderr: (msg) => stderr.push(msg) });

      expect(code).toBe(ExitCode.InvalidUsage);
      expect(stderr).toEqual(['Headless serving is unavailable in this orch installation.']);
    });

    it('lets orch serve take the engine agent-binary flags', async () => {
      let served = 0;
      const code = await runCli(['serve', '--claude-bin', '/bin/claude'], {
        serve: async () => {
          served += 1;
          return 0;
        },
      });

      expect(code).toBe(ExitCode.Success);
      expect(served).toBe(1);
    });

    it('returns code 2 on unknown command', async () => {
      const stderr: string[] = [];
      const code = await runCli(['nonexistent-command'], {
        stderr: (msg) => stderr.push(msg),
      });

      expect(code).toBe(ExitCode.InvalidUsage);
    });

    it('returns code 2 when required argument is missing', async () => {
      const stderr: string[] = [];
      const code = await runCli(['run'], {
        stderr: (msg) => stderr.push(msg),
      });

      expect(code).toBe(ExitCode.InvalidUsage);
    });

    it('returns code 2 on invalid agent id for accounts add', async () => {
      const { services, dispose } = createFakeServices();
      try {
        const output: string[] = [];
        const code = await runCli(['accounts', 'add', 'invalid-agent', 'Test'], {
          services,
          stdout: (msg) => output.push(msg),
        });

        expect(code).toBe(ExitCode.InvalidUsage);
      } finally {
        dispose();
      }
    });

    it('returns code 2 on invalid on-limit policy for run', async () => {
      const { services, dispose } = createFakeServices();
      try {
        const output: string[] = [];
        const code = await runCli(['run', 'some goal', '--on-limit', 'invalid-policy'], {
          services,
          stdout: (msg) => output.push(msg),
        });

        expect(code).toBe(ExitCode.InvalidUsage);
      } finally {
        dispose();
      }
    });

    it('returns code 1 when service returns error', async () => {
      const [transportA, transportB] = createInProcessTransportPair();
      const server = new ChannelServer();
      server.handleConnection(transportA);
      server.registerService('accounts', {
        list: async () => err({ code: 'conflict', message: 'Config locked' }),
      });
      const client = new ChannelClient(transportB);
      const services = createServicesFromClient(client);

      try {
        const output: string[] = [];
        const code = await runCli(['accounts'], {
          services,
          stdout: (msg) => output.push(msg),
        });

        expect(code).toBe(ExitCode.ProblemFound);
        expect(output.join('\n')).toContain('Error: Config locked');
      } finally {
        client.dispose();
        server.dispose();
        transportA.close();
        transportB.close();
      }
    });

    it('returns code 3 when engine socket is unavailable', async () => {
      const stderr: string[] = [];
      // Calling a command without passing in-process services tries to connect to nonexistent socket
      // An empty temp home: never read the developer's real ~/.orch.
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-cli-home-'));
      const code = await runCli(['doctor'], {
        stderr: (msg) => stderr.push(msg),
        home,
      });

      expect(code).toBe(ExitCode.EngineUnavailable);
      expect(stderr.join('\n')).toContain('engine/core unavailable');
    });
  });

  describe('Socket client transport (SEC-01)', () => {
    it('returns correct socket path and token path', () => {
      const sock = getDefaultSocketPath();
      const token = getDefaultTokenPath();
      expect(sock).toContain('orch');
      expect(token).toContain('token');
    });

    it('authenticates and connects to local socket server', async () => {
      // Start a real ephemeral TCP/Unix socket server to test the handshake
      const validToken = 'secret-token-123';
      let serverReceivedAuth = false;

      // Test with net.Server on an ephemeral socket path or port
      // On macOS/Linux we can use a temp path
      const tmpSockPath = `/tmp/orch-test-${Date.now()}.sock`;
      const unixServer = net.createServer((socket) => {
        let buffer = '';
        socket.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          const nl = buffer.indexOf('\n');
          if (nl !== -1) {
            const line = buffer.slice(0, nl);
            const msg = JSON.parse(line) as { method: string; params: { token: string }; id: number };
            if (msg.method === 'auth' && msg.params.token === validToken) {
              serverReceivedAuth = true;
              socket.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ok: true } }) + '\n');
            } else {
              socket.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'Auth failed' } }) + '\n');
              socket.destroy();
            }
          }
        });
      });

      await new Promise<void>((resolve) => unixServer.listen(tmpSockPath, () => resolve()));

      try {
        const transport = await createCliSocketTransport({
          socketPath: tmpSockPath,
          token: validToken,
        });

        expect(serverReceivedAuth).toBe(true);
        expect(transport.isClosed).toBe(false);
        transport.close();
        expect(transport.isClosed).toBe(true);
      } finally {
        unixServer.close();
      }
    });

    it('rejects connection when token is invalid', async () => {
      const tmpSockPath = `/tmp/orch-test-invalid-${Date.now()}.sock`;
      const unixServer = net.createServer((socket) => {
        let buffer = '';
        socket.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          const nl = buffer.indexOf('\n');
          if (nl !== -1) {
            socket.destroy();
          }
        });
      });

      await new Promise<void>((resolve) => unixServer.listen(tmpSockPath, () => resolve()));

      try {
        await expect(
          createCliSocketTransport({
            socketPath: tmpSockPath,
            token: 'wrong-token',
          }),
        ).rejects.toThrow();
      } finally {
        unixServer.close();
      }
    });
  });
});
