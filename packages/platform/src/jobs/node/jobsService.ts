import { eq } from 'drizzle-orm';
import * as path from 'node:path';
import { Emitter, type Event } from '@orchagents/base';
import {
  type AccountId,
  type AgentAdapter,
  type AgentId,
  type ChangedFile,
  type CheckResult,
  type EngineEnv,
  type EngineEvent,
  type Job,
  type JobId,
  type JobSpec,
  type JobStep,
  type OrchEvent,
  type QuotaObservation,
  type Result,
  type Run,
  type RunId,
  type RunLine,
  type Session,
  type SessionId,
  type Timestamp,
  type WorktreeId,
  type WorktreeReview,
  type Verdict,
  type WorktreeState,
  type SpecRun,
  type CriterionResult,
  type IQuotaService,
} from '@orchagents/contracts';
import { jobTable, reviewTable } from '../../store/common/schema.js';
import type { IStoreService } from '../../store/common/store.js';
import type { IProfilesService } from '../../profiles/common/profiles.js';
import type { EngineClient } from '../../engine/common/engineClient.js';
import type { IGitService } from '../../git/common/git.js';
import type { RunsService } from '../../runs/node/runsService.js';
import { TAKE_OVER_AFTER_LIMIT } from '../../runs/common/runs.js';
import type { IEngineSessionRecorder } from '../../sessions/node/sessionsService.js';
import {
  COMPARE_COMBINE,
  JOB_CHECK_COPY,
  formatJobId,
  type IJobsService,
  JOB_ERRORS,
  parseJobIdCounter,
} from '../common/jobs.js';
import { jobSpecToCommand } from '../common/toCommand.js';
import { evaluateGuardrails } from './guardrails.js';

export interface JobsServiceDeps {
  store: IStoreService;
  quota: Pick<IQuotaService, 'pickAccount'> & { observe?: (obs: QuotaObservation) => Result<void> };
  profiles: IProfilesService;
  engine: Pick<EngineClient, 'request' | 'onEvent'>;
  git: IGitService;
  runs: RunsService;
  /** SES producer: engine sessions of runs are recorded here and their statuses applied. */
  sessions?: IEngineSessionRecorder;
  now?: () => Date;
  onEvent?: (event: OrchEvent) => void;
  adapterFor: (agent: AgentId) => AgentAdapter;
}

/** Core-host-only start option used by specs to share one worktree across retries. */
export interface JobStartOptions {
  worktreeRunId?: string;
  /** Specs own verification through their check, audit, and gate cycle. */
  verifiedBy?: 'spec';
}

function toJob(row: typeof jobTable.$inferSelect): Job {
  return {
    id: row.id as JobId,
    title: row.title,
    spec: row.spec,
    status: row.status,
    step: row.step ?? null,
    createdAt: row.createdAt as Timestamp,
    scheduledFor: (row.scheduledFor as Timestamp) ?? null,
  };
}

function toWorktreeReview(row: typeof reviewTable.$inferSelect): WorktreeReview {
  return {
    worktree: row.worktree as WorktreeId,
    jobId: row.jobId as JobId,
    runId: (row.runId as RunId) ?? null,
    sessionId: (row.sessionId as SessionId) ?? null,
    title: row.title,
    state: row.state as WorktreeState,
    verdict: row.verdict as Verdict,
    checks: row.checks,
    files: row.files,
    evidenceRef: row.evidenceRef ?? null,
    note: row.note ?? null,
  };
}

function toRunLineKind(kind: string): RunLine['kind'] {
  switch (kind) {
    case 'prompt':
    case 'message':
    case 'tool':
    case 'diff_add':
    case 'diff_del':
    case 'ok':
    case 'err':
    case 'limit':
    case 'spawn':
      return kind;
    default:
      return 'meta';
  }
}

function parseCommandArgs(run: string): { cmd: string; args: string[] } {
  const matches = run.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  const tokens = matches.map((t) => {
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
      return t.slice(1, -1);
    }
    return t;
  });
  const cmd = tokens[0] ?? '';
  const args = tokens.slice(1);
  return { cmd, args };
}

interface CompareAnswer {
  name: string;
  ok: boolean;
  output: string;
}

interface WorkflowMeta {
  jobId: JobId;
  runId: RunId;
  /** Every run of a multi-agent job (compare, council); the primary is runId. */
  runIds?: RunId[];
  targetBranch: string;
  worktreePath: string;
  accountId: AccountId;
  verifiedBy?: 'spec';
  /** Compare: fanout agent name → its run, so each agent's session and answer land on its own run. */
  agentRuns?: Map<string, RunId>;
}

/** The step a job is on, as a session's position (SES). */
function positionOf(step: JobStep | null): { step: string; index: number; total: number; attempt: number } {
  return step ? { step: step.name, index: step.index, total: step.total, attempt: step.attempt } : { step: 'Implement', index: 1, total: 2, attempt: 1 };
}

export class JobsService implements IJobsService {
  private readonly emitter = new Emitter<OrchEvent>();
  readonly onEvent: Event<OrchEvent> = this.emitter.event;

  /** Active workflows mapped to jobId and runId */
  private readonly workflowJobs = new Map<string, WorkflowMeta>();
  private readonly sessionRuns = new Map<string, RunId>();
  /** Workflows being started: the engine can report their sessions before workflow.start replies. */
  private readonly pendingStarts = new Set<WorkflowMeta>();
  /**
   * F-06, ADR 0008: runs that hit a limit inside a workflow. That workflow is abandoned, so
   * orch verifies the run itself once a turn after the resume ends (running, then idle).
   * ponytail: in memory like workflowJobs; a core restart mid-resume leaves the run unverified.
   */
  private readonly limitedRuns = new Map<RunId, { meta: WorkflowMeta; resumed: boolean }>();

  constructor(private readonly deps: JobsServiceDeps) {
    if (deps.onEvent) {
      this.emitter.event(deps.onEvent);
    }
    // Wire engine event listener
    this.deps.engine.onEvent((event) => this.onEngineEvent(event));
  }

  private nowIso(): Timestamp {
    const d = this.deps.now ? this.deps.now() : new Date();
    return d.toISOString() as Timestamp;
  }

  private emit(event: OrchEvent): void {
    this.emitter.fire(event);
  }

  private getAdapter(agent: AgentId): AgentAdapter {
    return this.deps.adapterFor(agent);
  }

  async nextJobId(): Promise<JobId> {
    const rows = await this.deps.store.db
      .select({ id: jobTable.id })
      .from(jobTable);
    let max = 0;
    for (const r of rows) {
      const parsed = parseJobIdCounter(r.id);
      if (parsed !== null && parsed > max) {
        max = parsed;
      }
    }
    return formatJobId(max + 1);
  }

  async toCommand(spec: JobSpec): Promise<Result<string>> {
    return { ok: true, value: jobSpecToCommand(spec) };
  }

  async list(): Promise<Result<Job[]>> {
    const rows = await this.deps.store.db
      .select()
      .from(jobTable);
    return { ok: true, value: rows.map(toJob) };
  }

  async get(jobId: JobId): Promise<Result<Job>> {
    const [row] = await this.deps.store.db
      .select()
      .from(jobTable)
      .where(eq(jobTable.id, jobId));
    if (!row) {
      return { ok: false, error: JOB_ERRORS.notFound(jobId) };
    }
    return { ok: true, value: toJob(row) };
  }

  async cancel(jobId: JobId): Promise<Result<void>> {
    const jobRes = await this.get(jobId);
    if (!jobRes.ok) return jobRes;
    const job = jobRes.value;

    if (job.status === 'done' || job.status === 'cancelled') {
      return { ok: true, value: undefined };
    }

    // Cancel engine workflows
    for (const [wf, meta] of this.workflowJobs.entries()) {
      if (meta.jobId === jobId) {
        await this.deps.engine.request({ op: 'workflow.cancel', workflow: wf });
        this.workflowJobs.delete(wf);
      }
    }

    // Update job status
    await this.deps.store.db
      .update(jobTable)
      .set({ status: 'cancelled' })
      .where(eq(jobTable.id, jobId));

    const updatedJob: Job = { ...job, status: 'cancelled' };
    this.emit({ type: 'job.changed', job: updatedJob });

    // Cancel all runs
    const runsRes = await this.deps.runs.list(jobId);
    if (runsRes.ok) {
      for (const run of runsRes.value) {
        if (run.status === 'running' || run.status === 'queued' || run.status === 'paused_limit') {
          await this.deps.runs.stop(run.id);
        }
      }
    }

    return { ok: true, value: undefined };
  }

  /** JOB-09: the autoloop plan needs your approval before coding starts. */
  async approvePlan(jobId: JobId): Promise<Result<void>> {
    const gate = await this.planGate(jobId);
    if (!gate.ok) return gate;
    const res = await this.deps.engine.request({ op: 'workflow.approve', workflow: gate.value.workflow, approve: true });
    if (!res.ok) return { ok: false, error: JOB_ERRORS.engineError(res.error.message) };
    const step: JobStep = { name: 'Code', index: 2, total: 3, attempt: 1, looping: false };
    await this.deps.store.db.update(jobTable).set({ step }).where(eq(jobTable.id, jobId));
    this.emit({ type: 'job.changed', job: { ...gate.value.job, step } });
    return { ok: true, value: undefined };
  }

  /** Sends the reason back to the Planner, which revises the plan; the job stays at Plan. */
  async rejectPlan(jobId: JobId, reason?: string): Promise<Result<void>> {
    const gate = await this.planGate(jobId);
    if (!gate.ok) return gate;
    const res = await this.deps.engine.request({
      op: 'workflow.approve',
      workflow: gate.value.workflow,
      approve: false,
      ...(reason ? { reason } : {}),
    });
    if (!res.ok) return { ok: false, error: JOB_ERRORS.engineError(res.error.message) };
    return { ok: true, value: undefined };
  }

  private async planGate(jobId: JobId): Promise<Result<{ job: Job; workflow: string }>> {
    const jobRes = await this.get(jobId);
    if (!jobRes.ok) return jobRes;
    const job = jobRes.value;
    if (job.spec.mode !== 'autoloop') return { ok: false, error: JOB_ERRORS.notAutoloop(jobId) };
    const workflow = [...this.workflowJobs.entries()].find(([, meta]) => meta.jobId === jobId)?.[0];
    if (job.status !== 'running' || job.step?.name !== 'Plan' || !workflow) {
      return { ok: false, error: JOB_ERRORS.notAwaitingApproval(jobId) };
    }
    return { ok: true, value: { job, workflow } };
  }

  private buildClawContract(checks?: JobSpec['checks']): { checks: Array<{ spec: Record<string, unknown>; required?: boolean }>; protectTests: boolean } {
    const engineChecks: Array<{ spec: Record<string, unknown>; required?: boolean }> = [];
    for (const c of checks ?? []) {
      if (c.kind === 'command') {
        const { cmd, args } = parseCommandArgs(c.run);
        engineChecks.push({
          spec: {
            type: 'command',
            cmd,
            args,
            ...(c.cwd ? { cwd: c.cwd } : {}),
            timeoutMs: 10 * 60 * 1000,
          },
          required: true,
        });
      } else if (c.kind === 'http') {
        engineChecks.push({
          spec: {
            type: 'http',
            url: c.url,
            expectStatus: c.expectStatus,
          },
          required: true,
        });
      }
    }
    return {
      checks: engineChecks,
      protectTests: true,
    };
  }

  async start(spec: JobSpec, options: JobStartOptions = {}): Promise<Result<Job>> {
    if (spec.mode === 'single') {
      return this.startSingle(spec, options);
    }
    if (spec.mode === 'compare') {
      return this.startCompare(spec, options);
    }
    if (spec.mode === 'council') {
      return this.startCouncil(spec, options);
    }
    if (spec.mode === 'autoloop') {
      return this.startAutoloop(spec, options);
    }
    return { ok: false, error: JOB_ERRORS.unsupportedMode((spec as { mode: string }).mode) };
  }

  private async startSingle(spec: Extract<JobSpec, { mode: 'single' }>, options: JobStartOptions): Promise<Result<Job>> {
    const workerAgent: AgentId = spec.workers[0] ?? spec.orchestrator.agent;

    // 1. Pick account
    let accountId: AccountId;
    if (spec.orchestrator.account === 'auto') {
      const pickRes = await this.deps.quota.pickAccount(workerAgent);
      if (!pickRes.ok) {
        return { ok: false, error: pickRes.error };
      }
      if (pickRes.value.kind !== 'account') {
        const reason = pickRes.value.kind === 'wait' ? 'Account limit in force' : pickRes.value.reason;
        return { ok: false, error: JOB_ERRORS.noAccountAvailable(workerAgent, reason) };
      }
      accountId = pickRes.value.accountId;
    } else {
      accountId = spec.orchestrator.account;
    }

    // 2. Get session env
    const envRes = await this.deps.profiles.sessionEnv(accountId);
    if (!envRes.ok) {
      return { ok: false, error: envRes.error };
    }

    // 3. IDs and Worktree
    const jobId = await this.nextJobId();
    const runId = await this.deps.runs.nextRunId();

    const wtRes = await this.deps.git.createWorktree({
      repoPath: spec.repoPath,
      runId: options.worktreeRunId ?? runId,
    });
    if (!wtRes.ok) {
      return { ok: false, error: wtRes.error };
    }
    const { worktreePath, targetBranch } = wtRes.value;

    const nowIso = this.nowIso();

    // 4. Record Job
    const initialStep: JobStep = {
      name: 'Implement',
      index: 1,
      total: 2,
      attempt: 1,
      looping: false,
    };
    const job: Job = {
      id: jobId,
      title: spec.goal,
      spec,
      status: 'running',
      step: initialStep,
      createdAt: nowIso,
      scheduledFor: null,
    };
    await this.deps.store.db.insert(jobTable).values({
      id: job.id,
      title: job.title,
      mode: job.spec.mode,
      spec: job.spec,
      status: job.status,
      step: job.step,
      createdAt: job.createdAt,
      scheduledFor: job.scheduledFor,
    });
    this.emit({ type: 'job.changed', job });

    // 5. Record Run
    const run: Run = {
      id: runId,
      jobId,
      parentId: null,
      depth: 0,
      role: 'implementer',
      task: spec.goal,
      agent: workerAgent,
      accountId,
      status: 'running',
      worktree: `orch/${options.worktreeRunId ?? runId}` as WorktreeId,
      readOnly: false,
      sessionId: null,
      startedAt: nowIso,
      resumesAt: null,
    };
    await this.deps.runs.recordRun(run);
    this.deps.runs.appendLine(runId, 'meta', `Run started on ${workerAgent} (${accountId})`);

    // 6. Build Claw contract from user checks
    const contract = this.buildClawContract(spec.checks);

    // 7. Start workflow in engine
    const pending: WorkflowMeta = { jobId, runId, targetBranch, worktreePath, accountId, ...(options.verifiedBy ? { verifiedBy: options.verifiedBy } : {}) };
    this.pendingStarts.add(pending);
    const workflowRes = await this.deps.engine.request({
      op: 'workflow.start',
      template: 'solve',
      input: {
        task: spec.goal,
        cwd: worktreePath,
        scouts: [{ name: 'scout', engine: workerAgent }],
        implementer: { engine: workerAgent },
        contract,
      },
      envByNode: {
        scout: envRes.value,
        implement: envRes.value,
      },
    });

    this.pendingStarts.delete(pending);
    if (!workflowRes.ok) {
      await this.deps.runs.updateRun(runId, { status: 'failed' });
      await this.deps.store.db.update(jobTable).set({ status: 'failed' }).where(eq(jobTable.id, jobId));
      this.emit({ type: 'job.changed', job: { ...job, status: 'failed' } });
      return { ok: false, error: JOB_ERRORS.engineError(workflowRes.error.message) };
    }

    const workflowHandle = String((workflowRes.value as { workflow?: unknown })?.workflow ?? '');
    if (workflowHandle) {
      this.workflowJobs.set(workflowHandle, {
        jobId,
        runId,
        runIds: [runId],
        targetBranch,
        worktreePath,
        accountId,
        ...(options.verifiedBy ? { verifiedBy: options.verifiedBy } : {}),
      });
    }

    return { ok: true, value: job };
  }

  private findWorkflowMeta(handle: string): WorkflowMeta | undefined {
    for (const [workflowId, meta] of this.workflowJobs) {
      if (handle.includes(workflowId) || (workflowId.length >= 8 && handle.includes(workflowId.slice(0, 8)))) {
        return meta;
      }
    }
    if (this.workflowJobs.size === 1) {
      return this.workflowJobs.values().next().value;
    }
    if (this.pendingStarts.size === 1 && this.workflowJobs.size === 0) {
      return [...this.pendingStarts][0];
    }
    return undefined;
  }

  /** Compare (JOB-09): agents answer the same goal read-only in the main checkout (JOB-03); no worktree, no review. */
  private async startCompare(spec: Extract<JobSpec, { mode: 'compare' }>, options: JobStartOptions): Promise<Result<Job>> {
    const names = spec.agents.map((agent, i) => `${agent}-${i + 1}`);
    const accountIds: AccountId[] = [];
    const envByNode: Record<string, EngineEnv> = {};
    for (const [i, agent] of spec.agents.entries()) {
      const pickRes = await this.deps.quota.pickAccount(agent);
      if (!pickRes.ok) return { ok: false, error: pickRes.error };
      if (pickRes.value.kind !== 'account') {
        const reason = pickRes.value.kind === 'wait' ? 'Account limit in force' : pickRes.value.reason;
        return { ok: false, error: JOB_ERRORS.noAccountAvailable(agent, reason) };
      }
      accountIds.push(pickRes.value.accountId);
      const envRes = await this.deps.profiles.sessionEnv(pickRes.value.accountId);
      if (!envRes.ok) return { ok: false, error: envRes.error };
      envByNode[names[i]!] = envRes.value;
    }

    const jobId = await this.nextJobId();
    let worktreePath = spec.repoPath;
    let targetBranch = '';
    if (options.worktreeRunId) {
      const wt = await this.deps.git.createWorktree({ repoPath: spec.repoPath, runId: options.worktreeRunId });
      if (!wt.ok) return wt;
      worktreePath = wt.value.worktreePath;
      targetBranch = wt.value.targetBranch;
    }
    const nowIso = this.nowIso();
    const job: Job = {
      id: jobId,
      title: spec.goal,
      spec,
      status: 'running',
      step: { name: 'Compare', index: 1, total: spec.combine ? 2 : 1, attempt: 1, looping: false },
      createdAt: nowIso,
      scheduledFor: null,
    };
    await this.insertJob(job);

    const agentRuns = new Map<string, RunId>();
    for (const [i, agent] of spec.agents.entries()) {
      const rId = await this.deps.runs.nextRunId();
      agentRuns.set(names[i]!, rId);
      await this.deps.runs.recordRun({
        id: rId,
        jobId,
        parentId: null,
        depth: 0,
        role: 'implementer',
        task: spec.goal,
        agent,
        accountId: accountIds[i]!,
        status: 'running',
        worktree: options.worktreeRunId ? `orch/${options.worktreeRunId}` as WorktreeId : null,
        readOnly: true,
        sessionId: null,
        startedAt: nowIso,
        resumesAt: null,
      });
      this.deps.runs.appendLine(rId, 'meta', `Run started on ${agent} (${accountIds[i]})`);
    }
    const runIds = [...agentRuns.values()];

    const workflowRes = await this.deps.engine.request({
      op: 'workflow.start',
      template: 'compare',
      input: { task: spec.goal, cwd: worktreePath, agents: spec.agents.map((agent, i) => ({ name: names[i]!, engine: agent })) },
      envByNode,
    });
    if (!workflowRes.ok) {
      for (const rId of runIds) await this.deps.runs.updateRun(rId, { status: 'failed' });
      await this.setJobStatus(job, 'failed');
      return { ok: false, error: JOB_ERRORS.engineError(workflowRes.error.message) };
    }

    const workflowHandle = String((workflowRes.value as { workflow?: unknown })?.workflow ?? '');
    if (workflowHandle) {
      this.workflowJobs.set(workflowHandle, {
        jobId,
        runId: runIds[0]!,
        runIds,
        targetBranch,
        worktreePath,
        accountId: accountIds[0]!,
        ...(options.verifiedBy ? { verifiedBy: options.verifiedBy } : {}),
        agentRuns,
      });
    }
    return { ok: true, value: job };
  }

  private async insertJob(job: Job): Promise<void> {
    await this.deps.store.db.insert(jobTable).values({
      id: job.id,
      title: job.title,
      mode: job.spec.mode,
      spec: job.spec,
      status: job.status,
      step: job.step,
      createdAt: job.createdAt,
      scheduledFor: job.scheduledFor,
    });
    this.emit({ type: 'job.changed', job });
  }

  private async setJobStatus(job: Job, status: Job['status'], step: Job['step'] = job.step): Promise<void> {
    await this.deps.store.db.update(jobTable).set({ status, step }).where(eq(jobTable.id, job.id));
    this.emit({ type: 'job.changed', job: { ...job, status, step } });
  }

  /** Compare finished: each run shows its answer; then the combine pass, or the job is done. */
  private async finishCompare(workflow: string, meta: WorkflowMeta): Promise<void> {
    const jobRes = await this.get(meta.jobId);
    if (!jobRes.ok || jobRes.value.spec.mode !== 'compare') return;
    const job = jobRes.value;
    const spec = jobRes.value.spec;
    const status = await this.deps.engine.request({ op: 'workflow.status', workflow });
    const answers = status.ok ? ((status.value as { answers?: CompareAnswer[] }).answers ?? []) : [];

    const labelled: Array<{ agent: AgentId; text: string }> = [];
    for (const [name, rId] of meta.agentRuns ?? []) {
      const answer = answers.find((a) => a.name === name);
      const run = await this.deps.runs.getRun(rId);
      if (answer?.ok && run) {
        this.deps.runs.appendLine(rId, 'message', answer.output);
        labelled.push({ agent: run.agent, text: answer.output });
      } else if (answer?.output) {
        this.deps.runs.appendLine(rId, 'err', answer.output);
      }
      await this.deps.runs.updateRun(rId, { status: answer?.ok ? 'done' : 'failed' });
    }
    this.endRunSessions(meta.runId);

    if (labelled.length === 0) return this.setJobStatus(job, 'failed');
    if (!spec.combine) return this.setJobStatus(job, 'done');
    await this.combine(job, spec, labelled);
  }

  /**
   * JOB-09 combine: the orchestrator default agent writes one recommendation listing disagreements.
   * ponytail: "first in ACC order with room" is taken over the compare's own agents, in order.
   */
  private async combine(job: Job, spec: Extract<JobSpec, { mode: 'compare' }>, answers: Array<{ agent: AgentId; text: string }>): Promise<void> {
    let picked: { agent: AgentId; accountId: AccountId } | undefined;
    for (const agent of spec.agents) {
      const pick = await this.deps.quota.pickAccount(agent);
      if (pick.ok && pick.value.kind === 'account') {
        picked = { agent, accountId: pick.value.accountId };
        break;
      }
    }
    const step: JobStep = { name: 'Combine', index: 2, total: 2, attempt: 1, looping: false };
    await this.setJobStatus(job, 'running', step);
    const env = picked ? await this.deps.profiles.sessionEnv(picked.accountId) : undefined;
    if (!picked || !env?.ok) return this.setJobStatus(job, 'failed', step);

    const runId = await this.deps.runs.nextRunId();
    await this.deps.runs.recordRun({
      id: runId,
      jobId: job.id,
      parentId: null,
      depth: 0,
      role: 'orchestrator',
      task: spec.goal,
      agent: picked.agent,
      accountId: picked.accountId,
      status: 'running',
      worktree: null,
      readOnly: true,
      sessionId: null,
      startedAt: this.nowIso(),
      resumesAt: null,
    });
    const started = await this.deps.engine.request({ op: 'session.start', agent: picked.agent, cwd: spec.repoPath, env: env.value, readOnly: true });
    const session = started.ok ? String((started.value as { session?: unknown }).session ?? '') : '';
    const reply = session
      ? await this.deps.engine.request({ op: 'session.send', session, text: COMPARE_COMBINE(spec.goal, answers) })
      : started;
    if (session) void this.deps.engine.request({ op: 'session.stop', session });
    if (!reply.ok) {
      this.deps.runs.appendLine(runId, 'err', reply.error.message);
      await this.deps.runs.updateRun(runId, { status: 'failed' });
      return this.setJobStatus(job, 'failed', step);
    }
    this.deps.runs.appendLine(runId, 'message', String((reply.value as { output?: unknown }).output ?? ''));
    await this.deps.runs.updateRun(runId, { status: 'done' });
    await this.setJobStatus(job, 'done', step);
  }

  private async startCouncil(spec: Extract<JobSpec, { mode: 'council' }>, options: JobStartOptions): Promise<Result<Job>> {
    // 1. Pick account and session env for each agent
    const accountIds: Record<string, AccountId> = {};
    const envByNode: Record<string, EngineEnv> = {};
    for (const agent of spec.agents) {
      const pickRes = await this.deps.quota.pickAccount(agent);
      if (!pickRes.ok) return { ok: false, error: pickRes.error };
      if (pickRes.value.kind !== 'account') {
        const reason = pickRes.value.kind === 'wait' ? 'Account limit in force' : pickRes.value.reason;
        return { ok: false, error: JOB_ERRORS.noAccountAvailable(agent, reason) };
      }
      accountIds[agent] = pickRes.value.accountId;
      const envRes = await this.deps.profiles.sessionEnv(pickRes.value.accountId);
      if (!envRes.ok) return { ok: false, error: envRes.error };
      envByNode[agent] = envRes.value;
    }

    // 2. IDs and Worktree
    const jobId = await this.nextJobId();
    const primaryRunId = await this.deps.runs.nextRunId();
    const wtRes = await this.deps.git.createWorktree({
      repoPath: spec.repoPath,
      runId: options.worktreeRunId ?? primaryRunId,
    });
    if (!wtRes.ok) return { ok: false, error: wtRes.error };
    const { worktreePath, targetBranch } = wtRes.value;
    const nowIso = this.nowIso();

    // 3. Record Job
    const initialStep: JobStep = {
      name: 'Council',
      index: 1,
      total: spec.maxRounds,
      attempt: 1,
      looping: false,
    };
    const job: Job = {
      id: jobId,
      title: spec.goal,
      spec,
      status: 'running',
      step: initialStep,
      createdAt: nowIso,
      scheduledFor: null,
    };
    await this.deps.store.db.insert(jobTable).values({
      id: job.id,
      title: job.title,
      mode: job.spec.mode,
      spec: job.spec,
      status: job.status,
      step: job.step,
      createdAt: job.createdAt,
      scheduledFor: job.scheduledFor,
    });
    this.emit({ type: 'job.changed', job });

    // 4. Record Runs for each council member
    const runIds: RunId[] = [];
    for (let i = 0; i < spec.agents.length; i++) {
      const agent = spec.agents[i]!;
      const accountId = accountIds[agent]!;
      const rId = i === 0 ? primaryRunId : await this.deps.runs.nextRunId();
      runIds.push(rId);
      const run: Run = {
        id: rId,
        jobId,
        parentId: null,
        depth: 0,
        role: 'member',
        task: spec.goal,
        agent,
        accountId,
        status: 'running',
        worktree: `orch/${options.worktreeRunId ?? primaryRunId}` as WorktreeId,
        readOnly: false,
        sessionId: null,
        startedAt: nowIso,
        resumesAt: null,
      };
      await this.deps.runs.recordRun(run);
      this.deps.runs.appendLine(rId, 'meta', `Council member started on ${agent} (${accountId})`);
    }

    // 5. Build Contract
    const contract = this.buildClawContract(spec.checks);

    // 6. Start workflow in engine
    const workflowRes = await this.deps.engine.request({
      op: 'workflow.start',
      template: 'council',
      input: {
        task: spec.goal,
        cwd: worktreePath,
        agents: spec.agents.map((a) => ({ name: a, engine: a })),
        maxRounds: spec.maxRounds,
        contract,
      },
      envByNode,
    });

    if (!workflowRes.ok) {
      for (const rId of runIds) {
        await this.deps.runs.updateRun(rId, { status: 'failed' });
      }
      await this.deps.store.db.update(jobTable).set({ status: 'failed' }).where(eq(jobTable.id, jobId));
      this.emit({ type: 'job.changed', job: { ...job, status: 'failed' } });
      return { ok: false, error: JOB_ERRORS.engineError(workflowRes.error.message) };
    }

    const workflowHandle = String((workflowRes.value as { workflow?: unknown })?.workflow ?? '');
    if (workflowHandle) {
      this.workflowJobs.set(workflowHandle, {
        jobId,
        runId: primaryRunId,
        runIds,
        targetBranch,
        worktreePath,
        accountId: accountIds[spec.agents[0]!]!,
        ...(options.verifiedBy ? { verifiedBy: options.verifiedBy } : {}),
      });
    }

    return { ok: true, value: job };
  }

  private async startAutoloop(spec: Extract<JobSpec, { mode: 'autoloop' }>, options: JobStartOptions): Promise<Result<Job>> {
    const roles = ['planner', 'coder', 'reviewer'] as const;
    const accountIds: Record<string, AccountId> = {};
    const envByNode: Record<string, EngineEnv> = {};
    for (const r of roles) {
      const agent = spec.roles[r];
      const pickRes = await this.deps.quota.pickAccount(agent);
      if (!pickRes.ok) return { ok: false, error: pickRes.error };
      if (pickRes.value.kind !== 'account') {
        const reason = pickRes.value.kind === 'wait' ? 'Account limit in force' : pickRes.value.reason;
        return { ok: false, error: JOB_ERRORS.noAccountAvailable(agent, reason) };
      }
      accountIds[r] = pickRes.value.accountId;
      const envRes = await this.deps.profiles.sessionEnv(pickRes.value.accountId);
      if (!envRes.ok) return { ok: false, error: envRes.error };
      envByNode[r] = envRes.value;
    }

    // 2. IDs and Worktree
    const jobId = await this.nextJobId();
    const primaryRunId = await this.deps.runs.nextRunId();
    const wtRes = await this.deps.git.createWorktree({
      repoPath: spec.repoPath,
      runId: options.worktreeRunId ?? primaryRunId,
    });
    if (!wtRes.ok) return { ok: false, error: wtRes.error };
    const { worktreePath, targetBranch } = wtRes.value;
    const nowIso = this.nowIso();

    // 3. Record Job
    const initialStep: JobStep = {
      name: 'Plan',
      index: 1,
      total: 3,
      attempt: 1,
      looping: false,
    };
    const job: Job = {
      id: jobId,
      title: spec.goal,
      spec,
      status: 'running',
      step: initialStep,
      createdAt: nowIso,
      scheduledFor: null,
    };
    await this.deps.store.db.insert(jobTable).values({
      id: job.id,
      title: job.title,
      mode: job.spec.mode,
      spec: job.spec,
      status: job.status,
      step: job.step,
      createdAt: job.createdAt,
      scheduledFor: job.scheduledFor,
    });
    this.emit({ type: 'job.changed', job });

    // 4. Record Runs for each role
    const runIds: RunId[] = [];
    for (let i = 0; i < roles.length; i++) {
      const r = roles[i]!;
      const agent = spec.roles[r];
      const accountId = accountIds[r]!;
      const rId = i === 0 ? primaryRunId : await this.deps.runs.nextRunId();
      runIds.push(rId);
      const run: Run = {
        id: rId,
        jobId,
        parentId: null,
        depth: 0,
        role: r,
        task: spec.goal,
        agent,
        accountId,
        status: 'running',
        worktree: `orch/${options.worktreeRunId ?? primaryRunId}` as WorktreeId,
        readOnly: r === 'planner' || r === 'reviewer',
        sessionId: null,
        startedAt: nowIso,
        resumesAt: null,
      };
      await this.deps.runs.recordRun(run);
      this.deps.runs.appendLine(rId, 'meta', `Autoloop ${r} started on ${agent} (${accountId})`);
    }

    // 5. Start workflow in engine
    const workflowRes = await this.deps.engine.request({
      op: 'workflow.start',
      template: 'autoloop',
      input: {
        cwd: worktreePath,
        goal: spec.goal,
        plannerEngine: spec.roles.planner,
        coderEngine: spec.roles.coder,
        reviewerEngine: spec.roles.reviewer,
      },
      envByNode,
    });

    if (!workflowRes.ok) {
      for (const rId of runIds) {
        await this.deps.runs.updateRun(rId, { status: 'failed' });
      }
      await this.deps.store.db.update(jobTable).set({ status: 'failed' }).where(eq(jobTable.id, jobId));
      this.emit({ type: 'job.changed', job: { ...job, status: 'failed' } });
      return { ok: false, error: JOB_ERRORS.engineError(workflowRes.error.message) };
    }

    const workflowHandle = String((workflowRes.value as { workflow?: unknown })?.workflow ?? '');
    if (workflowHandle) {
      this.workflowJobs.set(workflowHandle, {
        jobId,
        runId: primaryRunId,
        runIds,
        targetBranch,
        worktreePath,
        accountId: accountIds.planner!,
        ...(options.verifiedBy ? { verifiedBy: options.verifiedBy } : {}),
      });
    }

    return { ok: true, value: job };
  }

  /**
   * The run an engine session belongs to. A session seen for the first time is
   * assigned to its workflow run and recorded as an orch session (SES).
   */
  private async trackSession(handle: string, cliSessionId: string | undefined): Promise<RunId | undefined> {
    const meta = this.findWorkflowMeta(handle);
    const knownRunId = this.sessionRuns.get(handle);

    if (knownRunId) {
      if (cliSessionId && meta) {
        await this.recordSession(handle, meta, cliSessionId);
      }
      return knownRunId;
    }

    if (!meta) return undefined;
    const runId = [...(meta.agentRuns ?? [])].find(([name]) => handle.endsWith(`-${name}`))?.[1] ?? meta.runId;
    this.sessionRuns.set(handle, runId);
    const recorded = await this.recordSession(handle, meta, cliSessionId);
    if (handle.startsWith('s-')) {
      await this.deps.runs.updateRun(runId, { sessionId: handle as SessionId });
    } else if (recorded) {
      await this.deps.runs.updateRun(runId, { sessionId: recorded.id });
    }
    return runId;
  }

  /** Ends the engine sessions of a finished run, so orch sessions shows them as ended. */
  private endRunSessions(runId: RunId): void {
    for (const [handle, owner] of this.sessionRuns) {
      if (owner === runId) this.deps.sessions?.applyEngineStatus(handle, 'stopped');
    }
  }

  private async recordSession(handle: string, meta: WorkflowMeta, cliSessionId: string | undefined): Promise<Session | undefined> {
    if (!this.deps.sessions) return undefined;
    const jobRes = await this.get(meta.jobId);
    const run = await this.deps.runs.getRun(meta.runId);
    if (!jobRes.ok || !run) return undefined;
    return this.deps.sessions.recordEngineSession({
      engineHandle: handle,
      jobId: meta.jobId,
      runId: meta.runId,
      title: jobRes.value.title,
      agent: run.agent,
      accountId: run.accountId,
      worktree: run.worktree,
      cwd: meta.worktreePath,
      position: positionOf(jobRes.value.step),
      ...(cliSessionId ? { cliSessionId } : {}),
    });
  }

  /**
   * QTA-03 onLimit 'switch-agent': hands the paused run to another agent from the
   * job's workers, in workers order, that has a usable account (SES-02, same worktree).
   * No other agent with room: the run stays paused, and auto-resume applies as before.
   */
  private async switchAgent(runId: RunId, workers: readonly AgentId[]): Promise<void> {
    const run = await this.deps.runs.getRun(runId);
    if (!run || !run.sessionId || !this.deps.sessions) return;
    for (const agent of workers) {
      if (agent === run.agent) continue;
      const pick = await this.deps.quota.pickAccount(agent);
      if (!pick.ok || pick.value.kind !== 'account') continue;
      const accountId = pick.value.accountId;
      const handed = await this.deps.sessions.handOffEngineSession(run.sessionId, accountId);
      if (!handed.ok) continue;

      const newHandle = handed.value.engineHandle;
      this.sessionRuns.set(newHandle, runId);
      const newSessionId = newHandle.startsWith('s-') ? (newHandle as SessionId) : handed.value.session.id;
      await this.deps.runs.updateRun(runId, { agent, accountId, sessionId: newSessionId, status: 'running', resumesAt: null });
      this.deps.runs.appendLine(runId, 'meta', `Handed off to ${agent} (${accountId}) in the same worktree`);
      void this.deps.engine.request({ op: 'session.send', session: newHandle, text: TAKE_OVER_AFTER_LIMIT(run.task) });
      return;
    }
  }

  private async onEngineEvent(event: EngineEvent): Promise<void> {
    switch (event.type) {
      case 'session.status': {
        const runId = await this.trackSession(event.session, event.cliSessionId);
        if (runId) {
          if (event.session.startsWith('s-')) {
            await this.deps.runs.updateRun(runId, { sessionId: event.session as SessionId });
          }
          this.deps.sessions?.applyEngineStatus(event.session, event.status);
          await this.verifyAfterResume(runId, event.status);
          if (event.status === 'running') {
            const run = await this.deps.runs.getRun(runId);
            if (run) {
              const job = await this.get(run.jobId);
              if (job.ok && job.value.status === 'waiting_quota') await this.setJobStatus(job.value, 'running');
            }
          }
        }
        break;
      }

      case 'session.output': {
        const runId = await this.trackSession(event.session, undefined);
        if (!runId) return;

        const run = await this.deps.runs.getRun(runId);
        if (!run) return;

        // 1. Append line
        this.deps.runs.appendLine(runId, toRunLineKind(event.kind), event.text);

        // 2. Parse quota signal
        const adapter = this.getAdapter(run.agent);
        const signal = adapter.parseQuotaSignal(run.accountId, event.text);
        if (signal && signal.limited) {
          if (this.deps.quota.observe) {
            this.deps.quota.observe(signal);
          }
          this.deps.runs.appendLine(runId, 'limit', event.text);
          // QTA-03: pause, keep worktree and session. QTA-04: arms auto-resume at reset + jitter.
          await this.deps.runs.pauseForLimit(runId, signal.resetsAt ?? null);
          const limitedMeta = [...this.workflowJobs.values()].find((m) => m.runId === runId);
          if (limitedMeta) this.limitedRuns.set(runId, { meta: limitedMeta, resumed: false });

          // Check onLimit policy. switch-account and switch-agent move the run now; 'ask'
          // leaves it paused_limit until the user resumes it or auto-resume fires.
          const jobRes = await this.get(run.jobId);
          if (jobRes.ok) {
            const onLimit = jobRes.value.spec.onLimit;
            if (onLimit === 'switch-account') {
              const pickRes = await this.deps.quota.pickAccount(run.agent);
              if (pickRes.ok && pickRes.value.kind === 'account' && pickRes.value.accountId !== run.accountId) {
                await this.deps.runs.resumeOn(runId, pickRes.value.accountId);
              }
            } else if (onLimit === 'switch-agent' && jobRes.value.spec.mode === 'single') {
              await this.switchAgent(runId, jobRes.value.spec.workers);
            } else if (onLimit === 'ask') {
              this.emit({ type: 'run.attention', runId, reason: 'limit_ask' });
            }
            const currentRun = await this.deps.runs.getRun(runId);
            if (currentRun?.status === 'paused_limit') await this.setJobStatus(jobRes.value, 'waiting_quota');
          }
        }
        break;
      }

      case 'workflow.node': {
        const meta = this.workflowJobs.get(event.workflow);
        if (!meta) return;

        const jobRes = await this.get(meta.jobId);
        if (!jobRes.ok) return;

        const stepName = event.node.charAt(0).toUpperCase() + event.node.slice(1);
        const step: JobStep = {
          name: stepName,
          index: event.node === 'verify' ? 2 : 1,
          total: 2,
          attempt: event.attempts > 0 ? event.attempts : 1,
          looping: event.attempts > 1,
        };

        await this.deps.store.db
          .update(jobTable)
          .set({ step })
          .where(eq(jobTable.id, meta.jobId));
        this.emit({ type: 'job.changed', job: { ...jobRes.value, step } });
        break;
      }

      case 'verdict': {
        const meta = this.workflowJobs.get(event.workflow);
        if (!meta) return;
        this.workflowJobs.delete(event.workflow);
        // A run that hit a limit left this workflow; its verdict comes from verifyAfterResume (F-04, F-06).
        if (this.limitedRuns.has(meta.runId)) return;
        if (meta.agentRuns) return this.finishCompare(event.workflow, meta);
        await this.recordVerdict(meta, event.verdict, event.evidenceRef);
        break;
      }
    }
  }

  /** F-06: verify a run resumed outside its workflow when its first turn after the resume ends. */
  private async verifyAfterResume(runId: RunId, status: string): Promise<void> {
    const limited = this.limitedRuns.get(runId);
    if (!limited) return;
    const run = await this.deps.runs.getRun(runId);
    if (run?.status !== 'running') return;
    if (status === 'running') {
      limited.resumed = true;
      return;
    }
    if (status !== 'idle' || !limited.resumed) return;
    this.limitedRuns.delete(runId);

    const jobRes = await this.get(limited.meta.jobId);
    if (!jobRes.ok) return;
    const verify = await this.deps.engine.request({
      op: 'verify.run',
      cwd: limited.meta.worktreePath,
      contract: this.buildClawContract(jobRes.value.spec.checks),
    });
    if (!verify.ok) {
      this.deps.runs.appendLine(runId, 'err', verify.error.message);
      await this.recordVerdict(limited.meta, 'unverified', null);
      return;
    }
    const { passed, evidenceId } = verify.value as { passed?: boolean; evidenceId?: string };
    await this.recordVerdict(limited.meta, passed ? 'verified' : 'refuted', evidenceId ?? null);
  }

  /** Records a verdict with the always-on guardrails (JOB-05, JOB-06): review row, run and job status. */
  private async recordVerdict(meta: WorkflowMeta, verdict: Verdict, evidenceRef: string | null): Promise<void> {
    const run = await this.deps.runs.getRun(meta.runId);
    const jobRes = await this.get(meta.jobId);
    if (!jobRes.ok) return;
    const job = jobRes.value;
    this.endRunSessions(meta.runId);

    // The spec runner owns the complete verify + audit cycle. A spec job only
    // reports that its implementation turn ended; publishing a job verdict here
    // would let an empty JobSpec.checks list appear verified in Review.
    if (meta.verifiedBy === 'spec') {
      await this.deps.store.db.update(jobTable).set({ status: 'done' }).where(eq(jobTable.id, meta.jobId));
      this.emit({ type: 'job.changed', job: { ...job, status: 'done' } });
      const runIdsToUpdate = meta.runIds ?? (run ? [run.id] : []);
      for (const rId of runIdsToUpdate) await this.deps.runs.updateRun(rId, { status: 'done' });
      return;
    }

    // Evaluate guardrails
    const diffRes = await this.deps.git.getDiff(meta.worktreePath, meta.targetBranch);
    const diff = diffRes.ok ? diffRes.value : '';
    const guardrails = evaluateGuardrails(diff, [], job.spec.checks ?? []);

    // The guardrails and file rules are judged from the diff here; the spec lists them too, so skip them below.
    const declared = (job.spec.checks ?? []).filter((c) => c.kind !== 'guardrail' && c.kind !== 'file_rule');
    let finalVerdict = verdict;
    if (!diffRes.ok) {
      finalVerdict = 'unverified';
    } else if (!guardrails.passed) {
      finalVerdict = 'refuted';
    } else if (declared.length === 0) {
      // Claw reports "unverified" for a contract with no checks: the guardrails are all there is to verify.
      finalVerdict = 'verified';
    }

    // Get changed files
    const filesRes = await this.deps.git.getChangedFiles(meta.worktreePath, meta.targetBranch);
    const files: ChangedFile[] = filesRes.ok ? filesRes.value : [];

    // Build CheckResult list
    const checkResults: CheckResult[] = [
      guardrails.suppressionsResult,
      guardrails.protectedFilesResult,
      ...guardrails.fileRuleResults,
    ];
    // ponytail: per-check results come back as one verdict; each check shows that verdict.
    for (const c of declared) {
      checkResults.push(
        verdict === 'unverified'
          ? { check: c, status: 'not_run', summary: JOB_CHECK_COPY.notRun }
          : { check: c, status: verdict === 'verified' ? 'passed' : 'failed', summary: verdict === 'verified' ? JOB_CHECK_COPY.passed : JOB_CHECK_COPY.failed },
      );
    }

    const worktreeId = (run?.worktree ?? `orch/${meta.runId}`) as WorktreeId;
    const reviewState: WorktreeState = finalVerdict === 'refuted' ? 'failing' : 'ready';

    const review: WorktreeReview = {
      worktree: worktreeId,
      jobId: meta.jobId,
      runId: meta.runId,
      sessionId: run?.sessionId ?? null,
      title: job.title,
      state: reviewState,
      verdict: finalVerdict,
      checks: checkResults,
      files,
      evidenceRef,
      note: null,
    };

    // Write review to store
    await this.deps.store.db
      .insert(reviewTable)
      .values({
        worktree: review.worktree,
        jobId: review.jobId,
        runId: review.runId,
        sessionId: review.sessionId,
        title: review.title,
        state: review.state,
        verdict: review.verdict,
        checks: review.checks,
        files: review.files,
        evidenceRef: review.evidenceRef,
        note: review.note,
      })
      .onConflictDoUpdate({
        target: reviewTable.worktree,
        set: {
          state: review.state,
          verdict: review.verdict,
          checks: review.checks,
          files: review.files,
          evidenceRef: review.evidenceRef,
        },
      });
    this.emit({ type: 'review.changed', review });

    // Update Job and Run statuses
    const newStatus = finalVerdict === 'refuted' ? 'failed' : 'done';
    await this.deps.store.db
      .update(jobTable)
      .set({ status: newStatus })
      .where(eq(jobTable.id, meta.jobId));
    this.emit({ type: 'job.changed', job: { ...job, status: newStatus } });

    const runIdsToUpdate = meta.runIds ?? (run ? [run.id] : []);
    for (const rId of runIdsToUpdate) {
      await this.deps.runs.updateRun(rId, { status: newStatus });
    }

  }

  /** Persists the spec runner's verify + audit outcome as the sole Review verdict for its worktree. */
  async recordSpecVerdict(spec: SpecRun, jobId: JobId, criterionResults: readonly CriterionResult[], success: boolean, failureLines: readonly string[] = []): Promise<void> {
    const jobRes = await this.get(jobId);
    if (!jobRes.ok) return;
    const runRes = await this.deps.runs.list(jobId);
    const run = runRes.ok ? runRes.value.find((candidate) => candidate.worktree === `orch/spec-${spec.id}`) : undefined;
    const worktree = `orch/spec-${spec.id}` as WorktreeId;
    const worktreePath = path.join(jobRes.value.spec.repoPath, '.orch', 'wt', `spec-${spec.id}`);
    const branchRes = await this.deps.git.getDefaultBranch(jobRes.value.spec.repoPath);
    const branch = branchRes.ok ? branchRes.value : 'main';
    const diffRes = await this.deps.git.getDiff(worktreePath, branch);
    const filesRes = await this.deps.git.getChangedFiles(worktreePath, branch);
    const diff = diffRes.ok ? diffRes.value : '';
    const guardrails = evaluateGuardrails(diff, spec.spec.scope);
    const hasChanges = filesRes.ok && filesRes.value.length > 0;
    const verdict: Verdict = success && diffRes.ok && hasChanges && guardrails.passed ? 'verified' : 'refuted';
    const checks: CheckResult[] = [
      guardrails.suppressionsResult,
      guardrails.protectedFilesResult,
      ...guardrails.fileRuleResults,
    ];
    for (const [index, item] of spec.spec.done_when.entries()) {
      if (item.by !== 'check') continue;
      const result = criterionResults.find((criterion) => criterion.index === index);
      const passed = result?.state === 'met';
      checks.push({ check: item.check, status: passed ? 'passed' : 'failed', summary: result?.summary ?? 'Not run' });
    }
    const failedCriterion = spec.spec.done_when.find((_, index) => criterionResults.find((result) => result.index === index)?.state === 'not_met');
    const failedResult = failedCriterion ? criterionResults.find((result) => result.index === spec.spec.done_when.indexOf(failedCriterion)) : undefined;
    const firstFailure = failedCriterion ? `${failedCriterion.text}${failedResult?.summary ? ` (${failedResult.summary})` : ''}` : failureLines[0];
    const review: WorktreeReview = {
      worktree,
      jobId,
      runId: run?.id ?? (`spec-${spec.id}` as RunId),
      sessionId: run?.sessionId ?? null,
      title: spec.spec.title,
      state: verdict === 'verified' ? 'ready' : 'failing',
      verdict,
      checks,
      files: filesRes.ok ? filesRes.value : [],
      evidenceRef: JSON.stringify({ criteria: criterionResults, guardrails: { suppressions: guardrails.suppressionsResult, protectedFiles: guardrails.protectedFilesResult, fileRules: guardrails.fileRuleResults } }),
      note: verdict === 'refuted' ? `Spec ${spec.id} isn't verified: ${firstFailure ?? (!hasChanges ? 'The agent made no changes.' : 'Guardrails failed')}.` : null,
    };
    await this.deps.store.db.insert(reviewTable).values({
      worktree: review.worktree, jobId: review.jobId, runId: review.runId, sessionId: review.sessionId,
      title: review.title, state: review.state, verdict: review.verdict, checks: review.checks,
      files: review.files, evidenceRef: review.evidenceRef, note: review.note,
    }).onConflictDoUpdate({
      target: reviewTable.worktree,
      set: { state: review.state, verdict: review.verdict, checks: review.checks, files: review.files, evidenceRef: review.evidenceRef, note: review.note },
    });
    this.emit({ type: 'review.changed', review });
  }

  async markSpecMerged(specId: string): Promise<void> {
    const worktree = `orch/spec-${specId}` as WorktreeId;
    const current = await this.deps.store.db.select().from(reviewTable).where(eq(reviewTable.worktree, worktree)).get();
    if (!current) return;
    await this.deps.store.db.update(reviewTable).set({ state: 'merged' }).where(eq(reviewTable.worktree, worktree));
    this.emit({ type: 'review.changed', review: { ...toWorktreeReview(current), state: 'merged' } });
  }

  async markSpecRefuted(specId: string, reason: string): Promise<void> {
    const worktree = `orch/spec-${specId}` as WorktreeId;
    const current = await this.deps.store.db.select().from(reviewTable).where(eq(reviewTable.worktree, worktree)).get();
    if (!current) return;
    const note = `Spec ${specId} isn't verified: ${reason.replace(/[.\s]+$/, '')}.`;
    await this.deps.store.db.update(reviewTable).set({ state: 'failing', verdict: 'refuted', note }).where(eq(reviewTable.worktree, worktree));
    this.emit({ type: 'review.changed', review: { ...toWorktreeReview(current), state: 'failing', verdict: 'refuted', note } });
  }
}
