import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok } from '@orchagents/base';
import type {
  AccountId,
  AgentId,
  ISpecsService,
  QueueId,
  ShellId,
  SpecFile,
  SpecId,
  SpecLoadProblem,
  SpecQueue,
  SpecQueueSettings,
  SpecRun,
  SpecState,
  Timestamp,
} from '@orchagents/contracts';
import { ChannelClient } from '@orchagents/platform/src/channels/common/client.js';
import { createInProcessTransportPair } from '@orchagents/platform/src/channels/common/inProcess.js';
import { ChannelServer } from '@orchagents/platform/src/channels/common/server.js';
import { describe, expect, it } from 'vitest';
import { ExitCode } from '../../common/exitCodes.js';
import { runCli } from '../cli.js';
import { createServicesFromClient, type CliServices } from '../client.js';

function createSampleSpecQueue(): SpecQueue {
  const settings: SpecQueueSettings = {
    source: 'docs/specs',
    order: 'waves',
    advance: 'verified',
    on_fail: 'retry-stop',
    max_parallel: 2,
    retries: 2,
    after_each: [],
  };

  const createSpec = (
    id: string,
    title: string,
    state: SpecState,
    position: number,
    opts: {
      dependsOn?: string[];
      attempt?: number | null;
      blockedBy?: string[];
      implementerAgent?: string;
      auditorAgent?: string;
    } = {},
  ): SpecRun => {
    const specFile: SpecFile = {
      id,
      title,
      depends_on: opts.dependsOn ?? [],
      scope: ['src/**'],
      done_when: [{ by: 'audit', text: 'Criteria met' }],
      agent: 'auto',
      mode: 'single',
      agents: [],
    };

    return {
      id: id as SpecId,
      queueId: 'q-demo1' as QueueId,
      position,
      file: `docs/specs/${id}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`,
      spec: specFile,
      state,
      attempt: opts.attempt ?? (state === 'queued' ? null : 1),
      jobId: null,
      worktree: null,
      implementer: opts.implementerAgent
        ? {
            agent: opts.implementerAgent as AgentId,
            accountId: `${opts.implementerAgent}-primary` as AccountId,
          }
        : null,
      criteria: opts.auditorAgent
        ? [
            {
              index: 0,
              state: 'running',
              summary: null,
              auditor: {
                agent: opts.auditorAgent as AgentId,
                accountId: `${opts.auditorAgent}-primary` as AccountId,
                sameAgent: false,
              },
            },
          ]
        : [],
      blockedBy: (opts.blockedBy ?? []) as SpecId[],
      startedAt: '2026-10-11T12:00:00Z' as Timestamp,
      finishedAt: null,
      tokens: 1500,
      history: [],
    };
  };

  const specs: SpecRun[] = [
    createSpec('38', 'Core architecture', 'merged', 1, { dependsOn: [] }),
    createSpec('39', 'Authentication flow', 'needs_you', 2, { attempt: 3 }),
    createSpec('40', 'Token verification', 'verified', 3, { dependsOn: ['38'] }),
    createSpec('41', 'Session service', 'running', 4, {
      dependsOn: ['40'],
      attempt: 1,
      implementerAgent: 'claude',
    }),
    createSpec('42', 'Integration tests', 'queued', 5, { dependsOn: ['41'] }),
    createSpec('43', 'Metrics collector', 'queued', 6, { dependsOn: [] }),
    createSpec('44', 'Blocked feature', 'blocked', 7, { blockedBy: ['39'] }),
    createSpec('45', 'Waiting quota feature', 'waiting_quota', 8, { implementerAgent: 'codex' }),
    createSpec('46', 'Check verification', 'verifying', 9, { attempt: 2 }),
    createSpec('47', 'Auditing feature', 'auditing', 10, { attempt: 1, auditorAgent: 'codex' }),
    createSpec('48', 'Approved feature', 'approved', 11, { dependsOn: ['40'] }),
    createSpec('49', 'Skipped feature', 'skipped', 12, { attempt: 2 }),
    createSpec('50', 'Cancelled feature', 'cancelled', 13),
  ];

  return {
    id: 'q-demo1' as QueueId,
    repoPath: '/repo',
    settings,
    paused: false,
    specs,
    createdAt: '2026-10-11T10:00:00Z' as Timestamp,
  };
}

function createFakeSpecsService(overrides: Partial<ISpecsService> = {}): {
  services: CliServices;
  server: ChannelServer;
  dispose: () => void;
  mockQueue: SpecQueue;
} {
  const [transportA, transportB] = createInProcessTransportPair();
  const server = new ChannelServer();
  server.handleConnection(transportA);

  const mockQueue = createSampleSpecQueue();

  const fakeSpecsService: ISpecsService = {
    init: async () =>
      ok({
        added: [
          {
            file: 'docs/stories/001-login.md',
            id: '1',
            title: 'Login story',
            criteriaCount: 3,
          },
          {
            file: 'docs/stories/002-profile.md',
            id: '2',
            title: 'Profile story',
            criteriaCount: 2,
          },
        ],
        skipped: ['003-existing.md'],
      }),
    load: async () => ok({ queue: mockQueue, problems: [], checkPresets: [] }),
    get: async () => ok(mockQueue),
    start: async () => ok(undefined),
    pause: async () => ok(undefined),
    resume: async () => ok(undefined),
    cancel: async () => ok(undefined),
    updateSettings: async (_qid, s) => ok({ ...mockQueue.settings, ...s }),
    move: async () => ok(undefined),
    skip: async () => ok(undefined),
    retry: async () => ok(undefined),
    usage: async () => ok([]),
    factoryStatus: async () => ok(null),
    factoryPipeline: async () => ok(null),
    answerFactoryGate: async () => err({ code: 'internal', message: 'Not built yet.' }),
    initFactoryProduct: async () => err({ code: 'internal', message: 'Not built yet.' }),
    factoryTrail: async () => err({ code: 'internal', message: 'Not built yet.' }),
    productFiles: async () => err({ code: 'internal', message: 'Not built yet.' }),
    readProductFile: async () => err({ code: 'internal', message: 'Not built yet.' }),
    startPipelineRun: async () => err({ code: 'internal', message: 'Not built yet.' }),
    pausePipelineRun: async () => err({ code: 'internal', message: 'Not built yet.' }),
    stopPipelineRun: async () => err({ code: 'internal', message: 'Not built yet.' }),
    pipelineRun: async () => err({ code: 'internal', message: 'Not built yet.' }),
    create: async () => ok(mockQueue.specs[0]!),
    toCommand: async () => ok('orch specs add "New spec"'),
    recheck: async () => ok(mockQueue.specs[0]!),
    openTerminal: async () => ok('sh-test' as ShellId),
    ...overrides,
  };

  server.registerService('specs', fakeSpecsService);

  const client = new ChannelClient(transportB);
  const services = createServicesFromClient(client);

  return {
    services,
    server,
    mockQueue,
    dispose: () => {
      client.dispose();
      server.dispose();
      transportA.close();
      transportB.close();
    },
  };
}

describe('orch specs CLI', () => {
  it('orch specs lists queue in formatted table matching §12 labels word for word', async () => {
    const { services, dispose } = createFakeSpecsService();
    try {
      const output: string[] = [];
      const code = await runCli(['specs'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.Success);
      expect(output).toMatchSnapshot();
      const combined = output.join('\n');
      expect(combined).toContain('SPEC');
      expect(combined).toContain('TITLE');
      expect(combined).toContain('STATUS');
      expect(combined).toContain('DETAIL');
      expect(combined).toContain('Waiting for 41');
      expect(combined).toContain('Starts automatically when 41 is verified');
      expect(combined).toContain('Next in line');
      expect(combined).toContain('Blocked by 39');
      expect(combined).toContain('Waiting for an account');
      expect(combined).toContain('Running · try 1');
      expect(combined).toContain('Step 1 of 3 · implement');
      expect(combined).toContain('Step 2 of 3 · checks');
      expect(combined).toContain('Step 3 of 3 · audit by codex');
      expect(combined).toContain('Verified · your review');
      expect(combined).toContain('Ready in Review');
      expect(combined).toContain('Verified · approved');
      expect(combined).toContain('Verified · merged');
      expect(combined).toContain('Stopped · 3 tries');
      expect(combined).toContain('Queue paused here: needs you');
      expect(combined).toContain('Skipped · 2 tries');
      expect(combined).toContain('Cancelled');
    } finally {
      dispose();
    }
  });

  it('orch specs --json outputs contract objects', async () => {
    const { services, dispose, mockQueue } = createFakeSpecsService();
    try {
      const output: string[] = [];
      const code = await runCli(['specs', '--json'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.Success);
      expect(output).toHaveLength(1);
      const parsed = JSON.parse(output[0]!);
      expect(parsed).toEqual(mockQueue.specs);
      expect(output).toMatchSnapshot();
    } finally {
      dispose();
    }
  });

  it('orch specs reports empty queue when no specs exist', async () => {
    const emptyQueue = createSampleSpecQueue();
    emptyQueue.specs = [];
    const { services, dispose } = createFakeSpecsService({
      load: async () => ok({ queue: emptyQueue, problems: [], checkPresets: [] }),
    });
    try {
      const output: string[] = [];
      const code = await runCli(['specs'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.Success);
      expect(output).toEqual(['No specs in queue.']);
      expect(output).toMatchSnapshot();
    } finally {
      dispose();
    }
  });

  it('orch specs prints load problems and exits with code 1 when problems exist', async () => {
    const problems: SpecLoadProblem[] = [
      {
        file: 'docs/specs/042-test.md',
        code: 'unknown_dependency',
        message: "Spec 42 depends on 99, which doesn't exist.",
      },
    ];
    const { services, dispose } = createFakeSpecsService({
      load: async () => ok({ queue: null, problems, checkPresets: [] }),
    });
    try {
      const output: string[] = [];
      const code = await runCli(['specs'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.ProblemFound);
      expect(output).toEqual(["Spec 42 depends on 99, which doesn't exist."]);
      expect(output).toMatchSnapshot();
    } finally {
      dispose();
    }
  });

  it('orch specs check passes with exit code 0 when no problems exist', async () => {
    const { services, dispose } = createFakeSpecsService();
    try {
      const output: string[] = [];
      const code = await runCli(['specs', 'check'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.Success);
      expect(output).toEqual(['✓ No problems found (13 specs).']);
      expect(output).toMatchSnapshot();
    } finally {
      dispose();
    }
  });

  it('orch specs check prints exact §11 messages and exits code 1 when problems found', async () => {
    const problems: SpecLoadProblem[] = [
      {
        file: 'docs/specs/010-a.md',
        code: 'dependency_later_in_order',
        message: 'Spec 10 depends on 20, which comes later. Dependencies must come first.',
      },
      {
        file: 'docs/specs/005-b.md',
        code: 'duplicate_id',
        message: 'Spec 5 is defined in both docs/specs/005-a.md and docs/specs/005-b.md.',
      },
    ];
    const { services, dispose } = createFakeSpecsService({
      load: async () => ok({ queue: null, problems, checkPresets: [] }),
    });
    try {
      const output: string[] = [];
      const code = await runCli(['specs', 'check'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.ProblemFound);
      expect(output).toEqual([
        'Spec 10 depends on 20, which comes later. Dependencies must come first.\nSpec 5 is defined in both docs/specs/005-a.md and docs/specs/005-b.md.',
      ]);
      expect(output).toMatchSnapshot();
    } finally {
      dispose();
    }
  });

  it('orch specs check --json prints contract problems array and exits code 1', async () => {
    const problems: SpecLoadProblem[] = [
      {
        file: 'docs/specs/001-a.md',
        code: 'scope_outside_repo',
        message: 'Spec 1: scope ../outside points outside the repository.',
      },
    ];
    const { services, dispose } = createFakeSpecsService({
      load: async () => ok({ queue: null, problems, checkPresets: [] }),
    });
    try {
      const output: string[] = [];
      const code = await runCli(['specs', 'check', '--json'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.ProblemFound);
      expect(JSON.parse(output[0]!)).toEqual(problems);
      expect(output).toMatchSnapshot();
    } finally {
      dispose();
    }
  });

  it('orch specs init lists what it added and exits with code 0', async () => {
    const { services, dispose } = createFakeSpecsService();
    try {
      const output: string[] = [];
      const code = await runCli(['specs', 'init'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.Success);
      expect(output).toMatchSnapshot();
      expect(output[0]).toContain('Added front matter to 2 stories:');
      expect(output[0]).toContain('docs/stories/001-login.md: spec 1 · Login story (3 criteria)');
    } finally {
      dispose();
    }
  });

  it('orch specs init --json outputs report JSON', async () => {
    const { services, dispose } = createFakeSpecsService();
    try {
      const output: string[] = [];
      const code = await runCli(['specs', 'init', '--json'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.Success);
      expect(output).toMatchSnapshot();
      const parsed = JSON.parse(output[0]!);
      expect(parsed.added).toHaveLength(2);
    } finally {
      dispose();
    }
  });

  it('orch specs init reports no stories needed when added list is empty', async () => {
    const { services, dispose } = createFakeSpecsService({
      init: async () => ok({ added: [], skipped: ['001.md'] }),
    });
    try {
      const output: string[] = [];
      const code = await runCli(['specs', 'init'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.Success);
      expect(output).toEqual(['No stories needed initialization.']);
      expect(output).toMatchSnapshot();
    } finally {
      dispose();
    }
  });

  it('orch specs init passes the repo path to the service', async () => {
    let initRepo = '';
    const { services, dispose } = createFakeSpecsService({
      init: async (repoPath) => {
        initRepo = repoPath;
        return ok({ added: [], skipped: [] });
      },
    });
    try {
      const output: string[] = [];
      const code = await runCli(['specs', 'init'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.Success);
      expect(initRepo).toBe(process.cwd());
      expect(output).toEqual(['No stories needed initialization.']);
    } finally {
      dispose();
    }
  });

  it('orch specs init passes --repo X to the service when the flag follows the subcommand', async () => {
    let initRepo = '';
    const { services, dispose } = createFakeSpecsService({
      init: async (repoPath) => {
        initRepo = repoPath;
        return ok({ added: [], skipped: [] });
      },
    });
    try {
      const output: string[] = [];
      const code = await runCli(['specs', 'init', '--repo', 'X'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.Success);
      expect(initRepo).toBe('X');
    } finally {
      dispose();
    }
  });

  it('orch specs init passes --repo X to the service when the flag precedes the subcommand', async () => {
    let initRepo = '';
    const { services, dispose } = createFakeSpecsService({
      init: async (repoPath) => {
        initRepo = repoPath;
        return ok({ added: [], skipped: [] });
      },
    });
    try {
      const output: string[] = [];
      const code = await runCli(['specs', '--repo', 'X', 'init'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.Success);
      expect(initRepo).toBe('X');
    } finally {
      dispose();
    }
  });

  it('orch specs check passes --repo X to the service when the flag follows the subcommand', async () => {
    let loadRepo = '';
    const { services, dispose } = createFakeSpecsService({
      load: async (repoPath) => {
        loadRepo = repoPath;
        return ok({ queue: null, problems: [], checkPresets: [] });
      },
    });
    try {
      const output: string[] = [];
      const code = await runCli(['specs', 'check', '--repo', 'X'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.Success);
      expect(loadRepo).toBe('X');
    } finally {
      dispose();
    }
  });

  it('orch specs check passes --repo X to the service when the flag precedes the subcommand', async () => {
    let loadRepo = '';
    const { services, dispose } = createFakeSpecsService({
      load: async (repoPath) => {
        loadRepo = repoPath;
        return ok({ queue: null, problems: [], checkPresets: [] });
      },
    });
    try {
      const output: string[] = [];
      const code = await runCli(['specs', '--repo', 'X', 'check'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.Success);
      expect(loadRepo).toBe('X');
    } finally {
      dispose();
    }
  });

  it('orch specs --repo X lists the queue from repo X', async () => {
    let loadRepo = '';
    const { services, dispose } = createFakeSpecsService({
      load: async (repoPath) => {
        loadRepo = repoPath;
        return ok({ queue: null, problems: [], checkPresets: [] });
      },
    });
    try {
      const output: string[] = [];
      const code = await runCli(['specs', '--repo', 'X'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.Success);
      expect(loadRepo).toBe('X');
      expect(output).toEqual(['No spec queue found.']);
    } finally {
      dispose();
    }
  });

  it('orch specs skip <id> passes --repo X to the service when the flag follows the spec id', async () => {
    let loadRepo = '';
    const { services, dispose } = createFakeSpecsService({
      load: async (repoPath) => {
        loadRepo = repoPath;
        return ok({ queue: null, problems: [], checkPresets: [] });
      },
    });
    try {
      const output: string[] = [];
      const code = await runCli(['specs', 'skip', '42', '--repo', 'X'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.ProblemFound);
      expect(loadRepo).toBe('X');
    } finally {
      dispose();
    }
  });

  it('orch specs init prints the service error with its fix', async () => {
    const { services, dispose } = createFakeSpecsService({
      init: async () =>
        err({
          code: 'not_found',
          message: 'BMAD stories directory not found: docs/stories',
          fix: 'Create the directory or specify a valid stories path.',
        }),
    });
    try {
      const output: string[] = [];
      const code = await runCli(['specs', 'init'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.ProblemFound);
      expect(output).toEqual([
        'Error: BMAD stories directory not found: docs/stories\nFix: Create the directory or specify a valid stories path.',
      ]);
    } finally {
      dispose();
    }
  });

  it('orch specs start starts queue execution', async () => {
    let startedQueueId = '';
    const { services, dispose } = createFakeSpecsService({
      start: async (qid) => {
        startedQueueId = qid;
        return ok(undefined);
      },
    });
    try {
      const output: string[] = [];
      const code = await runCli(['specs', 'start'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.Success);
      expect(startedQueueId).toBe('q-demo1');
      expect(output).toEqual(['✓ Spec queue started (q-demo1).']);
      expect(output).toMatchSnapshot();
    } finally {
      dispose();
    }
  });

  it('orch specs start --json outputs status json', async () => {
    const { services, dispose } = createFakeSpecsService();
    try {
      const output: string[] = [];
      const code = await runCli(['specs', 'start', '--json'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.Success);
      expect(output).toMatchSnapshot();
      expect(JSON.parse(output[0]!)).toEqual({
        queueId: 'q-demo1',
        action: 'start',
        status: 'started',
      });
    } finally {
      dispose();
    }
  });

  it('orch specs pause pauses queue execution with §12 note', async () => {
    let pausedQueueId = '';
    const { services, dispose } = createFakeSpecsService({
      pause: async (qid) => {
        pausedQueueId = qid;
        return ok(undefined);
      },
    });
    try {
      const output: string[] = [];
      const code = await runCli(['specs', 'pause'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.Success);
      expect(pausedQueueId).toBe('q-demo1');
      expect(output).toEqual([
        '✓ Spec queue paused (q-demo1). Running specs finish; nothing new starts until you resume.',
      ]);
      expect(output).toMatchSnapshot();
    } finally {
      dispose();
    }
  });

  it('orch specs resume resumes queue execution', async () => {
    let resumedQueueId = '';
    const { services, dispose } = createFakeSpecsService({
      resume: async (qid) => {
        resumedQueueId = qid;
        return ok(undefined);
      },
    });
    try {
      const output: string[] = [];
      const code = await runCli(['specs', 'resume'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.Success);
      expect(resumedQueueId).toBe('q-demo1');
      expect(output).toEqual(['✓ Spec queue resumed (q-demo1).']);
      expect(output).toMatchSnapshot();
    } finally {
      dispose();
    }
  });

  it('orch specs cancel cancels queue execution when supported', async () => {
    let cancelledQueueId = '';
    const { services, dispose } = createFakeSpecsService({
      cancel: async (qid) => {
        cancelledQueueId = qid;
        return ok(undefined);
      },
    });
    try {
      const output: string[] = [];
      const code = await runCli(['specs', 'cancel'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.Success);
      expect(cancelledQueueId).toBe('q-demo1');
      expect(output).toEqual(['✓ Spec queue cancelled (q-demo1).']);
      expect(output).toMatchSnapshot();
    } finally {
      dispose();
    }
  });

  it('orch specs cancel prints the service error with its fix', async () => {
    const { services, dispose } = createFakeSpecsService({
      cancel: async () =>
        err({ code: 'internal', message: 'orch could not cancel the queue.', fix: 'Try again.' }),
    });
    try {
      const output: string[] = [];
      const code = await runCli(['specs', 'cancel'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.ProblemFound);
      expect(output).toEqual(['Error: orch could not cancel the queue.\nFix: Try again.']);
    } finally {
      dispose();
    }
  });

  it('orch specs skip <id> skips a spec', async () => {
    let skippedSpec = '';
    const { services, dispose } = createFakeSpecsService({
      skip: async (_qid, sid) => {
        skippedSpec = sid;
        return ok(undefined);
      },
    });
    try {
      const output: string[] = [];
      const code = await runCli(['specs', 'skip', '42'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.Success);
      expect(skippedSpec).toBe('42');
      expect(output).toEqual(['✓ Spec 42 skipped.']);
      expect(output).toMatchSnapshot();
    } finally {
      dispose();
    }
  });

  it('orch specs skip <invalid-id> rejects invalid id with ExitCode.InvalidUsage', async () => {
    const { services, dispose } = createFakeSpecsService();
    try {
      const output: string[] = [];
      const code = await runCli(['specs', 'skip', 'invalid-spec-id'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.InvalidUsage);
      expect(output).toEqual(["Invalid spec id 'invalid-spec-id'. Spec id must be 1 to 4 digits."]);
      expect(output).toMatchSnapshot();
    } finally {
      dispose();
    }
  });

  it('orch specs retry <id> retries a spec and resets to queued', async () => {
    let retriedSpec = '';
    const { services, dispose } = createFakeSpecsService({
      retry: async (_qid, sid) => {
        retriedSpec = sid;
        return ok(undefined);
      },
    });
    try {
      const output: string[] = [];
      const code = await runCli(['specs', 'retry', '39'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.Success);
      expect(retriedSpec).toBe('39');
      expect(output).toEqual(['✓ Spec 39 retried (reset to queued).']);
      expect(output).toMatchSnapshot();
    } finally {
      dispose();
    }
  });

  it('orch specs retry <invalid-id> rejects invalid id with ExitCode.InvalidUsage', async () => {
    const { services, dispose } = createFakeSpecsService();
    try {
      const output: string[] = [];
      const code = await runCli(['specs', 'retry', 'bad_id'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.InvalidUsage);
      expect(output).toEqual(["Invalid spec id 'bad_id'. Spec id must be 1 to 4 digits."]);
      expect(output).toMatchSnapshot();
    } finally {
      dispose();
    }
  });

  it('orch specs move <id> <position> reorders a spec', async () => {
    let movedId = '';
    let movedPos = 0;
    const { services, dispose } = createFakeSpecsService({
      move: async (_qid, sid, pos) => {
        movedId = sid;
        movedPos = pos;
        return ok(undefined);
      },
    });
    try {
      const output: string[] = [];
      const code = await runCli(['specs', 'move', '43', '2'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.Success);
      expect(movedId).toBe('43');
      expect(movedPos).toBe(2);
      expect(output).toEqual(['✓ Spec 43 moved to position 2.']);
      expect(output).toMatchSnapshot();
    } finally {
      dispose();
    }
  });

  it('orch specs move rejects invalid position with ExitCode.InvalidUsage', async () => {
    const { services, dispose } = createFakeSpecsService();
    try {
      const output: string[] = [];
      const code = await runCli(['specs', 'move', '43', '0'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.InvalidUsage);
      expect(output).toEqual(["Invalid position '0'. Position must be a positive integer."]);
      expect(output).toMatchSnapshot();
    } finally {
      dispose();
    }
  });

  it('orch specs move reports conflict with exact §10 error message from service', async () => {
    const { services, dispose } = createFakeSpecsService({
      move: async () =>
        err({
          code: 'conflict',
          message: "Spec 42 depends on 41, so it can't run before it.",
        }),
    });
    try {
      const output: string[] = [];
      const code = await runCli(['specs', 'move', '42', '1'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.ProblemFound);
      expect(output).toEqual(["Error: Spec 42 depends on 41, so it can't run before it."]);
      expect(output).toMatchSnapshot();
    } finally {
      dispose();
    }
  });

  it('orch specs add --after sends depends_on to the service', async () => {
    let received: unknown = null;
    const { services, dispose } = createFakeSpecsService({
      create: async (_repo, draft) => {
        received = draft;
        return ok(createSampleSpecQueue().specs[0]!);
      },
    });
    try {
      const output: string[] = [];
      const code = await runCli(['specs', 'add', 'New spec', '--after', '7', '--after', '9'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.Success);
      expect(received).toMatchObject({ title: 'New spec', depends_on: ['7', '9'] });
      expect(output).toEqual(['Added spec 38 · Core architecture → docs/specs/38-core-architecture.md']);
    } finally {
      dispose();
    }
  });

  it('orch specs add rejects an invalid --after id', async () => {
    const { services, dispose } = createFakeSpecsService();
    try {
      const output: string[] = [];
      const code = await runCli(['specs', 'add', 'New spec', '--after', 'later'], {
        services,
        stdout: (msg) => output.push(msg),
      });

      expect(code).toBe(ExitCode.InvalidUsage);
      expect(output).toEqual(["Invalid spec id 'later'. Spec id must be 1 to 4 digits."]);
    } finally {
      dispose();
    }
  });

  it('orch specs handles engine unavailable and exits with ExitCode.EngineUnavailable (3)', async () => {
    const errors: string[] = [];
    // An empty temp home: never read the developer's real ~/.orch.
    const home = mkdtempSync(join(tmpdir(), 'orch-cli-home-'));
    const code = await runCli(['specs'], {
      stderr: (msg) => errors.push(msg),
      home,
    });

    expect(code).toBe(ExitCode.EngineUnavailable);
  });
});
