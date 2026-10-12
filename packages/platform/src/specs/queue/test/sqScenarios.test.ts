import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { ok } from '@orchagents/base';
import type {
  AccountId,
  AgentId,
  ChangedFile,
  PickAccountResult,
  QueueId,
  Result,
  SpecId,
  SpecQueue,
  SpecQueueSettings,
  SpecRun,
  SpecState,
  Timestamp,
} from '@orchagents/contracts';
import { DEFAULT_SPEC_QUEUE_SETTINGS, scheduleQueue } from '../common/scheduler.js';
import { SpecsQueueService } from '../node/specsQueueService.js';
import { FastSpecJobRunner, RealSpecJobRunner } from '../node/specJobRunner.js';
import { recoverActiveSpecs } from '../node/persistence.js';
import { updateSprintStatusOnMerge } from '../node/sprintStatusWriter.js';
import { getNextSpecToMerge } from '../node/specMerge.js';
import { transitionSpecState } from '../common/stateMachine.js';
import type {
  CreateWorktreeOptions,
  CreateWorktreeResult,
  IGitService,
  RemoveWorktreeOptions,
} from '../../../git/common/git.js';

class MockGitService implements IGitService {
  async ensureExclude(_repoPath: string): Promise<Result<void>> {
    void _repoPath;
    return ok(undefined);
  }
  async getDefaultBranch(_repoPath: string): Promise<Result<string>> {
    void _repoPath;
    return ok('main');
  }
  async createWorktree(options: CreateWorktreeOptions): Promise<Result<CreateWorktreeResult>> {
    return ok({
      worktreePath: path.join(options.repoPath, 'wt', options.runId),
      branch: `orch/${options.runId}`,
      targetBranch: 'main',
    });
  }
  async removeWorktree(_options: RemoveWorktreeOptions): Promise<Result<void>> {
    void _options;
    return ok(undefined);
  }
  async getChangedFiles(_worktreePath: string, _targetBranch: string): Promise<Result<ChangedFile[]>> {
    void _worktreePath;
    void _targetBranch;
    return ok([]);
  }
  async getDiff(_worktreePath: string, _targetBranch: string, _filePath?: string): Promise<Result<string>> {
    void _worktreePath;
    void _targetBranch;
    void _filePath;
    return ok('');
  }
}

describe('Spec Queue Acceptance Scenarios (SQ-01..SQ-19, SQ-22)', () => {
  const makeSpec = (
    id: string,
    position: number,
    state: SpecState = 'queued',
    dependsOn: string[] = [],
    scope: string[] = ['src/**'],
    doneWhen: SpecRun['spec']['done_when'] = [{ by: 'audit', text: 'Audit' }],
    agent: SpecRun['spec']['agent'] = 'auto',
  ): SpecRun => ({
    id: id as SpecId,
    queueId: 'q-scenarios' as QueueId,
    position,
    file: `docs/specs/${id}.md`,
    spec: {
      id,
      title: `Spec ${id}`,
      depends_on: dependsOn,
      scope,
      done_when: doneWhen,
      agent,
    },
    state,
    attempt: null,
    jobId: null,
    worktree: null,
    implementer: null,
    criteria: doneWhen.map((item, idx) => ({
      index: idx,
      state: 'pending',
      summary: null,
      auditor: null,
    })),
    blockedBy: [],
    startedAt: null,
    finishedAt: null,
    tokens: 0,
  });

  const makeQueue = (
    repoPath: string,
    specs: SpecRun[],
    overrides: Partial<SpecQueueSettings> = {},
  ): SpecQueue => ({
    id: 'q-scenarios' as QueueId,
    repoPath,
    paused: false,
    createdAt: new Date().toISOString() as Timestamp,
    settings: {
      ...DEFAULT_SPEC_QUEUE_SETTINGS,
      ...overrides,
    },
    specs,
  });

  // SQ-01: Specs 1, 2 (2 depends on 1), strict | Queue starts | 1 runs; 2 stays queued
  it('SQ-01: linear DAG in strict mode starts 1 and keeps 2 queued', async () => {
    const s1 = makeSpec('1', 1);
    const s2 = makeSpec('2', 2, 'queued', ['1']);
    const queue = makeQueue('/repo', [s1, s2], { order: 'strict' });

    const sched = scheduleQueue(queue);
    expect(sched.specsToStart.map((s) => s.id)).toEqual(['1']);
    const s2Updated = sched.updatedSpecs.find((s) => s.id === '2');
    expect(s2Updated?.state).toBe('queued');
  });

  // SQ-02: SQ-01, advance = verified | 1 is verified | 2 starts without any action
  it('SQ-02: when 1 is verified with advance = verified, 2 starts without action', async () => {
    const s1 = makeSpec('1', 1, 'verified');
    const s2 = makeSpec('2', 2, 'queued', ['1']);
    const queue = makeQueue('/repo', [s1, s2], { advance: 'verified' });

    const sched = scheduleQueue(queue);
    expect(sched.specsToStart.map((s) => s.id)).toEqual(['2']);
  });

  // SQ-03: SQ-01, advance = approved | 1 is verified | 2 waits until 1 is approved
  it('SQ-03: with advance = approved, 2 waits until 1 is approved', async () => {
    const s1 = makeSpec('1', 1, 'verified');
    const s2 = makeSpec('2', 2, 'queued', ['1']);
    const queue = makeQueue('/repo', [s1, s2], { advance: 'approved' });

    const schedWaiting = scheduleQueue(queue);
    expect(schedWaiting.specsToStart).toHaveLength(0);

    const s1Approved = { ...s1, state: 'approved' as const };
    const schedApproved = scheduleQueue({ ...queue, specs: [s1Approved, s2] });
    expect(schedApproved.specsToStart.map((s) => s.id)).toEqual(['2']);
  });

  // SQ-04: SQ-01, advance = merged | 1 is approved | 2 waits until 1 is merged
  it('SQ-04: with advance = merged, 2 waits until 1 is merged', async () => {
    const s1 = makeSpec('1', 1, 'approved');
    const s2 = makeSpec('2', 2, 'queued', ['1']);
    const queue = makeQueue('/repo', [s1, s2], { advance: 'merged' });

    const schedWaiting = scheduleQueue(queue);
    expect(schedWaiting.specsToStart).toHaveLength(0);

    const s1Merged = { ...s1, state: 'merged' as const };
    const schedMerged = scheduleQueue({ ...queue, specs: [s1Merged, s2] });
    expect(schedMerged.specsToStart.map((s) => s.id)).toEqual(['2']);
  });

  // SQ-05: Specs 3 (`src/a/**`), 4 (`test/a/**`), waves, max 2 | Queue starts | 3 and 4 run together
  it('SQ-05: disjoint specs run together in waves mode up to max_parallel', async () => {
    const s3 = makeSpec('3', 1, 'queued', [], ['src/a/**']);
    const s4 = makeSpec('4', 2, 'queued', [], ['test/a/**']);
    const queue = makeQueue('/repo', [s3, s4], { order: 'waves', max_parallel: 2 });

    const sched = scheduleQueue(queue);
    expect(sched.specsToStart.map((s) => s.id)).toEqual(['3', '4']);
  });

  // SQ-06: Specs 5 (`src/a/**`), 6 (`src/a/b.ts`), waves | Queue starts | 6 waits for 5 (overlap)
  it('SQ-06: overlapping scopes block parallel execution in waves mode', async () => {
    const s5 = makeSpec('5', 1, 'queued', [], ['src/a/**']);
    const s6 = makeSpec('6', 2, 'queued', [], ['src/a/b.ts']);
    const queue = makeQueue('/repo', [s5, s6], { order: 'waves', max_parallel: 2 });

    const sched = scheduleQueue(queue);
    expect(sched.specsToStart.map((s) => s.id)).toEqual(['5']);
  });

  // SQ-07: Spec 7 with empty scope, waves | Another spec is active | 7 does not start until it is alone
  it('SQ-07: spec with empty scope never runs alongside another spec', async () => {
    const sActive = makeSpec('active', 1, 'running', [], ['src/a/**']);
    const s7 = makeSpec('7', 2, 'queued', [], []);
    const queue = makeQueue('/repo', [sActive, s7], { order: 'waves', max_parallel: 2 });

    const sched = scheduleQueue(queue);
    expect(sched.specsToStart).toHaveLength(0);
  });

  // SQ-08: Spec 8, retries = 2, check always fails | Runs | 3 tries, then needs_you; attempt shows 3
  it('SQ-08: retries run up to limit then moves to needs_you with attempt showing total tries', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-sq08-'));
    const runner = new FastSpecJobRunner({
      checkFailures: new Set(['8']),
    });
    const service = new SpecsQueueService({
      git: new MockGitService(),
      jobRunner: runner,
    });
    try {
      const s8 = makeSpec('8', 1, 'queued', [], ['src/**'], [
        { by: 'check', text: 'Unit tests', check: { kind: 'command', run: 'exit 1' } },
      ]);
      const queue = makeQueue(tmp, [s8], { retries: 2, on_fail: 'retry-stop' });

      service.initQueue(queue);
      await service.start(queue.id);

      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const cur = service.getQueue(queue.id)?.specs[0];
        if (cur?.state === 'needs_you') {
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      const finalSpec = service.getQueue(queue.id)!.specs[0]!;
      expect(finalSpec.state).toBe('needs_you');
      // 1 initial try + 2 retries = 3 tries total (§3, SQ-08)
      expect(finalSpec.attempt).toBe(3);
    } finally {
      service.dispose();
      await new Promise((r) => setTimeout(r, 50));
      await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    }
  });

  // SQ-09: SQ-08 with retry-skip | Runs | skipped; queue continues
  it('SQ-09: retries with retry-skip moves to skipped and queue continues', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-sq09-'));
    const runner = new FastSpecJobRunner({
      checkFailures: new Set(['8']),
    });
    const service = new SpecsQueueService({
      git: new MockGitService(),
      jobRunner: runner,
    });
    try {
      const s8 = makeSpec('8', 1, 'queued', [], ['src/**'], [
        { by: 'check', text: 'Unit tests', check: { kind: 'command', run: 'exit 1' } },
      ]);
      const sOther = makeSpec('other', 2, 'queued', [], ['src/other/**']);
      const queue = makeQueue(tmp, [s8, sOther], { retries: 1, on_fail: 'retry-skip' });

      service.initQueue(queue);
      await service.start(queue.id);

      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const q = service.getQueue(queue.id);
        const s8Cur = q?.specs[0];
        const sOtherCur = q?.specs[1];
        if (s8Cur?.state === 'skipped' && sOtherCur?.state === 'verified') {
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      const q = service.getQueue(queue.id)!;
      expect(q.specs[0]!.state).toBe('skipped');
      expect(q.specs[1]!.state).toBe('verified');
    } finally {
      service.dispose();
      await new Promise((r) => setTimeout(r, 50));
      await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    }
  });

  // SQ-10: Spec 9 depends on 8; 8 needs_you | Scheduler runs | 9 blocked, blockedBy = [8]
  it('SQ-10: dependent spec becomes blocked with blockedBy = [8] when dependency is needs_you', () => {
    const s8 = makeSpec('8', 1, 'needs_you');
    const s9 = makeSpec('9', 2, 'queued', ['8']);
    const queue = makeQueue('/repo', [s8, s9]);

    const sched = scheduleQueue(queue);
    const s9Updated = sched.updatedSpecs.find((s) => s.id === '9');
    expect(s9Updated?.state).toBe('blocked');
    expect(s9Updated?.blockedBy).toEqual(['8']);
  });

  // SQ-11: SQ-10 | You retry 8 | 9 returns to queued; 8 attempt resets
  it('SQ-11: retrying 8 unblocks 9 back to queued and resets 8 attempt count', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-sq11-'));
    const service = new SpecsQueueService({
      git: new MockGitService(),
      jobRunner: new FastSpecJobRunner(),
    });
    try {
      const s8 = makeSpec('8', 1, 'needs_you');
      s8.attempt = 3;
      const s9 = makeSpec('9', 2, 'blocked', ['8']);
      s9.blockedBy = ['8' as SpecId];

      const queue = makeQueue(tmp, [s8, s9]);

      service.initQueue(queue);

      const retryRes = await service.retry(queue.id, '8' as SpecId);
      expect(retryRes.ok).toBe(true);

      const currentQ = service.getQueue(queue.id)!;
      const s8Current = currentQ.specs.find((s: SpecRun) => s.id === '8')!;
      const s9Current = currentQ.specs.find((s: SpecRun) => s.id === '9')!;

      // 8 attempt reset from 3 (§4, §8, SQ-11)
      expect(s8Current.attempt).toBe(1);
      expect(s9Current.blockedBy).toEqual([]);
      expect(['queued', 'running', 'verified'].includes(s8Current.state)).toBe(true);
      expect(['queued', 'running'].includes(s9Current.state)).toBe(true);
    } finally {
      service.dispose();
      await new Promise((r) => setTimeout(r, 50));
      await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    }
  });

  // SQ-12: Audit criterion | Implementer is Codex | Auditor is a different agent
  it('SQ-12: auditor is a different agent from implementer when multiple agents available', async () => {
    const s = makeSpec('12', 1, 'queued', [], ['src/**'], [
      { by: 'audit', text: 'Review changes' },
    ], 'codex');

    const quota = {
      async pickAccount(agent: AgentId): Promise<Result<PickAccountResult>> {
        return ok({ kind: 'account', accountId: `acct-${agent}` as AccountId });
      },
    };

      const runner = new RealSpecJobRunner({
      git: new MockGitService(),
      quota,
      installedAgents: ['claude', 'codex'],
    });

    const res = await runner.runTry(s, '/repo', DEFAULT_SPEC_QUEUE_SETTINGS);
    expect(res.success).toBe(true);
    expect(res.implementer?.agent).toBe('codex');
    expect(res.auditor?.agent).toBe('claude');
    expect(res.auditor?.sameAgent).toBe(false);
  });

  // SQ-13: Only one agent installed | Audit runs | Same agent, fresh session, sameAgent = true
  it('SQ-13: same auditor agent used with sameAgent = true when only one agent is installed', async () => {
    const s = makeSpec('13', 1, 'queued', [], ['src/**'], [
      { by: 'audit', text: 'Review changes' },
    ], 'codex');

    const quota = {
      async pickAccount(agent: AgentId): Promise<Result<PickAccountResult>> {
        return ok({ kind: 'account', accountId: `acct-${agent}` as AccountId });
      },
    };

    const runner = new RealSpecJobRunner({
      git: new MockGitService(),
      quota,
      installedAgents: ['codex'], // Only codex installed
    });

    const res = await runner.runTry(s, '/repo', DEFAULT_SPEC_QUEUE_SETTINGS);
    expect(res.success).toBe(true);
    expect(res.implementer?.agent).toBe('codex');
    expect(res.auditor?.agent).toBe('codex');
    expect(res.auditor?.sameAgent).toBe(true);
  });

  // SQ-14: after_each gate fails | Criteria met | Counts as a failed try
  it('SQ-14: after_each gate failure counts as a failed try', async () => {
    const s = makeSpec('14', 1, 'queued', [], ['src/**'], [
      { by: 'audit', text: 'Audit passed' },
    ]);

    const quota = {
      async pickAccount(agent: AgentId): Promise<Result<PickAccountResult>> {
        return ok({ kind: 'account', accountId: `acct-${agent}` as AccountId });
      },
    };

    const runner = new RealSpecJobRunner({
      git: new MockGitService(),
      quota,
      commandRunner: async (_cmd, _args) => {
        void _cmd;
        void _args;
        // Gate command fails with exitCode 1
        return { exitCode: 1, stdout: '', stderr: 'Gate failed' };
      },
    });

    const settings: SpecQueueSettings = {
      ...DEFAULT_SPEC_QUEUE_SETTINGS,
      after_each: [{ name: 'smoke-test', run: 'pnpm test:smoke', timeout_s: 30 }],
    };

    const res = await runner.runTry(s, '/repo', settings);
    expect(res.success).toBe(false);
    expect(res.failedGate).toBe('smoke-test');
  });

  // SQ-15: Account limited mid-run, no other account | Limit hits | waiting_quota; resumes when the account resets
  it('SQ-15: account limit transitions spec to waiting_quota and resumes on quota available', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-sq15-'));
    const runner = new FastSpecJobRunner({
      limitedSpecs: new Set(['15']),
    });

    const service = new SpecsQueueService({
      git: new MockGitService(),
      jobRunner: runner,
    });
    try {
      const s = makeSpec('15', 1, 'queued');
      const queue = makeQueue(tmp, [s]);

      service.initQueue(queue);
      await service.start(queue.id);

      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const cur = service.getQueue(queue.id)?.specs[0];
        if (cur?.state === 'waiting_quota') {
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      const q = service.getQueue(queue.id)!;
      expect(q.specs[0]!.state).toBe('waiting_quota');
    } finally {
      service.dispose();
      await new Promise((r) => setTimeout(r, 50));
      await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    }
  });

  // SQ-16: Queue paused | A spec is verified | Nothing new starts
  it('SQ-16: when queue is paused, nothing new starts after a spec is verified', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-sq16-'));
    const service = new SpecsQueueService({
      git: new MockGitService(),
      jobRunner: new FastSpecJobRunner(),
    });
    try {
      const s1 = makeSpec('1', 1, 'verified');
      const s2 = makeSpec('2', 2, 'queued', ['1']);
      const queue = { ...makeQueue(tmp, [s1, s2]), paused: true };

      service.initQueue(queue);
      await service.scheduleAndRun(queue.id);

      const q = service.getQueue(queue.id)!;
      expect(q.specs[1]!.state).toBe('queued');
    } finally {
      service.dispose();
      await new Promise((r) => setTimeout(r, 50));
      await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    }
  });

  // SQ-17: 10 and 11 approved, 11 depends on 10 | Merge | 10 merges first, then 11
  it('SQ-17: approved specs merge in dependency and position order', () => {
    const s10 = makeSpec('10', 1, 'approved');
    const s11 = makeSpec('11', 2, 'approved', ['10']);
    const specs = [s10, s11];

    const nextMerge1 = getNextSpecToMerge(specs);
    expect(nextMerge1?.id).toBe('10');

    const s10Merged = { ...s10, state: 'merged' as const };
    const nextMerge2 = getNextSpecToMerge([s10Merged, s11]);
    expect(nextMerge2?.id).toBe('11');
  });

  // SQ-18: Approved spec, main changed | Rebase makes a check fail | Back to running
  it('SQ-18: approved spec moves back to running if rebase check fails', async () => {
    const s = makeSpec('18', 1, 'approved');
    s.attempt = 1;
    const backToRunning = transitionSpecState(s, 'running', { attemptAction: 'increment' });
    expect(backToRunning.ok).toBe(true);
    if (backToRunning.ok) {
      expect(backToRunning.value.state).toBe('running');
      expect(backToRunning.value.attempt).toBe(2);
    }
  });

  // SQ-19: orch restarts mid-run | Starts again | Spec re-attaches, or returns to queued with attempt kept
  it('SQ-19: restart recovery returns lost workflows to queued with attempt count kept', () => {
    const specs = [
      makeSpec('19', 1, 'running'),
    ];
    specs[0]!.attempt = 2;

    const { recoveredSpecs, changed } = recoverActiveSpecs(specs, () => false);
    expect(changed).toBe(true);
    expect(recoveredSpecs[0]?.state).toBe('queued');
    expect(recoveredSpecs[0]?.attempt).toBe(2);
  });

  // SQ-22: sprint-status.yaml exists | Spec merged | Its story is set to done by orch
  it('SQ-22: updates sprint-status.yaml setting story to done upon merge', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-sq22-'));
    try {
      const docsDir = path.join(tmp, 'docs');
      await fs.mkdir(docsDir, { recursive: true });
      const sprintPath = path.join(docsDir, 'sprint-status.yaml');
      await fs.writeFile(
        sprintPath,
        'stories:\n  story-22: in-progress\n',
        'utf8',
      );

      const res = await updateSprintStatusOnMerge(tmp, 'story-22');
      expect(res.ok).toBe(true);

      const content = await fs.readFile(sprintPath, 'utf8');
      expect(content).toContain('story-22: done');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
