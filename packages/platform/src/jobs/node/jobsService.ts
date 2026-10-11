import { eq } from 'drizzle-orm';
import { Emitter, type Event } from '@orch/base';
import {
  type AccountId,
  type AgentAdapter,
  type AgentId,
  type ChangedFile,
  type CheckResult,
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
  type SessionId,
  type Timestamp,
  type WorktreeId,
  type WorktreeReview,
  type WorktreeState,
  type IQuotaService,
} from '@orch/contracts';
import { jobTable, reviewTable } from '../../store/common/schema.js';
import type { IStoreService } from '../../store/common/store.js';
import type { IProfilesService } from '../../profiles/common/profiles.js';
import type { EngineClient } from '../../engine/common/engineClient.js';
import type { IGitService } from '../../git/common/git.js';
import type { RunsService } from '../../runs/node/runsService.js';
import type { IEngineSessionRecorder } from '../../sessions/node/sessionsService.js';
import {
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

interface WorkflowMeta {
  jobId: JobId;
  runId: RunId;
  targetBranch: string;
  worktreePath: string;
  accountId: AccountId;
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

  async start(spec: JobSpec): Promise<Result<Job>> {
    if (spec.mode !== 'single') {
      return { ok: false, error: JOB_ERRORS.unsupportedMode(spec.mode) };
    }

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
      runId,
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
      worktree: `orch/${runId}` as WorktreeId,
      readOnly: false,
      sessionId: null,
      startedAt: nowIso,
      resumesAt: null,
    };
    await this.deps.runs.recordRun(run);
    this.deps.runs.appendLine(runId, 'meta', `Run started on ${workerAgent} (${accountId})`);

    // 6. Build Claw contract from user checks
    const engineChecks: Array<{ spec: Record<string, unknown>; required?: boolean }> = [];
    for (const c of spec.checks) {
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

    const contract = {
      checks: engineChecks,
      protectTests: true,
    };

    // 7. Start workflow in engine
    const pending: WorkflowMeta = { jobId, runId, targetBranch, worktreePath, accountId };
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
        targetBranch,
        worktreePath,
        accountId,
      });
    }

    return { ok: true, value: job };
  }

  /**
   * The run an engine session belongs to. A session seen for the first time is
   * assigned to the first active workflow run and recorded as an orch session (SES).
   */
  private async trackSession(handle: string, cliSessionId: string | undefined): Promise<RunId | undefined> {
    const known = this.sessionRuns.get(handle);
    if (known) return known;
    const meta = [...this.workflowJobs.values(), ...this.pendingStarts][0];
    if (!meta) return undefined;
    this.sessionRuns.set(handle, meta.runId);
    await this.deps.runs.updateRun(meta.runId, { sessionId: handle as SessionId });
    await this.recordSession(handle, meta, cliSessionId);
    return meta.runId;
  }

  /**
   * The engine reports a workflow's agent turns in its ledger, not as session events,
   * so the sessions a workflow ran are read from the ledger (ledger.query) and recorded
   * for its run. Rows from before the job started are skipped; a session already
   * assigned to a run is never reassigned.
   */
  private async syncWorkflowSessions(meta: WorkflowMeta, since: Timestamp): Promise<void> {
    if (!this.deps.sessions) return;
    const reply = await this.deps.engine.request({ op: 'ledger.query', since });
    if (!reply.ok) return;
    const rows = (reply.value as { rows?: Array<{ session?: unknown }> } | null)?.rows ?? [];
    for (const row of rows) {
      if (typeof row.session !== 'string' || row.session.length === 0 || this.sessionRuns.has(row.session)) continue;
      this.sessionRuns.set(row.session, meta.runId);
      await this.recordSession(row.session, meta, undefined);
    }
  }

  /** Ends the engine sessions of a finished run, so orch sessions shows them as ended. */
  private endRunSessions(runId: RunId): void {
    for (const [handle, owner] of this.sessionRuns) {
      if (owner === runId) this.deps.sessions?.applyEngineStatus(handle, 'stopped');
    }
  }

  private async recordSession(handle: string, meta: WorkflowMeta, cliSessionId: string | undefined): Promise<void> {
    if (!this.deps.sessions) return;
    const jobRes = await this.get(meta.jobId);
    const run = await this.deps.runs.getRun(meta.runId);
    if (!jobRes.ok || !run) return;
    this.deps.sessions.recordEngineSession({
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
      this.setWorkflowAccount(runId, accountId);
      await this.deps.runs.updateRun(runId, { agent, accountId, sessionId: newHandle as SessionId, status: 'running', resumesAt: null });
      this.deps.runs.appendLine(runId, 'meta', `Handed off to ${agent} (${accountId}) in the same worktree`);
      return;
    }
  }

  private setWorkflowAccount(runId: RunId, accountId: AccountId): void {
    for (const meta of this.workflowJobs.values()) {
      if (meta.runId === runId) meta.accountId = accountId;
    }
  }

  private async onEngineEvent(event: EngineEvent): Promise<void> {
    switch (event.type) {
      case 'session.status': {
        const runId = await this.trackSession(event.session, event.cliSessionId);
        if (runId) {
          await this.deps.runs.updateRun(runId, { sessionId: event.session as SessionId });
          this.deps.sessions?.applyEngineStatus(event.session, event.status);
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

          // Check onLimit policy. switch-account and switch-agent move the run now; 'ask'
          // leaves it paused_limit until the user resumes it or auto-resume fires.
          const jobRes = await this.get(run.jobId);
          if (jobRes.ok) {
            const onLimit = jobRes.value.spec.onLimit;
            if (onLimit === 'switch-account') {
              const pickRes = await this.deps.quota.pickAccount(run.agent);
              if (pickRes.ok && pickRes.value.kind === 'account' && pickRes.value.accountId !== run.accountId) {
                const resumed = await this.deps.runs.resumeOn(runId, pickRes.value.accountId);
                if (resumed.ok) this.setWorkflowAccount(runId, pickRes.value.accountId);
              }
            } else if (onLimit === 'switch-agent' && jobRes.value.spec.mode === 'single') {
              await this.switchAgent(runId, jobRes.value.spec.workers);
            }
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
        if (event.state === 'done') await this.syncWorkflowSessions(meta, jobRes.value.createdAt);
        break;
      }

      case 'verdict': {
        const meta = this.workflowJobs.get(event.workflow);
        if (!meta) return;

        const run = await this.deps.runs.getRun(meta.runId);
        if (run && (run.status === 'paused_limit' || run.accountId !== meta.accountId)) {
          this.workflowJobs.delete(event.workflow);
          return;
        }

        const jobRes = await this.get(meta.jobId);
        if (!jobRes.ok) return;
        const job = jobRes.value;
        await this.syncWorkflowSessions(meta, job.createdAt);
        this.endRunSessions(meta.runId);

        // Evaluate guardrails
        const diffRes = await this.deps.git.getDiff(meta.worktreePath, meta.targetBranch);
        const diff = diffRes.ok ? diffRes.value : '';
        const guardrails = evaluateGuardrails(diff);

        let finalVerdict = event.verdict;
        if (!guardrails.passed) {
          finalVerdict = 'refuted';
        }

        // Get changed files
        const filesRes = await this.deps.git.getChangedFiles(meta.worktreePath, meta.targetBranch);
        const files: ChangedFile[] = filesRes.ok ? filesRes.value : [];

        // Build CheckResult list
        const checkResults: CheckResult[] = [
          guardrails.suppressionsResult,
          guardrails.protectedFilesResult,
        ];
        for (const c of job.spec.checks) {
          checkResults.push({
            check: c,
            status: finalVerdict === 'verified' ? 'passed' : 'failed',
            summary: finalVerdict === 'verified' ? 'Passed' : 'Failed check',
          });
        }

        const worktreeId = (run?.worktree ?? `orch/${meta.runId}`) as WorktreeId;
        const reviewState: WorktreeState = finalVerdict === 'verified' ? 'ready' : 'failing';

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
          evidenceRef: event.evidenceRef,
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
        const newStatus = finalVerdict === 'verified' ? 'done' : 'failed';
        await this.deps.store.db
          .update(jobTable)
          .set({ status: newStatus })
          .where(eq(jobTable.id, meta.jobId));
        this.emit({ type: 'job.changed', job: { ...job, status: newStatus } });

        if (run) {
          await this.deps.runs.updateRun(run.id, { status: newStatus });
        }

        this.workflowJobs.delete(event.workflow);
        break;
      }
    }
  }
}
