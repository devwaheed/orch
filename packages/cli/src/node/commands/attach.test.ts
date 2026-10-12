import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { ok } from '@orchagents/base';
import {
  AccountId,
  Job,
  JobId,
  OrchEvent,
  Run,
  RunId,
  RunLine,
  SessionId,
  Timestamp,
  WorktreeId,
  type IEventsService,
  type IJobsService,
  type IRunsService,
} from '@orchagents/contracts';
import { ExitCode } from '../../common/exitCodes.js';
import { attachCommand, formatAttachHeader, formatRunLineText } from './attach.js';

function runFixture(over: Partial<Run> = {}): Run {
  return {
    id: 'r-02' as RunId,
    jobId: 'j-01' as JobId,
    parentId: null,
    depth: 0,
    role: 'implementer',
    task: 'Implement callback',
    agent: 'claude',
    accountId: 'claude-personal' as AccountId,
    status: 'running',
    worktree: 'orch/r-02' as WorktreeId,
    readOnly: false,
    sessionId: 's-7a1c' as SessionId,
    startedAt: '2026-10-11T12:00:00Z',
    resumesAt: null,
    ...over,
  };
}

function runLineFixture(seq: number, kind: RunLine['kind'], text: string): RunLine {
  return {
    runId: 'r-02' as RunId,
    seq,
    at: '2026-10-11T12:44:10Z' as Timestamp,
    kind,
    text,
  };
}

interface FakeAttachContext {
  jobs: IJobsService;
  runs: IRunsService;
  events: IEventsService;
  emitEvent: (event: OrchEvent) => void;
  sentLines: string[];
}

function fakeContext(options: {
  jobs?: Job[];
  runs?: Run[];
  lines?: RunLine[];
} = {}): FakeAttachContext {
  const emitter = new EventEmitter();
  const sentLines: string[] = [];

  const jobList: Job[] = options.jobs ?? [
    {
      id: 'j-01' as JobId,
      title: 'OAuth flow',
      spec: {
        mode: 'single',
        goal: 'OAuth flow',
        repoPath: '/repo',
        checks: [],
        onLimit: 'switch-account',
        orchestrator: { agent: 'claude', account: 'auto' },
        workers: ['claude'],
      },
      status: 'running',
      step: null,
      createdAt: '2026-10-11T12:00:00Z',
      scheduledFor: null,
    },
  ];

  const runList: Run[] = options.runs ?? [runFixture()];
  const lineList: RunLine[] = options.lines ?? [];

  return {
    sentLines,
    emitEvent: (event: OrchEvent) => emitter.emit('event', event),
    jobs: {
      list: async () => ok(jobList),
      get: async (id) => ok(jobList.find((j) => j.id === id)!),
      start: async () => ok(jobList[0]!),
      cancel: async () => ok(undefined),
      toCommand: async () => ok(''),
      approvePlan: async () => ok(undefined),
      rejectPlan: async () => ok(undefined),
    },
    runs: {
      list: async () => ok(runList),
      lines: async () => ok(lineList),
      send: async (_id, text) => {
        sentLines.push(text);
        return ok(undefined);
      },
      pause: async () => ok(undefined),
      stop: async () => {
        throw new Error('stop should never be called when detaching');
      },
      startNow: async () => ok(undefined),
      resumeOn: async () => ok(runList[0]!),
      setAutoResume: async () => ok(undefined),
    },
    events: {
      subscribe: (listener) => {
        emitter.on('event', listener);
        return () => emitter.off('event', listener);
      },
    },
  };
}

describe('attachCommand', () => {
  it('formats header correctly matching the design prototype', () => {
    const run = runFixture();
    expect(formatAttachHeader(run)).toBe('# session s-7a1c · claude@personal · orch/r-02');
  });

  it('formats line glyphs according to kind', () => {
    expect(formatRunLineText(runLineFixture(1, 'tool', 'Bash npm test -- auth'))).toBe('⏺ Bash npm test -- auth');
    expect(formatRunLineText(runLineFixture(2, 'ok', '14 passed · 0 failed'))).toBe('✓ 14 passed · 0 failed');
    expect(formatRunLineText(runLineFixture(3, 'prompt', 'also handle the GitHub provider'))).toBe('› also handle the GitHub provider');
    expect(formatRunLineText(runLineFixture(4, 'message', 'On it.'))).toBe('On it.');
  });

  it('catches up lines, streams live event, and detaches cleanly on Ctrl-] (0x1d) without stopping run', async () => {
    const ctx = fakeContext({
      lines: [
        runLineFixture(0, 'tool', 'Bash npm test -- auth'),
        runLineFixture(1, 'ok', '14 passed · 0 failed'),
      ],
    });

    const output: string[] = [];
    const stdin = new PassThrough();

    let onReadyResolve: () => void;
    const readyPromise = new Promise<void>((r) => {
      onReadyResolve = r;
    });

    const attachPromise = attachCommand(
      {
        jobs: ctx.jobs,
        runs: ctx.runs,
        events: ctx.events,
      },
      'r-02',
      {},
      (msg) => output.push(msg),
      { stdin, onReady: () => onReadyResolve() },
    );

    await readyPromise;

    // Verify initial catchup lines were output
    expect(output).toEqual([
      '# session s-7a1c · claude@personal · orch/r-02',
      '⏺ Bash npm test -- auth',
      '✓ 14 passed · 0 failed',
    ]);

    // Emit live line
    ctx.emitEvent({
      type: 'run.line',
      line: runLineFixture(2, 'message', 'On it. Adding a branch.'),
    });

    expect(output[3]).toBe('On it. Adding a branch.');

    // User types text and presses Enter
    stdin.write(Buffer.from('handle access_denied\n'));
    expect(ctx.sentLines).toEqual(['handle access_denied']);
    // Not echoed locally: the run sends it back as a prompt line (shown once).
    expect(output).toHaveLength(4);

    // Send Ctrl-] (byte 0x1d)
    stdin.write(Buffer.from([0x1d]));

    const exitCode = await attachPromise;
    expect(exitCode).toBe(ExitCode.Success);
  });

  it('exits cleanly with 0 when the run completes', async () => {
    const ctx = fakeContext();
    const output: string[] = [];
    const stdin = new PassThrough();

    let onReadyResolve: () => void;
    const readyPromise = new Promise<void>((r) => {
      onReadyResolve = r;
    });

    const attachPromise = attachCommand(
      {
        jobs: ctx.jobs,
        runs: ctx.runs,
        events: ctx.events,
      },
      'r-02',
      {},
      (msg) => output.push(msg),
      { stdin, onReady: () => onReadyResolve() },
    );

    await readyPromise;

    // Emit run finished
    ctx.emitEvent({
      type: 'run.changed',
      run: runFixture({ status: 'done' }),
    });

    const exitCode = await attachPromise;
    expect(exitCode).toBe(ExitCode.Success);
  });

  it('outputs raw JSON line objects when --json is provided', async () => {
    const ctx = fakeContext({
      lines: [runLineFixture(0, 'tool', 'npm test')],
    });
    const output: string[] = [];
    const stdin = new PassThrough();

    let onReadyResolve: () => void;
    const readyPromise = new Promise<void>((r) => {
      onReadyResolve = r;
    });

    const attachPromise = attachCommand(
      {
        jobs: ctx.jobs,
        runs: ctx.runs,
        events: ctx.events,
      },
      'r-02',
      { json: true },
      (msg) => output.push(msg),
      { stdin, onReady: () => onReadyResolve() },
    );

    await readyPromise;

    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0]!)).toMatchObject({ runId: 'r-02', seq: 0, text: 'npm test' });

    stdin.write(Buffer.from([0x1d]));
    const exitCode = await attachPromise;
    expect(exitCode).toBe(ExitCode.Success);
  });

  it('exits 2 when run is unknown', async () => {
    const ctx = fakeContext();
    const output: string[] = [];

    const exitCode = await attachCommand(
      {
        jobs: ctx.jobs,
        runs: ctx.runs,
        events: ctx.events,
      },
      'r-99',
      {},
      (msg) => output.push(msg),
    );

    expect(exitCode).toBe(ExitCode.InvalidUsage);
    expect(output[0]).toContain('Run r-99 was not found');
  });

  it('exits 2 when run id is invalid syntax', async () => {
    const ctx = fakeContext();
    const output: string[] = [];

    const exitCode = await attachCommand(
      {
        jobs: ctx.jobs,
        runs: ctx.runs,
        events: ctx.events,
      },
      'invalid-id',
      {},
      (msg) => output.push(msg),
    );

    expect(exitCode).toBe(ExitCode.InvalidUsage);
    expect(output[0]).toContain('invalid-id is not a run id');
  });
});
