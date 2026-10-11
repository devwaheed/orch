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

export class JobsService implements IJobsService {
  private readonly emitter = new Emitter<OrchEvent>();
  readonly onEvent: Event<OrchEvent> = this.emitter.event;

  /** Active workflows mapped to jobId and runId */
  private readonly workflowJobs = new Map<string, { jobId: JobId; runId: RunId; targetBranch: string; worktreePath: string; accountId: AccountId }>();
  private readonly sessionRuns = new Map<string, RunId>();

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

  private async onEngineEvent(event: EngineEvent): Promise<void> {
    switch (event.type) {
      case 'session.status': {
        const runId = this.sessionRuns.get(event.session);
        if (runId) {
          await this.deps.runs.updateRun(runId, { sessionId: event.session as SessionId });
        }
        break;
      }

      case 'session.output': {
        let runId = this.sessionRuns.get(event.session);
        if (!runId) {
          // If not tracked by session handle directly, check active workflow runs
          for (const meta of this.workflowJobs.values()) {
            runId = meta.runId;
            this.sessionRuns.set(event.session, runId);
            break;
          }
        }
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
          await this.deps.runs.updateRun(runId, {
            status: 'paused_limit',
            resumesAt: signal.resetsAt ?? null,
          });

          // Check onLimit policy
          const jobRes = await this.get(run.jobId);
          if (jobRes.ok) {
            const onLimit = jobRes.value.spec.onLimit;
            if (onLimit === 'switch-account') {
              const pickRes = await this.deps.quota.pickAccount(run.agent);
              if (pickRes.ok && pickRes.value.kind === 'account' && pickRes.value.accountId !== run.accountId) {
                await this.deps.runs.resumeOn(runId, pickRes.value.accountId);
              }
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
