import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { Emitter, type Event } from '@orch/base';
import type {
  AgentId,
  Check,
  CheckResult,
  CorrectionLayer,
  Job,
  JobId,
  JobStep,
  OrchEvent,
  Result,
  RunId,
  SessionId,
  Timestamp,
  TrustLevel,
  Verdict,
  WorktreeId,
  WorktreeReview,
  WorktreeState,
  IReviewService,
} from '@orch/contracts';
import { correctionTable, jobTable, reviewTable, trustLevelTable } from '../../store/common/schema.js';
import type { IStoreService } from '../../store/common/store.js';
import type { IGitService } from '../../git/common/git.js';
import { runGit } from '../../git/node/gitService.js';
import type { RunsService } from '../../runs/node/runsService.js';
import type { JobsService } from '../../jobs/node/jobsService.js';
import type { EngineClient } from '../../engine/common/engineClient.js';
import { autoMergeAllowed } from '../../trust/common/autoMerge.js';
import { evaluateGuardrails, type GuardrailEvaluation } from '../../jobs/node/guardrails.js';
import { REVIEW_ERRORS } from '../common/review.js';
import { buildCorrectionJobSpec, isJobLayer, appendLesson } from '../corrections/common/index.js';

export interface ReviewServiceDeps {
  store: IStoreService;
  git: IGitService;
  runs: RunsService;
  jobs?: JobsService;
  engine?: Pick<EngineClient, 'request'>;
  now?: () => Date;
  onEvent?: (event: OrchEvent) => void;
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

function buildContractFromChecks(checks: readonly Check[]): {
  checks: Array<{ spec: Record<string, unknown>; required?: boolean }>;
  protectTests: boolean;
} {
  const engineChecks: Array<{ spec: Record<string, unknown>; required?: boolean }> = [];
  for (const c of checks) {
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

function buildCheckResults(
  checks: readonly Check[],
  guardrails: GuardrailEvaluation,
  checksPassed: boolean,
): CheckResult[] {
  const checkResults: CheckResult[] = [
    guardrails.suppressionsResult,
    guardrails.protectedFilesResult,
  ];
  for (const c of checks) {
    checkResults.push({
      check: c,
      status: checksPassed ? 'passed' : 'failed',
      summary: checksPassed ? 'Passed' : 'Failed check',
    });
  }
  return checkResults;
}

export class ReviewService implements IReviewService {
  private readonly emitter = new Emitter<OrchEvent>();
  readonly onEvent: Event<OrchEvent> = this.emitter.event;

  constructor(private readonly deps: ReviewServiceDeps) {
    if (deps.onEvent) {
      this.emitter.event(deps.onEvent);
    }
    if (deps.jobs?.onEvent) {
      deps.jobs.onEvent((event) => {
        if (event.type === 'review.changed' && event.review.verdict === 'verified' && event.review.state === 'ready') {
          void this.maybeAutoMerge(event.review.worktree);
        }
      });
    }
  }

  private emit(event: OrchEvent): void {
    this.emitter.fire(event);
  }

  private nowDateString(): string {
    const d = this.deps.now ? this.deps.now() : new Date();
    return d.toISOString().slice(0, 10);
  }

  private async getJob(jobId: JobId): Promise<Job | null> {
    if (this.deps.jobs) {
      const res = await this.deps.jobs.get(jobId);
      if (res.ok) return res.value;
    }
    const [row] = await this.deps.store.db.select().from(jobTable).where(eq(jobTable.id, jobId));
    if (!row) return null;
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

  private getTrustLevel(agent: AgentId): TrustLevel {
    const rows = this.deps.store.db
      .select()
      .from(trustLevelTable)
      .where(eq(trustLevelTable.agent, agent))
      .all();
    const lvl = rows[0]?.level;
    return lvl === 1 || lvl === 2 || lvl === 3 ? lvl : 1;
  }

  async list(): Promise<Result<WorktreeReview[]>> {
    const rows = await this.deps.store.db.select().from(reviewTable);
    return { ok: true, value: rows.map(toWorktreeReview) };
  }

  async get(worktree: WorktreeId): Promise<Result<WorktreeReview>> {
    const [row] = await this.deps.store.db
      .select()
      .from(reviewTable)
      .where(eq(reviewTable.worktree, worktree));
    if (!row) {
      return { ok: false, error: REVIEW_ERRORS.notFound(worktree) };
    }
    return { ok: true, value: toWorktreeReview(row) };
  }

  async diff(worktree: WorktreeId, filePath: string): Promise<Result<{ before: string; after: string }>> {
    const reviewRes = await this.get(worktree);
    if (!reviewRes.ok) return reviewRes;
    const review = reviewRes.value;

    const job = await this.getJob(review.jobId);
    if (!job) {
      return { ok: false, error: REVIEW_ERRORS.notFound(worktree) };
    }

    const repoPath = job.spec.repoPath;
    const defaultBranchRes = await this.deps.git.getDefaultBranch(repoPath);
    const targetBranch = defaultBranchRes.ok ? defaultBranchRes.value : 'main';

    const runId = review.runId ?? (worktree.startsWith('orch/') ? worktree.slice(5) : worktree);
    const worktreePath = path.join(repoPath, '.orch', 'wt', runId);

    // 1. Before content from targetBranch
    let before = '';
    try {
      const { stdout } = await runGit(['-C', repoPath, 'show', `${targetBranch}:${filePath}`]);
      before = stdout;
    } catch {
      before = '';
    }

    // 2. After content from worktree
    let after = '';
    const fullPath = path.join(worktreePath, filePath);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      after = fs.readFileSync(fullPath, 'utf8');
    } else {
      try {
        const { stdout } = await runGit(['-C', worktreePath, 'show', `HEAD:${filePath}`]);
        after = stdout;
      } catch {
        after = '';
      }
    }

    return { ok: true, value: { before, after } };
  }

  async approveAndMerge(worktree: WorktreeId): Promise<Result<void>> {
    const reviewRes = await this.get(worktree);
    if (!reviewRes.ok) return reviewRes;
    const review = reviewRes.value;

    // REV-01: Approve & merge is possible only when the verdict is verified
    if (review.verdict !== 'verified') {
      return { ok: false, error: REVIEW_ERRORS.notVerified(review.verdict) };
    }

    const job = await this.getJob(review.jobId);
    if (!job) {
      return { ok: false, error: REVIEW_ERRORS.notFound(worktree) };
    }

    const repoPath = job.spec.repoPath;
    const defaultBranchRes = await this.deps.git.getDefaultBranch(repoPath);
    const targetBranch = defaultBranchRes.ok ? defaultBranchRes.value : 'main';

    const runId = review.runId ?? (worktree.startsWith('orch/') ? worktree.slice(5) : worktree);
    const worktreePath = path.join(repoPath, '.orch', 'wt', runId);
    const branch = worktree.startsWith('orch/') ? worktree : `orch/${runId}`;

    if (!fs.existsSync(worktreePath)) {
      return { ok: false, error: REVIEW_ERRORS.notFound(worktree) };
    }

    // Check if repoPath is clean
    try {
      const { stdout } = await runGit(['-C', repoPath, 'status', '--porcelain']);
      if (stdout.trim().length > 0) {
        return { ok: false, error: REVIEW_ERRORS.worktreeDirty('Main repository has uncommitted changes.') };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: REVIEW_ERRORS.internal(msg) };
    }

    // Commit any working changes in worktree before rebasing
    try {
      const { stdout } = await runGit(['-C', worktreePath, 'status', '--porcelain']);
      if (stdout.trim().length > 0) {
        await runGit(['-C', worktreePath, 'add', '-A']);
        await runGit([
          '-C',
          worktreePath,
          '-c',
          'user.name=orch',
          '-c',
          'user.email=orch@local',
          'commit',
          '-m',
          'Worktree changes',
        ]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: REVIEW_ERRORS.internal(msg) };
    }

    // REV-02: Rebase the worktree onto main (targetBranch)
    try {
      await runGit(['-C', worktreePath, 'rebase', targetBranch]);
    } catch (err) {
      try {
        await runGit(['-C', worktreePath, 'rebase', '--abort']);
      } catch {
        // ignore
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: REVIEW_ERRORS.mergeConflict(targetBranch, msg) };
    }

    // REV-02: Re-run checks and guardrails after rebase
    // 1. Guardrails
    const diffRes = await this.deps.git.getDiff(worktreePath, targetBranch);
    const diff = diffRes.ok ? diffRes.value : '';
    const guardrails = evaluateGuardrails(diff);

    // 2. Engine checks
    let checksPassed = true;
    const contract = buildContractFromChecks(job.spec.checks);
    if (contract.checks.length > 0 && this.deps.engine) {
      const verifyRes = await this.deps.engine.request({ op: 'verify.run', cwd: worktreePath, contract });
      if (!verifyRes.ok || (verifyRes.value as { passed?: boolean })?.passed !== true) {
        checksPassed = false;
      }
    }

    if (!guardrails.passed || !checksPassed) {
      const checkResults = buildCheckResults(job.spec.checks, guardrails, checksPassed);
      const filesRes = await this.deps.git.getChangedFiles(worktreePath, targetBranch);
      const files = filesRes.ok ? filesRes.value : review.files;

      await this.deps.store.db
        .update(reviewTable)
        .set({
          verdict: 'refuted',
          state: 'failing',
          checks: checkResults,
          files,
        })
        .where(eq(reviewTable.worktree, worktree));

      const updatedReview: WorktreeReview = {
        ...review,
        verdict: 'refuted',
        state: 'failing',
        checks: checkResults,
        files,
      };
      this.emit({ type: 'review.changed', review: updatedReview });

      const reason = !guardrails.passed ? 'Guardrail violation detected' : 'Verification check failed';
      return { ok: false, error: REVIEW_ERRORS.checksFailedAfterRebase(reason) };
    }

    // REV-02: squash into one commit:
    // {title} + blank line + orch: job {job}, run {run}, verified {YYYY-MM-DD}
    const verifiedDate = this.nowDateString();
    const commitMessage = `${review.title.trim()}\n\norch: job ${review.jobId}, run ${runId}, verified ${verifiedDate}`;

    try {
      await runGit(['-C', repoPath, 'checkout', targetBranch]);
      await runGit(['-C', repoPath, 'merge', '--squash', branch]);
      await runGit([
        '-C',
        repoPath,
        '-c',
        'user.name=orch',
        '-c',
        'user.email=orch@local',
        'commit',
        '-m',
        commitMessage,
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: REVIEW_ERRORS.internal(`Failed to squash merge: ${msg}`) };
    }

    // Update review state to 'merged'
    await this.deps.store.db
      .update(reviewTable)
      .set({ state: 'merged' })
      .where(eq(reviewTable.worktree, worktree));

    const mergedReview: WorktreeReview = {
      ...review,
      state: 'merged',
    };
    this.emit({ type: 'review.changed', review: mergedReview });

    return { ok: true, value: undefined };
  }

  async discard(worktree: WorktreeId): Promise<Result<void>> {
    const reviewRes = await this.get(worktree);
    if (!reviewRes.ok) return reviewRes;
    const review = reviewRes.value;

    const job = await this.getJob(review.jobId);
    if (!job) {
      return { ok: false, error: REVIEW_ERRORS.notFound(worktree) };
    }

    const repoPath = job.spec.repoPath;
    const runId = review.runId ?? (worktree.startsWith('orch/') ? worktree.slice(5) : worktree);

    // REV-04: deletes worktree and branch
    const removeRes = await this.deps.git.removeWorktree({ repoPath, runId, deleteBranch: true });
    if (!removeRes.ok) {
      return removeRes;
    }

    await this.deps.store.db
      .update(reviewTable)
      .set({ state: 'discarded' })
      .where(eq(reviewTable.worktree, worktree));

    const discardedReview: WorktreeReview = {
      ...review,
      state: 'discarded',
    };
    this.emit({ type: 'review.changed', review: discardedReview });

    return { ok: true, value: undefined };
  }

  async requestChanges(worktree: WorktreeId, feedback: string): Promise<Result<void>> {
    const reviewRes = await this.get(worktree);
    if (!reviewRes.ok) return reviewRes;
    const review = reviewRes.value;

    if (!review.runId) {
      return { ok: false, error: REVIEW_ERRORS.notFound(worktree) };
    }

    const run = await this.deps.runs.getRun(review.runId);
    if (!run) {
      return { ok: false, error: REVIEW_ERRORS.notFound(worktree) };
    }

    const job = await this.getJob(review.jobId);
    if (!job) {
      return { ok: false, error: REVIEW_ERRORS.notFound(worktree) };
    }

    const repoPath = job.spec.repoPath;
    const runId = review.runId;
    const worktreePath = path.join(repoPath, '.orch', 'wt', runId);

    // REV-05: starts a new try on the same session
    const currentStep = job.step;
    const attempt = (currentStep?.attempt ?? 1) + 1;
    const newStep: JobStep = {
      name: 'Implement',
      index: 1,
      total: 2,
      attempt,
      looping: attempt > 1,
    };

    await this.deps.store.db
      .update(jobTable)
      .set({ status: 'running', step: newStep })
      .where(eq(jobTable.id, job.id));
    this.emit({ type: 'job.changed', job: { ...job, status: 'running', step: newStep } });

    await this.deps.runs.updateRun(run.id, { status: 'running' });

    await this.deps.store.db
      .update(reviewTable)
      .set({ state: 'in_progress', verdict: 'unverified' })
      .where(eq(reviewTable.worktree, worktree));
    this.emit({ type: 'review.changed', review: { ...review, state: 'in_progress', verdict: 'unverified' } });

    // Send feedback to session
    const sendRes = await this.deps.runs.send(run.id, feedback);
    if (!sendRes.ok) {
      return sendRes;
    }

    // Now re-run checks and guardrails on the new try
    const defaultBranchRes = await this.deps.git.getDefaultBranch(repoPath);
    const targetBranch = defaultBranchRes.ok ? defaultBranchRes.value : 'main';

    const diffRes = await this.deps.git.getDiff(worktreePath, targetBranch);
    const diff = diffRes.ok ? diffRes.value : '';
    const guardrails = evaluateGuardrails(diff);

    let checksPassed = true;
    const contract = buildContractFromChecks(job.spec.checks);
    if (contract.checks.length > 0 && this.deps.engine) {
      const verifyRes = await this.deps.engine.request({ op: 'verify.run', cwd: worktreePath, contract });
      if (!verifyRes.ok || (verifyRes.value as { passed?: boolean })?.passed !== true) {
        checksPassed = false;
      }
    }

    const finalVerdict: Verdict = guardrails.passed && checksPassed ? 'verified' : 'refuted';
    const finalState: WorktreeState = finalVerdict === 'verified' ? 'ready' : 'failing';
    const finalJobStatus = finalVerdict === 'verified' ? 'done' : 'failed';

    const filesRes = await this.deps.git.getChangedFiles(worktreePath, targetBranch);
    const files = filesRes.ok ? filesRes.value : [];
    const checkResults = buildCheckResults(job.spec.checks, guardrails, checksPassed);

    await this.deps.store.db
      .update(reviewTable)
      .set({
        state: finalState,
        verdict: finalVerdict,
        checks: checkResults,
        files,
      })
      .where(eq(reviewTable.worktree, worktree));

    const recheckedReview: WorktreeReview = {
      ...review,
      state: finalState,
      verdict: finalVerdict,
      checks: checkResults,
      files,
    };
    this.emit({ type: 'review.changed', review: recheckedReview });

    await this.deps.store.db
      .update(jobTable)
      .set({ status: finalJobStatus })
      .where(eq(jobTable.id, job.id));
    this.emit({ type: 'job.changed', job: { ...job, status: finalJobStatus, step: newStep } });

    await this.deps.runs.updateRun(run.id, { status: finalJobStatus });

    if (finalVerdict === 'verified') {
      await this.maybeAutoMerge(worktree);
    }

    return { ok: true, value: undefined };
  }

  async maybeAutoMerge(worktree: WorktreeId): Promise<Result<boolean>> {
    const reviewRes = await this.get(worktree);
    if (!reviewRes.ok) return reviewRes;
    const review = reviewRes.value;

    if (review.verdict !== 'verified' || review.state === 'merged') {
      return { ok: true, value: false };
    }

    const job = await this.getJob(review.jobId);
    if (!job) return { ok: true, value: false };

    // TRU-03: single-mode jobs only
    if (job.spec.mode !== 'single') {
      return { ok: true, value: false };
    }

    if (!review.runId) return { ok: true, value: false };
    const run = await this.deps.runs.getRun(review.runId);
    if (!run) return { ok: true, value: false };

    const level = this.getTrustLevel(run.agent);
    if (level !== 3) {
      return { ok: true, value: false };
    }

    const isSpecQueue = Boolean(job.spec.storyPath?.includes('spec-') || job.id.startsWith('sq-'));
    const changedFiles = review.files.map((f) => f.path);
    const changedLines = review.files.reduce((sum, f) => sum + f.added + f.removed, 0);

    const allowed = autoMergeAllowed({
      level,
      mode: job.spec.mode,
      specQueue: isSpecQueue,
      changedFiles,
      changedLines,
    });

    if (!allowed) {
      return { ok: true, value: false };
    }

    const mergeRes = await this.approveAndMerge(worktree);
    if (!mergeRes.ok) {
      return mergeRes;
    }

    return { ok: true, value: true };
  }

  async correct(
    worktree: WorktreeId,
    layer: CorrectionLayer,
    action: string,
  ): Promise<Result<{ followUpJobId: JobId | null }>> {
    const reviewRes = await this.get(worktree);
    if (!reviewRes.ok) return reviewRes;
    const review = reviewRes.value;

    const job = await this.getJob(review.jobId);
    if (!job) {
      return { ok: false, error: REVIEW_ERRORS.notFound(worktree) };
    }

    const run = review.runId ? await this.deps.runs.getRun(review.runId) : null;

    let followUpJobId: JobId | null = null;

    if (isJobLayer(layer)) {
      if (!this.deps.jobs) {
        return { ok: false, error: REVIEW_ERRORS.noJobsService() };
      }
      const spec = buildCorrectionJobSpec(job, run, action);
      if (!spec) {
        return { ok: false, error: REVIEW_ERRORS.missingRunForSpec(worktree) };
      }
      const startRes = await this.deps.jobs.start(spec);
      if (!startRes.ok) return startRes;
      followUpJobId = startRes.value.id;
    } else if (layer === 'agent_rule') {
      const agentsMdPath = path.join(job.spec.repoPath, 'AGENTS.md');
      let content = '';
      if (fs.existsSync(agentsMdPath)) {
        content = fs.readFileSync(agentsMdPath, 'utf8');
      }
      const { content: nextContent, added } = appendLesson(content, action);
      if (added) {
        try {
          await fs.promises.writeFile(agentsMdPath, nextContent, 'utf8');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { ok: false, error: REVIEW_ERRORS.agentsMdFailed(msg) };
        }
      }
    } else {
      await this.deps.store.db
        .update(reviewTable)
        .set({ note: action })
        .where(eq(reviewTable.worktree, worktree));
      this.emit({ type: 'review.changed', review: { ...review, note: action } });
    }

    const nowIso = (this.deps.now ? this.deps.now() : new Date()).toISOString() as Timestamp;
    await this.deps.store.db.insert(correctionTable).values({
      worktree,
      whatWentWrong: review.note ?? 'Correction requested',
      layer,
      action,
      followUpJobId,
      createdAt: nowIso,
    });

    return { ok: true, value: { followUpJobId } };
  }
}
