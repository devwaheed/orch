import * as net from 'node:net';
import { ok, err } from '@orch/base';
import type {
  Account,
  AccountId,
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
} from '@orch/contracts';
import { ChannelClient } from '@orch/platform/src/channels/common/client.js';
import { createInProcessTransportPair } from '@orch/platform/src/channels/common/inProcess.js';
import { ChannelServer } from '@orch/platform/src/channels/common/server.js';
import { describe, expect, it } from 'vitest';
import { ExitCode } from '../common/exitCodes.js';
import { runCli } from '../node/cli.js';
import { createServicesFromClient, type CliServices } from '../node/client.js';
import {
  createCliSocketTransport,
  getDefaultSocketPath,
  getDefaultTokenPath,
} from '../node/socketTransport.js';

function createFakeServices(): {
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
    start: async (spec: JobSpec) =>
      ok({
        ...fakeJob,
        title: spec.goal,
        spec,
      }),
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
  });

  describe('Exit codes (CLI-02)', () => {
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
      const code = await runCli(['doctor'], {
        stderr: (msg) => stderr.push(msg),
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
