import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ok } from '@orchagents/base';
import type { AccountId, AgentId, EngineEnv, EngineEvent, Job, JobId, JobSpec, OrchEvent, PickAccountResult, Run, RunLine, SpecId, SpecQueueSettings, SpecRun } from '@orchagents/contracts';
import type { IGitService } from '../../../git/common/git.js';
import type { IProfilesService } from '../../../profiles/common/profiles.js';
import { DEFAULT_SPEC_QUEUE_SETTINGS } from '../common/scheduler.js';
import { RealSpecJobRunner } from '../node/specJobRunner.js';
import { SpecsQueueService } from '../node/specsQueueService.js';
import { ClaudeAdapter } from '../../../adapters/node/claude.js';

const specFor = (criteria: SpecRun['spec']['done_when']): SpecRun => ({
  id: '42' as SpecId, queueId: 'q-abc' as SpecRun['queueId'], position: 1, file: 'docs/specs/042-task.md',
  spec: { id: '42', title: 'Implement task', depends_on: [], scope: [], done_when: criteria, agent: 'auto', mode: 'single', agents: [] },
  state: 'running', attempt: 1, jobId: null, worktree: null, implementer: null,
  criteria: criteria.map((_, index) => ({ index, state: 'pending', summary: null, auditor: null })),
  blockedBy: [], startedAt: null, finishedAt: null, tokens: 0, history: [],
});

class FakeJobs {
  readonly starts: Array<{ spec: JobSpec; options?: { worktreeRunId?: string; verifiedBy?: 'spec' } }> = [];
  readonly cancelled: JobId[] = [];
  private listeners = new Set<(event: OrchEvent) => void>();
  private job: Job | null = null;
  constructor(private readonly finalStatus: Job['status'] | null = 'done') {}
  async start(spec: JobSpec, options?: { worktreeRunId?: string; verifiedBy?: 'spec' }) {
    this.starts.push({ spec, ...(options ? { options } : {}) });
    this.job = { id: 'j-42' as JobId, title: spec.goal, spec, status: 'running', step: null, createdAt: new Date().toISOString() as Job['createdAt'], scheduledFor: null };
    const finalStatus = this.finalStatus;
    if (finalStatus) queueMicrotask(() => {
      if (!this.job) return;
      this.job = { ...this.job, status: finalStatus };
      for (const listener of this.listeners) listener({ type: 'job.changed', job: this.job });
    });
    return ok(this.job);
  }
  async get() { return this.job ? ok(this.job) : { ok: false as const, error: { code: 'not_found' as const, message: 'missing' } }; }
  async cancel(jobId: JobId) { this.cancelled.push(jobId); return ok(undefined); }
  onEvent(listener: (event: OrchEvent) => void) {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }
}

const failedEngineRuns = {
  async list() { return ok([{ id: 'r-42' as import('@orchagents/contracts').RunId, agent: 'opencode' as AgentId } as Run]); },
  async lines() { return ok([{ kind: 'err', text: 'Managed service port 49374 on 127.0.0.1 is already in use by another process.\nAdditional details' } as RunLine]); },
};

class FakeGit {
  constructor(private readonly diff = 'diff --git a/src/change.ts b/src/change.ts\n+++ b/src/change.ts\n+change\n') {}
  async getDefaultBranch() { return ok('main'); }
  async getDiff() { return ok(this.diff); }
  async getChangedFiles() { return ok(this.diff ? [{ path: 'src/change.ts', added: 1, removed: 0 }] : []); }
}

const profiles: IProfilesService = {
  async create() { throw new Error('unused'); },
  async remove() { return ok(undefined); },
  async setSharedSkills() { return ok(true); },
  async sessionEnv() { return ok({ CLAUDE_CONFIG_DIR: '/fake/claude' } as EngineEnv); },
};
const quota = { async pickAccount(agent: AgentId) { return ok({ kind: 'account', accountId: `acct-${agent}` as AccountId } satisfies PickAccountResult); } };
const settings: SpecQueueSettings = { ...DEFAULT_SPEC_QUEUE_SETTINGS, after_each: [] };
const changedOutside = ['diff --git a/tmp/escape.txt b/tmp/escape.txt', '--- a/tmp/escape.txt', '+++ b/tmp/escape.txt', '@@ -0,0 +1 @@', '+changed', ''].join('\n');

describe('RealSpecJobRunner jobs, checks, and audit', () => {
  it('starts the spec JobSpec in the shared worktree and reports the job id immediately', async () => {
    const jobs = new FakeJobs();
    let reported: JobId | undefined;
    const runner = new RealSpecJobRunner({ git: new FakeGit() as unknown as IGitService, quota, profiles, jobs, installedAgents: ['claude'], onJobStarted: async (_spec, id) => { reported = id; }, commandRunner: async () => ({ exitCode: 0, stdout: '', stderr: '' }) });
    const spec = specFor([{ by: 'check', text: 'pnpm test', check: { kind: 'command', run: 'pnpm test' } }]);
    const result = await runner.runTry(spec, '/repo', settings);
    expect(jobs.starts[0]?.spec).toMatchObject({ mode: 'single', goal: 'Implement task', repoPath: '/repo', storyPath: spec.file, checks: [], orchestrator: { agent: 'claude', account: 'acct-claude' }, workers: ['claude'] });
    expect(jobs.starts[0]?.options).toEqual({ worktreeRunId: 'spec-42', verifiedBy: 'spec' });
    expect(reported).toBe('j-42');
    expect(result.success).toBe(true);
  });

  it('persists and emits SpecRun.jobId as soon as its job starts', async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-spec-job-link-'));
    await fs.mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'specs', '042-task.md'), '---\nid: "42"\ntitle: Implement task\nscope: []\ndone_when:\n  - by: check\n    text: okay\n    check:\n      kind: command\n      run: test true\n---\nDo the task.\n');
    const jobs = new FakeJobs();
    const events: OrchEvent[] = [];
    const service = new SpecsQueueService({
      git: new FakeGit() as unknown as IGitService, quota, profiles, jobs,
      commandRunner: async () => ({ exitCode: 0, stdout: '', stderr: '' }), installedAgents: ['claude'], onEvent: (event) => events.push(event),
    });
    try {
      const loaded = await service.load(repo);
      expect(loaded.ok && loaded.value.queue).toBeTruthy();
      if (!loaded.ok || !loaded.value.queue) return;
      const queueId = loaded.value.queue.id;
      await service.start(queueId);
      const deadline = Date.now() + 3000;
      while (service.getQueue(queueId)?.specs[0]?.jobId === null && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
      expect(service.getQueue(queueId)?.specs[0]?.jobId).toBe('j-42');
      expect(events.some((event) => event.type === 'spec.changed' && event.spec.jobId === 'j-42')).toBe(true);
      let saved: { specs: Array<{ jobId: string | null }> } | undefined;
      const persistDeadline = Date.now() + 3000;
      while (!saved && Date.now() < persistDeadline) {
        try { saved = JSON.parse(await fs.readFile(path.join(repo, '.orch', 'queue-state.json'), 'utf8')) as { specs: Array<{ jobId: string | null }> }; }
        catch { await new Promise((resolve) => setTimeout(resolve, 5)); }
      }
      expect(saved).toBeDefined();
      if (!saved) throw new Error('queue state was not persisted');
      expect(saved.specs[0]?.jobId).toBe('j-42');
    } finally {
      service.dispose();
      await fs.rm(repo, { recursive: true, force: true });
    }
  });

  it('emits a running SpecRun with its jobId while the job is still running', async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-spec-running-'));
    await fs.mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docs', 'specs', '042-task.md'), '---\nid: "42"\ntitle: Implement task\nscope: []\ndone_when:\n  - by: check\n    text: okay\n    check:\n      kind: command\n      run: test true\n---\nDo the task.\n');
    const jobs = new FakeJobs(null);
    const events: OrchEvent[] = [];
    const service = new SpecsQueueService({
      git: new FakeGit() as unknown as IGitService, quota, profiles, jobs,
      commandRunner: async () => ({ exitCode: 0, stdout: '', stderr: '' }), installedAgents: ['claude'], onEvent: (event) => events.push(event),
    });
    try {
      const loaded = await service.load(repo);
      expect(loaded.ok && loaded.value.queue).toBeTruthy();
      if (!loaded.ok || !loaded.value.queue) return;
      const queueId = loaded.value.queue.id;
      await service.start(queueId);
      const deadline = Date.now() + 3000;
      while (!events.some((event) => event.type === 'spec.changed' && event.spec.jobId === 'j-42') && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      const started = events.find((event) => event.type === 'spec.changed' && event.spec.jobId === 'j-42');
      expect(started).toMatchObject({ type: 'spec.changed', spec: { state: 'running', jobId: 'j-42' } });
      expect(events.filter((event) => event.type === 'spec.changed').every((event) => event.type === 'spec.changed' && event.spec.queueId === queueId)).toBe(true);
      expect(service.getQueue(queueId)?.specs[0]).toMatchObject({ state: 'running', jobId: 'j-42' });
      expect((await jobs.get())).toMatchObject({ ok: true, value: { status: 'running' } });
    } finally {
      service.dispose();
      await fs.rm(repo, { recursive: true, force: true });
    }
  });

  it('turns a failed platform job into a failed try', async () => {
    const jobs = new FakeJobs('failed');
    const runner = new RealSpecJobRunner({ git: new FakeGit() as unknown as IGitService, quota, jobs, runs: failedEngineRuns, installedAgents: ['opencode'] });
    const result = await runner.runTry(specFor([]), '/repo', settings);
    expect(result.success).toBe(false);
    expect(result.failedChecks?.[0]).toBe("OpenCode couldn't run: Managed service port 49374 on 127.0.0.1 is already in use by another process.");
  });

  it('maps a job paused on an account limit to a limited try', async () => {
    const jobs = new FakeJobs('waiting_quota');
    const runner = new RealSpecJobRunner({ git: new FakeGit() as unknown as IGitService, quota, jobs, installedAgents: ['claude'] });
    const result = await runner.runTry(specFor([]), '/repo', settings);
    expect(result.success).toBe(false);
    expect(result.limited).toEqual({ agent: 'claude', accountId: 'acct-claude' });
  });

  it('fails a check criterion when its command fails, preserving the command summary', async () => {
    const runner = new RealSpecJobRunner({ git: new FakeGit() as unknown as IGitService, quota, profiles, jobs: new FakeJobs(), installedAgents: ['claude'], commandRunner: async () => ({ exitCode: 127, stdout: '', stderr: '' }) });
    const result = await runner.runTry(specFor([{ by: 'check', text: 'npm test', check: { kind: 'command', run: 'npm test' } }]), '/repo', settings);
    expect(result.success).toBe(false);
    expect(result.failedChecks).toEqual(['npm test']);
    expect(result.criterionResults[0]).toMatchObject({ state: 'not_met', summary: 'Command failed with code 127' });
  });

  it('passes quoted check arguments as argv to the command runner', async () => {
    let received: { cmd: string; args: readonly string[] } | undefined;
    const runner = new RealSpecJobRunner({
      git: new FakeGit() as unknown as IGitService, quota, profiles, jobs: new FakeJobs(), installedAgents: ['claude'],
      commandRunner: async (cmd, args) => { received = { cmd, args }; return { exitCode: 1, stdout: '', stderr: '' }; },
    });
    await runner.runTry(specFor([{ by: 'check', text: 'node -e "process.exit(1)"', check: { kind: 'command', run: 'node -e "process.exit(1)"' } }]), '/repo', settings);
    expect(received).toEqual({ cmd: 'node', args: ['-e', 'process.exit(1)'] });
  });

  it('fails a try when the implementation changed no files', async () => {
    const runner = new RealSpecJobRunner({ git: new FakeGit('') as unknown as IGitService, quota, profiles, jobs: new FakeJobs(), installedAgents: ['claude'] });
    const result = await runner.runTry(specFor([]), '/repo', settings);
    expect(result.success).toBe(false);
    expect(result.failedChecks).toEqual(['The agent made no changes.']);
  });

  it('cancels the current spec job', async () => {
    const jobs = new FakeJobs();
    const runner = new RealSpecJobRunner({ git: new FakeGit() as unknown as IGitService, quota, jobs, installedAgents: ['claude'] });
    await runner.cancel({ ...specFor([]), jobId: 'j-42' as JobId }, '/repo');
    expect(jobs.cancelled).toEqual(['j-42']);
  });

  it('fails an HTTP check and a file rule when their criteria are not met', async () => {
    const jobs = new FakeJobs();
    const runner = new RealSpecJobRunner({ git: new FakeGit(changedOutside) as unknown as IGitService, quota, jobs, installedAgents: ['claude'], commandRunner: async () => ({ exitCode: 0, stdout: '', stderr: '' }) });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('', { status: 503 });
    try {
      const result = await runner.runTry(specFor([
        { by: 'check', text: 'https://example.test', check: { kind: 'http', url: 'https://example.test', expectStatus: 200 } },
        { by: 'check', text: 'only src files', check: { kind: 'file_rule', allow: ['src/**'] } },
      ]), '/repo', settings);
      expect(result.success).toBe(false);
      expect(result.criterionResults.map((criterion) => criterion.state)).toEqual(['not_met', 'not_met']);
    } finally { globalThis.fetch = originalFetch; }
  });

  it.each([
    ['explicit not-met answer', '{"results":[{"index":0,"met":false,"reason":"Missing API"}]}', 'Missing API'],
    ['unparseable answer', 'not json', 'The auditor gave no clear answer'],
  ])('fails the try when the auditor returns %s', async (_label, answer, summary) => {
    const jobs = new FakeJobs();
    const requests: Array<Record<string, unknown>> = [];
    const engine = { async request(request: Record<string, unknown>) {
      requests.push(request);
      if (request.op === 'session.start') return ok({ session: 's-audit' });
      if (request.op === 'session.send') return ok({ session: 's-audit', output: answer });
      return ok({});
    } };
    const runner = new RealSpecJobRunner({ git: new FakeGit() as unknown as IGitService, quota, profiles, engine, jobs, installedAgents: ['claude'] });
    const result = await runner.runTry(specFor([{ by: 'audit', text: 'API exists' }]), '/repo', settings);
    expect(result.success).toBe(false);
    expect(result.failedAudits).toEqual(['API exists']);
    expect(result.criterionResults[0]?.state).toBe('not_met');
    expect(result.criterionResults[0]?.summary).toBe(summary);
    expect(requests.find((request) => request.op === 'session.start')).toMatchObject({ cwd: '/repo/.orch/wt/spec-42', readOnly: true });
  });

  it('accepts a met answer wrapped in a code fence', async () => {
    const engine = { async request(request: Record<string, unknown>) {
      if (request.op === 'session.start') return ok({ session: 's-audit' });
      if (request.op === 'session.send') return ok({ session: 's-audit', output: 'Here you go:\n```json\n{"results":[{"index":0,"met":true,"reason":"API exists"}]}\n```' });
      return ok({});
    } };
    const runner = new RealSpecJobRunner({ git: new FakeGit() as unknown as IGitService, quota, profiles, engine, jobs: new FakeJobs(), installedAgents: ['claude'] });
    const result = await runner.runTry(specFor([{ by: 'audit', text: 'API exists' }]), '/repo', settings);
    expect(result.success).toBe(true);
    expect(result.criterionResults[0]).toMatchObject({ state: 'met', summary: 'API exists' });
  });

  it('routes audits away from signed-out accounts and reports engine failures clearly', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const engine = { async request(request: Record<string, unknown>) {
      calls.push(request);
      if (request.op === 'session.start') return ok({ session: `s-audit-${calls.filter((call) => call.op === 'session.start').length}` });
      if (request.op === 'session.send') return { ok: false as const, error: { code: 'internal' as const, message: 'Not logged in · Please run /login', fix: 'Sign in' } };
      return ok({});
    } };
    const accounts = { async list() {
      return ok([
        { id: 'acct-claude' as AccountId, agent: 'claude' as AgentId, use: true, state: 'signed_out' as const },
        { id: 'acct-gemini' as AccountId, agent: 'gemini' as AgentId, use: true, state: 'available' as const },
      ] as import('@orchagents/contracts').Account[]);
    } };
    const runner = new RealSpecJobRunner({ git: new FakeGit() as unknown as IGitService, quota, profiles, engine, accounts, jobs: new FakeJobs(), installedAgents: ['claude', 'gemini'] });
    const result = await runner.runTry(specFor([{ by: 'audit', text: 'API exists' }]), '/repo', settings);
    expect(calls.find((request) => request.op === 'session.start')).toMatchObject({ agent: 'gemini' });
    expect(calls.filter((request) => request.op === 'session.start')).toHaveLength(2);
    expect(result.criterionResults[0]).toMatchObject({ state: 'not_met', summary: "Gemini CLI couldn't audit: Not logged in · Please run /login" });
  });

  it('starts an Antigravity auditor session with Claw read-only enabled', async () => {
    const starts: Array<Record<string, unknown>> = [];
    const engine = { async request(request: Record<string, unknown>) {
      if (request.op === 'session.start') {
        starts.push(request);
        return ok({ session: 's-agy-audit' });
      }
      if (request.op === 'session.send') return ok({ session: 's-agy-audit', output: '{"results":[{"index":0,"met":true,"reason":"API exists"}]}' });
      return ok({});
    } };
    const runner = new RealSpecJobRunner({
      git: new FakeGit() as unknown as IGitService, quota, profiles, engine,
      jobs: new FakeJobs(), installedAgents: ['claude', 'agy'],
    });
    const spec = specFor([{ by: 'audit', text: 'API exists' }]);
    spec.spec.agent = 'claude';
    await runner.runTry(spec, '/repo', settings);
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({ agent: 'agy', readOnly: true });
  });

  it('marks an auditor signed out on the adapter login error, retries once, and keeps the agent error line', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const listeners = new Set<(event: EngineEvent) => void>();
    const engine = {
      onEvent(listener: (event: EngineEvent) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async request(request: Record<string, unknown>) {
        calls.push(request);
        if (request.op === 'session.start') return ok({ session: `audit-${calls.filter((call) => call.op === 'session.start').length}` });
        if (request.op === 'session.send' && request.session === 'audit-1') {
          for (const listener of listeners) listener({ type: 'session.output', session: 'audit-1', seq: 1, kind: 'err', text: 'Not logged in · Please run /login\nMore details' });
          return { ok: false as const, error: { code: 'account_signed_out' as const, message: 'Not logged in · Please run /login', fix: 'The engine could not complete that request.' } };
        }
        if (request.op === 'session.send') return ok({ session: request.session, output: '{"results":[{"index":0,"met":true,"reason":"API exists"}]}' });
        return ok({});
      },
    };
    let markedSignedOut: AccountId | undefined;
    const accounts = {
      async list() { return ok([
        { id: 'acct-claude' as AccountId, agent: 'claude' as AgentId, use: true, state: 'available' as const },
        { id: 'acct-codex' as AccountId, agent: 'codex' as AgentId, use: true, state: 'available' as const },
      ] as import('@orchagents/contracts').Account[]); },
      async markSignedOut(id: AccountId) { markedSignedOut = id; return ok(undefined); },
    };
    const runner = new RealSpecJobRunner({
      git: new FakeGit() as unknown as IGitService, quota, profiles, engine, accounts,
      adapters: [new ClaudeAdapter()], jobs: new FakeJobs(), installedAgents: ['claude', 'codex'],
    });
    const spec = specFor([{ by: 'audit', text: 'API exists' }]);
    spec.spec.agent = 'codex';
    const result = await runner.runTry(spec, '/repo', settings);
    expect(markedSignedOut).toBe('acct-claude');
    expect(calls.filter((call) => call.op === 'session.start').map((call) => call.agent)).toEqual(['claude', 'codex']);
    expect(result).toMatchObject({ success: true, auditor: { agent: 'codex', accountId: 'acct-codex', sameAgent: true } });
    expect(result.criterionResults[0]).toMatchObject({ state: 'met', auditor: { agent: 'codex' } });
  });

  it('uses the first agent error line when an engine request only returns its generic wrapper', async () => {
    const engine = {
      onEvent(listener: (event: EngineEvent) => void) {
        this.listener = listener;
        return () => { this.listener = undefined; };
      },
      listener: undefined as ((event: EngineEvent) => void) | undefined,
      async request(request: Record<string, unknown>) {
        if (request.op === 'session.start') return ok({ session: 'audit-session' });
        if (request.op === 'session.send') {
          this.listener?.({ type: 'session.output', session: 'audit-session', seq: 1, kind: 'err', text: 'Not logged in · Please run /login\nignored detail' });
          return { ok: false as const, error: { code: 'internal' as const, message: 'The engine could not complete that request.' } };
        }
        return ok({});
      },
    };
    const runner = new RealSpecJobRunner({
      git: new FakeGit() as unknown as IGitService, quota, profiles, engine,
      accounts: { async list() { return ok([{ id: 'acct-claude' as AccountId, agent: 'claude' as AgentId, use: true, state: 'available' as const }] as import('@orchagents/contracts').Account[]); } },
      adapters: [new ClaudeAdapter()], jobs: new FakeJobs(), installedAgents: ['claude'],
    });
    const result = await runner.runTry(specFor([{ by: 'audit', text: 'API exists' }]), '/repo', settings);
    expect(result.criterionResults[0]?.summary).toBe("Claude Code couldn't audit: Not logged in · Please run /login");
  });
});
