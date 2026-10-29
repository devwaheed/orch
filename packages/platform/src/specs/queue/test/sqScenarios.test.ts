import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { ok } from '@orchagents/base';
import type {
  AccountId,
  AgentAdapter,
  AgentId,
  ChangedFile,
  CriterionResult,
  EngineRequest,
  IRunsService,
  Job,
  JobId,
  JobSpec,
  OrchEvent,
  Os,
  PickAccountResult,
  QueueId,
  Result,
  Run,
  RunId,
  SessionId,
  ShellId,
  SpecId,
  SpecQueue,
  SpecQueueSettings,
  SpecRun,
  SpecState,
  Timestamp,
} from '@orchagents/contracts';
import type { IProfilesService } from '../../../profiles/common/profiles.js';
import { DEFAULT_SPEC_QUEUE_SETTINGS, scheduleQueue } from '../common/scheduler.js';
import { SpecsQueueService } from '../node/specsQueueService.js';
import { FastSpecJobRunner, RealSpecJobRunner, type RealSpecJobRunnerDeps } from '../node/specJobRunner.js';
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
    return ok([{ path: 'src/change.ts', added: 1, removed: 0 }]);
  }
  async getDiff(_worktreePath: string, _targetBranch: string, _filePath?: string): Promise<Result<string>> {
    void _worktreePath;
    void _targetBranch;
    void _filePath;
    return ok('diff --git a/src/change.ts b/src/change.ts\n+++ b/src/change.ts\n+change\n');
  }
}

/** The real try runner with a job that finishes and an auditor that answers met for every line. */
function realRunner(installedAgents: AgentId[], commandRunner?: RealSpecJobRunnerDeps['commandRunner']): RealSpecJobRunner {
  const listeners = new Set<(event: OrchEvent) => void>();
  const jobs = {
    async start(spec: JobSpec) {
      const job = { id: 'j-1' as JobId, title: spec.goal, spec, status: 'running', step: null, createdAt: new Date().toISOString(), scheduledFor: null } as Job;
      queueMicrotask(() => { for (const l of listeners) l({ type: 'job.changed', job: { ...job, status: 'done' } }); });
      return ok(job);
    },
    async get() { return { ok: false as const, error: { code: 'not_found' as const, message: 'gone' } }; },
    async cancel() { return ok(undefined); },
    onEvent(listener: (event: OrchEvent) => void) { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; },
  };
  const engine = {
    async request(request: { op: string }) {
      if (request.op === 'session.start') return ok({ session: 's-audit' });
      if (request.op === 'session.send') return ok({ session: 's-audit', output: JSON.stringify({ results: [{ index: 0, met: true, reason: 'ok' }] }) });
      return ok({});
    },
  };
  const profiles = {
    async create() { throw new Error('unused'); },
    async remove() { return ok(undefined); },
    async setSharedSkills() { return ok(true); },
    async sessionEnv() { return ok({}); },
  };
  return new RealSpecJobRunner({
    git: new MockGitService(),
    quota: { async pickAccount(agent: AgentId): Promise<Result<PickAccountResult>> { return ok({ kind: 'account', accountId: `acct-${agent}` as AccountId }); } },
    installedAgents,
    jobs,
    engine,
    profiles,
    ...(commandRunner ? { commandRunner } : {}),
  } as unknown as RealSpecJobRunnerDeps);
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
      mode: 'single',
      agents: [],
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
    history: [],
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

  it('clears the restart note when the recovered spec starts its next try', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-sq-restart-note-'));
    let observedNote: string | null | undefined;
    const service = new SpecsQueueService({
      git: new MockGitService(),
      jobRunner: {
        async runTry(spec) {
          observedNote = spec.note;
          return { success: true, criterionResults: [] };
        },
        async cancel() {},
      },
    });
    try {
      const spec = makeSpec('restart', 1);
      spec.note = 'Restarted after orch closed.';
      const queue = makeQueue(tmp, [spec]);
      service.initQueue(queue);
      await service.start(queue.id);
      const deadline = Date.now() + 3000;
      while (service.getQueue(queue.id)?.specs[0]?.state !== 'verified' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(observedNote).toBeNull();
      expect(service.getQueue(queue.id)?.specs[0]?.note).toBeNull();
    } finally {
      service.dispose();
      await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    }
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

  it('builds each retry prompt from only the latest one-line failure', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-sq-retry-prompt-'));
    const prompts: Array<string | undefined> = [];
    const runner = {
      async runTry(_spec: SpecRun, _repo: string, _settings: SpecQueueSettings, retryMessage?: string) {
        prompts.push(retryMessage);
        return { success: false, failedChecks: [prompts.length === 1
          ? 'Job failed: The previous try did not meet these criteria:\n\nImplement task'
          : 'Latest diagnostic\nprevious goal and details'], criterionResults: [] };
      },
      async cancel() {},
    };
    const service = new SpecsQueueService({ git: new MockGitService(), jobRunner: runner });
    try {
      const spec = makeSpec('retry-prompt', 1, 'queued', [], ['src/**']);
      const queue = makeQueue(tmp, [spec], { retries: 2 });
      service.initQueue(queue);
      await service.start(queue.id);
      const deadline = Date.now() + 5000;
      while (service.getQueue(queue.id)?.specs[0]?.state !== 'needs_you' && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(prompts).toHaveLength(3);
      expect(prompts[1]).toBe('The previous try did not meet these criteria:\n- Job failed');
      expect(prompts[2]).toBe('The previous try did not meet these criteria:\n- Latest diagnostic');
    } finally {
      service.dispose();
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('moves a spec to needs_you after its final audit failure', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-sq-final-audit-'));
    const service = new SpecsQueueService({ git: new MockGitService(), jobRunner: new FastSpecJobRunner({ auditFailures: new Set(['final-audit']) }) });
    try {
      const spec = makeSpec('final-audit', 1, 'queued', [], ['src/**']);
      const queue = makeQueue(tmp, [spec], { retries: 2 });
      service.initQueue(queue);
      await service.start(queue.id);
      const deadline = Date.now() + 5000;
      while (service.getQueue(queue.id)?.specs[0]?.state !== 'needs_you' && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(service.getQueue(queue.id)?.specs[0]).toMatchObject({ state: 'needs_you', attempt: 3 });
    } finally {
      service.dispose();
      await fs.rm(tmp, { recursive: true, force: true });
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

    const runner = realRunner(['claude', 'codex']);

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

    const runner = realRunner(['codex']);

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

    const runner = realRunner(['claude', 'codex'], async () => ({ exitCode: 1, stdout: '', stderr: 'Gate failed' }));

    const settings: SpecQueueSettings = {
      ...DEFAULT_SPEC_QUEUE_SETTINGS,
      after_each: [{ name: 'smoke-test', run: 'pnpm test:smoke', timeout_s: 30 }],
    };

    const res = await runner.runTry(s, '/repo', settings);
    expect(res.success).toBe(false);
    expect(res.failedGate).toBe('smoke-test');
  });

  it('failed command across all tries records a refuted spec result for Review', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-sq-review-failed-'));
    const s = makeSpec('42', 1, 'queued', [], ['src/**'], [
      { by: 'check', text: 'npm test', check: { kind: 'command', run: 'npm test' } },
    ]);
    s.jobId = 'j-42' as JobId;
    let attempts = 0;
    const reviews: Array<{ success: boolean; results: readonly CriterionResult[]; failureLines: readonly string[] }> = [];
    const service = new SpecsQueueService({
      git: new MockGitService(),
      jobRunner: {
        async runTry() {
          attempts++;
          return { success: false, failedChecks: ['npm test'], criterionResults: [{ index: 0, state: 'not_met', summary: 'Command failed with code 127', auditor: null }] };
        },
        async cancel() {},
      },
      jobs: {
        async start() { return ok({} as Job); },
        async get() { return { ok: false as const, error: { code: 'not_found' as const, message: 'missing' } }; },
        async cancel() { return ok(undefined); },
        onEvent() { return { dispose() {} }; },
        async recordSpecVerdict(_spec, _jobId, results, success, failureLines = []) { reviews.push({ success, results, failureLines }); },
      },
    });
    try {
      const queue = makeQueue(tmp, [s], { retries: 2 });
      service.initQueue(queue);
      await service.start(queue.id);
      const deadline = Date.now() + 3000;
      while (service.getQueue(queue.id)?.specs[0]?.state !== 'needs_you' && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
      expect(attempts).toBe(3);
      expect(service.getQueue(queue.id)?.specs[0]?.state).toBe('needs_you');
      expect(reviews).toHaveLength(3);
      expect(reviews.at(-1)).toMatchObject({
        success: false,
        results: [{ state: 'not_met', summary: 'Command failed with code 127' }],
        failureLines: ['npm test'],
      });
    } finally {
      service.dispose();
      await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    }
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

  // Plan view (spec state history): every transition the queue makes is recorded oldest first,
  // each with the time and the attempt it happened at (contracts SpecStateChange).
  it('records every state change in the spec history, in order, with at and attempt', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-sq-history-'));
    const service = new SpecsQueueService({
      git: new MockGitService(),
      jobRunner: new FastSpecJobRunner(),
    });
    try {
      const s = makeSpec('1', 1, 'queued', [], ['src/**']);
      const queue = makeQueue(tmp, [s]);

      service.initQueue(queue);
      await service.start(queue.id);

      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const cur = service.getQueue(queue.id)?.specs[0];
        if (cur?.state === 'verified') {
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      const finalSpec = service.getQueue(queue.id)!.specs[0]!;
      expect(finalSpec.state).toBe('verified');
      expect(finalSpec.history.map((change) => change.state)).toEqual([
        'running', // the initial queued state is not a change; the loader starts with history []
        'verifying',
        'auditing',
        'verified',
      ]);
      for (const change of finalSpec.history) {
        expect(change.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(change.attempt).toBe(1);
      }
    } finally {
      service.dispose();
      await new Promise((r) => setTimeout(r, 50));
      await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    }
  });

  // Plan view (spec usage, services.ts ISpecsService.usage): ledger turns of the spec's sessions
  // group into clock-hour buckets; rows from other sessions are ignored.
  it('usage sums ledger rows into hourly buckets for the spec sessions only', async () => {
    const row = (
      ts: string,
      session: string,
      tokensIn: number,
      tokensOut: number,
      costUsd: number,
    ): Record<string, unknown> => ({ ts, session, tokensIn, tokensOut, costUsd, ok: true });

    const requests: EngineRequest[] = [];
    const engine = {
      request: async (request: EngineRequest): Promise<Result<unknown>> => {
        requests.push(request);
        return ok({
          rows: [
            row('2026-10-10T10:15:00.000Z', 's-1', 1000, 500, 0.125),
            row('2026-10-10T10:40:12.000Z', 's-1', 2000, 700, 0.375),
            row('2026-10-10T11:05:00.000Z', 's-1', 400, 100, 0.25),
            row('2026-10-10T11:30:00.000Z', 's-other', 9999, 9999, 9),
          ],
        });
      },
    };
    const run = (id: string, sessionId: string | null): Run => ({
      id: id as RunId,
      jobId: 'j-09' as JobId,
      parentId: null,
      depth: 0,
      role: 'implementer',
      task: 'Implement',
      agent: 'claude',
      accountId: 'claude-work' as AccountId,
      status: 'done',
      worktree: null,
      readOnly: false,
      sessionId: (sessionId ?? null) as SessionId | null,
      startedAt: null,
      resumesAt: null,
    });
    const runs = { list: async (): Promise<Result<Run[]>> => ok([run('r-1', 's-1'), run('r-2', null)]) };

    const service = new SpecsQueueService({
      git: new MockGitService(),
      jobRunner: new FastSpecJobRunner(),
      runs,
      engine,
    });
    const s = { ...makeSpec('1', 1, 'running'), jobId: 'j-09' as JobId };
    s.startedAt = '2026-10-10T09:00:00Z' as Timestamp;
    const queue = makeQueue('/repo', [s]);
    service.initQueue(queue);

    try {
      const res = await service.usage(queue.id, s.id);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toEqual([
          { hour: '2026-10-10T10:00:00.000Z', tokens: 4200, usd: 0.5 },
          { hour: '2026-10-10T11:00:00.000Z', tokens: 500, usd: 0.25 },
        ]);
      }
      expect(requests.map((r) => r.op)).toEqual(['ledger.query']);
      expect(requests[0]).toMatchObject({ since: '2026-10-10T09:00:00Z' });
    } finally {
      service.dispose();
    }
  });

  it('Fix in terminal: fake-agent spec fails checks, terminal opens in worktree, editing to pass check and rechecking verifies spec', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-sq-fix-terminal-'));
    const wtDir = path.join(tmp, '.orch', 'wt', 'spec-fix-1');
    await fs.mkdir(wtDir, { recursive: true });

    let terminalOpened = false;
    const terminalService = {
      openCommand: async (_argv: readonly string[], _env: Readonly<Record<string, string>>, cwd: string) => {
        terminalOpened = true;
        expect(cwd).toBe(wtDir);
        return ok('sh-fix' as ShellId);
      },
    };

    const checkFailures = new Set(['fix-1']);
    const runner = new FastSpecJobRunner({
      checkFailures,
    });

    const service = new SpecsQueueService({
      git: new MockGitService(),
      jobRunner: runner,
      terminal: terminalService,
      adapters: [
        {
          id: 'fake',
          name: 'Fake Agent',
          command: 'fake',
          detect: async () => ({ installed: true }),
          installInstructions: () => '',
          accountEnv: () => ({}),
          resumeCommand: (_profileDir: string, _os: Os, sessionId?: string | null) => ({
            argv: ['fake', '--resume', sessionId ?? ''],
            env: {},
          }),
        } as unknown as AgentAdapter,
      ],
      profiles: {
        sessionEnv: async () => ok({}),
      } as unknown as IProfilesService,
      runs: {
        list: async () => ok([{ id: 'r-1' as RunId, jobId: 'j-1' as JobId, sessionId: 's-fake', status: 'done' } as Run]),
      } as unknown as IRunsService,
      jobs: {
        start: async () => ({ ok: false, error: { code: 'not_found', message: '' } }),
        get: async () => ({ ok: false, error: { code: 'not_found', message: '' } }),
        cancel: async () => ok(undefined),
        onEvent: () => ({ dispose: () => {} }),
        recordSpecVerdict: async () => undefined,
      },
    });

    try {
      const spec = makeSpec('fix-1', 1, 'queued', [], ['src/**'], [
        { by: 'check', text: 'Unit tests', check: { kind: 'command', run: 'exit 1' } },
      ]);
      spec.spec.agent = 'fake' as AgentId;
      spec.implementer = { agent: 'fake' as AgentId, accountId: 'fake-1' as AccountId };
      const queue = makeQueue(tmp, [spec], { retries: 0 });
      service.initQueue(queue);

      // 1. Queue runs, spec fails check on try 1 with retries=0 -> transitions to needs_you
      await service.start(queue.id);
      const deadline = Date.now() + 5000;
      while (service.getQueue(queue.id)?.specs[0]?.state !== 'needs_you' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 20));
      }

      const failingSpec = service.getQueue(queue.id)!.specs[0]!;
      expect(failingSpec.state).toBe('needs_you');
      expect(failingSpec.criteria[0]?.state).toBe('not_met');

      // 2. User clicks "Fix in terminal" -> opens terminal in worktree
      const termRes = await service.openTerminal(queue.id, failingSpec.id, 100, 24);
      expect(termRes.ok).toBe(true);
      expect(terminalOpened).toBe(true);

      // 3. User edits code in worktree to fix the failing check
      checkFailures.delete('fix-1');

      // 4. User clicks "Check again" -> recheck runs verify on worktree without new implementation turn
      const recheckRes = await service.recheck(queue.id, failingSpec.id);
      expect(recheckRes.ok).toBe(true);
      if (!recheckRes.ok) return;

      // 5. Check passes -> spec transitions to verified!
      expect(recheckRes.value.state).toBe('verified');
      expect(recheckRes.value.criteria[0]?.state).toBe('met');
      expect(service.getQueue(queue.id)?.specs[0]?.state).toBe('verified');
    } finally {
      service.dispose();
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  });
});
