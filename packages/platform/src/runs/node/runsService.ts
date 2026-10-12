import { and, eq } from 'drizzle-orm';
import { Emitter, type Event } from '@orchagents/base';
import type {
  AccountId,
  AgentId,
  JobId,
  OrchEvent,
  Result,
  Run,
  RunId,
  RunLine,
  RunRole,
  RunStatus,
  SessionId,
  Timestamp,
  WorktreeId,
} from '@orchagents/contracts';
import { runLinkTable } from '../../store/common/schema.js';
import type { IStoreService } from '../../store/common/store.js';
import type { IProfilesService } from '../../profiles/common/profiles.js';
import type { EngineClient } from '../../engine/common/engineClient.js';
import type { IEngineSessionRecorder } from '../../sessions/node/sessionsService.js';
import {
  formatRunId,
  type IRunsService,
  parseRunIdCounter,
  RUN_ERRORS,
  CONTINUE_AFTER_LIMIT,
} from '../common/runs.js';

/** QTA-04: auto-resume waits a random 0–120 s after the reset time (whole seconds). */
export const AUTO_RESUME_JITTER_MAX_SECONDS = 120;

/** Longest delay a JS timer accepts. Longer waits are re-armed when they wake up. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** Injected timers: tests drive the auto-resume clock without waiting. */
export interface ResumeScheduler {
  set(callback: () => Promise<void>, delayMs: number): unknown;
  clear(handle: unknown): void;
}

export const systemScheduler: ResumeScheduler = {
  set: (callback, delayMs) =>
    setTimeout(() => {
      void callback();
    }, delayMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface RunsServiceDeps {
  store: IStoreService;
  profiles: IProfilesService;
  engine?: Pick<EngineClient, 'request'>;
  /** SES producer: a resumed run's engine session follows its new account. */
  sessions?: Pick<IEngineSessionRecorder, 'markResumed'>;
  now?: () => Date;
  /** Returns a value in [0, 1). Defaults to Math.random. */
  random?: () => number;
  scheduler?: ResumeScheduler;
  onEvent?: (event: OrchEvent) => void;
  onRunResumed?: (run: Run, accountId: AccountId) => Promise<void>;
}

function toRun(row: typeof runLinkTable.$inferSelect): Run {
  return {
    id: row.id as RunId,
    jobId: row.jobId as JobId,
    parentId: (row.parentId as RunId) ?? null,
    depth: row.depth,
    role: row.role as RunRole,
    task: row.task,
    agent: row.agent as AgentId,
    accountId: row.accountId as AccountId,
    status: row.status as RunStatus,
    worktree: (row.worktree as WorktreeId) ?? null,
    readOnly: row.readOnly,
    sessionId: (row.sessionId as SessionId) ?? null,
    startedAt: (row.startedAt as Timestamp) ?? null,
    resumesAt: (row.resumesAt as Timestamp) ?? null,
  };
}

export class RunsService implements IRunsService {
  private readonly emitter = new Emitter<OrchEvent>();
  readonly onEvent: Event<OrchEvent> = this.emitter.event;

  private readonly linesMap = new Map<RunId, RunLine[]>();
  /** Armed auto-resume timers, one per run at most. The schedule itself is persisted in the store. */
  private readonly timers = new Map<RunId, { handle: unknown }>();

  constructor(private readonly deps: RunsServiceDeps) {
    if (deps.onEvent) {
      this.emitter.event(deps.onEvent);
    }
  }

  private nowMs(): number {
    return (this.deps.now ? this.deps.now() : new Date()).getTime();
  }

  private nowIso(): Timestamp {
    return new Date(this.nowMs()).toISOString() as Timestamp;
  }

  private get scheduler(): ResumeScheduler {
    return this.deps.scheduler ?? systemScheduler;
  }

  private async row(runId: RunId): Promise<typeof runLinkTable.$inferSelect | undefined> {
    const [row] = await this.deps.store.db.select().from(runLinkTable).where(eq(runLinkTable.id, runId));
    return row;
  }

  private cancelTimer(runId: RunId): void {
    const armed = this.timers.get(runId);
    if (armed) {
      this.scheduler.clear(armed.handle);
      this.timers.delete(runId);
    }
  }

  /** Arms the auto-resume timer for `fireAt` (ISO time). A past time fires on the next tick. */
  private armTimer(runId: RunId, fireAt: string): void {
    this.cancelTimer(runId);
    const remaining = Date.parse(fireAt) - this.nowMs();
    const delay = Math.min(Math.max(0, remaining), MAX_TIMER_DELAY_MS);
    const handle = this.scheduler.set(() => this.onAutoResumeDue(runId, fireAt), delay);
    this.timers.set(runId, { handle });
  }

  /**
   * Runs when a timer wakes. Resumes only if the run is still paused by a limit,
   * auto-resume is on and this is still the scheduled time (QTA-04).
   */
  private async onAutoResumeDue(runId: RunId, fireAt: string): Promise<void> {
    this.timers.delete(runId);
    try {
      const row = await this.row(runId);
      if (!row || row.status !== 'paused_limit' || !row.autoResume || row.resumeFireAt !== fireAt) {
        return;
      }
      if (this.nowMs() < Date.parse(fireAt)) {
        this.armTimer(runId, fireAt);
        return;
      }
      this.appendLine(runId, 'meta', 'Auto-resume after the limit reset');
      const res = await this.resumeOn(runId, row.accountId as AccountId);
      if (!res.ok) {
        this.appendLine(runId, 'err', res.error.message);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.appendLine(runId, 'err', RUN_ERRORS.cannotResume(runId, reason).message);
    }
  }

  private async setFireAt(runId: RunId, fireAt: string | null): Promise<void> {
    await this.deps.store.db
      .update(runLinkTable)
      .set({ resumeFireAt: fireAt })
      .where(eq(runLinkTable.id, runId));
  }

  /** Stops every armed timer. Called when the core host shuts down. */
  dispose(): void {
    for (const runId of [...this.timers.keys()]) {
      this.cancelTimer(runId);
    }
  }

  /**
   * Re-arms auto-resume for every run that is paused by a limit when the core host
   * starts (survives a restart). A time that has already passed fires at once.
   */
  async restoreSchedules(): Promise<void> {
    const rows = await this.deps.store.db
      .select()
      .from(runLinkTable)
      .where(and(eq(runLinkTable.status, 'paused_limit'), eq(runLinkTable.autoResume, true)));
    for (const row of rows) {
      if (row.resumeFireAt) {
        this.armTimer(row.id as RunId, row.resumeFireAt);
      }
    }
  }

  /**
   * QTA-03 / QTA-04: pauses the run at a limit. The worktree and session stay. If the
   * limit has a reset time and auto-resume is on, a timer is armed for that time plus
   * a random 0–120 s delay. A null reset time arms nothing: the run holds until the limit clears.
   */
  async pauseForLimit(runId: RunId, resetsAt: Timestamp | null): Promise<Result<void>> {
    const run = await this.getRun(runId);
    if (!run) {
      return { ok: false, error: RUN_ERRORS.notFound(runId) };
    }

    await this.updateRun(runId, { status: 'paused_limit', resumesAt: resetsAt });

    const resetMs = resetsAt ? Date.parse(resetsAt) : Number.NaN;
    if (!Number.isFinite(resetMs)) {
      this.cancelTimer(runId);
      await this.setFireAt(runId, null);
      return { ok: true, value: undefined };
    }

    const random = this.deps.random ?? Math.random;
    const jitterSeconds = Math.min(
      AUTO_RESUME_JITTER_MAX_SECONDS,
      Math.floor(random() * (AUTO_RESUME_JITTER_MAX_SECONDS + 1)),
    );
    const fireAt = new Date(resetMs + jitterSeconds * 1000).toISOString();
    await this.setFireAt(runId, fireAt);

    this.cancelTimer(runId);
    const row = await this.row(runId);
    if (row?.autoResume) {
      this.armTimer(runId, fireAt);
    }
    return { ok: true, value: undefined };
  }

  private emit(event: OrchEvent): void {
    this.emitter.fire(event);
  }

  appendLine(runId: RunId, kind: RunLine['kind'], text: string): RunLine {
    let lines = this.linesMap.get(runId);
    if (!lines) {
      lines = [];
      this.linesMap.set(runId, lines);
    }

    const line: RunLine = {
      runId,
      seq: lines.length,
      at: this.nowIso(),
      kind,
      text,
    };
    lines.push(line);
    this.emit({ type: 'run.line', line });
    return line;
  }

  async nextRunId(): Promise<RunId> {
    const rows = await this.deps.store.db
      .select({ id: runLinkTable.id })
      .from(runLinkTable);
    let max = 0;
    for (const r of rows) {
      const parsed = parseRunIdCounter(r.id);
      if (parsed !== null && parsed > max) {
        max = parsed;
      }
    }
    return formatRunId(max + 1);
  }

  async recordRun(run: Run): Promise<void> {
    await this.deps.store.db.insert(runLinkTable).values({
      id: run.id,
      jobId: run.jobId,
      parentId: run.parentId,
      depth: run.depth,
      role: run.role,
      task: run.task,
      agent: run.agent,
      accountId: run.accountId,
      status: run.status,
      worktree: run.worktree,
      readOnly: run.readOnly,
      sessionId: run.sessionId,
      cliSessionId: null,
      startedAt: run.startedAt,
      resumesAt: run.resumesAt,
    });
    this.emit({ type: 'run.changed', run });
  }

  async updateRun(runId: RunId, patch: Partial<Run>): Promise<Run | null> {
    const existing = await this.getRun(runId);
    if (!existing) return null;

    const updated: Run = { ...existing, ...patch };
    // Leaving paused-by-limit (resume, stop, pause, finish) cancels the scheduled auto-resume.
    const leavingLimit = updated.status !== 'paused_limit';
    await this.deps.store.db
      .update(runLinkTable)
      .set({
        status: updated.status,
        agent: updated.agent,
        accountId: updated.accountId,
        sessionId: updated.sessionId,
        worktree: updated.worktree,
        startedAt: updated.startedAt,
        resumesAt: updated.resumesAt,
        ...(leavingLimit ? { resumeFireAt: null } : {}),
      })
      .where(eq(runLinkTable.id, runId));
    if (leavingLimit) {
      this.cancelTimer(runId);
    }

    this.emit({ type: 'run.changed', run: updated });
    return updated;
  }

  async getRun(runId: RunId): Promise<Run | null> {
    const [row] = await this.deps.store.db
      .select()
      .from(runLinkTable)
      .where(eq(runLinkTable.id, runId));
    return row ? toRun(row) : null;
  }

  async list(jobId: JobId): Promise<Result<Run[]>> {
    const rows = await this.deps.store.db
      .select()
      .from(runLinkTable)
      .where(eq(runLinkTable.jobId, jobId));
    return { ok: true, value: rows.map(toRun) };
  }

  async lines(runId: RunId, afterSeq: number): Promise<Result<RunLine[]>> {
    const lines = this.linesMap.get(runId) ?? [];
    const filtered = lines.filter((l) => l.seq > afterSeq);
    return { ok: true, value: filtered };
  }

  async send(runId: RunId, text: string): Promise<Result<void>> {
    const run = await this.getRun(runId);
    if (!run) {
      return { ok: false, error: RUN_ERRORS.notFound(runId) };
    }

    this.appendLine(runId, 'prompt', text);

    if (run.sessionId && this.deps.engine) {
      const res = await this.deps.engine.request({
        op: 'session.send',
        session: run.sessionId,
        text,
      });
      if (!res.ok) {
        return { ok: false, error: res.error };
      }
    }

    return { ok: true, value: undefined };
  }

  async pause(runId: RunId): Promise<Result<void>> {
    const run = await this.getRun(runId);
    if (!run) {
      return { ok: false, error: RUN_ERRORS.notFound(runId) };
    }

    await this.updateRun(runId, { status: 'stopped' });
    this.appendLine(runId, 'meta', 'Run paused');
    return { ok: true, value: undefined };
  }

  async stop(runId: RunId): Promise<Result<void>> {
    const run = await this.getRun(runId);
    if (!run) {
      return { ok: false, error: RUN_ERRORS.notFound(runId) };
    }

    if (run.sessionId && this.deps.engine) {
      await this.deps.engine.request({
        op: 'session.stop',
        session: run.sessionId,
      });
    }

    await this.updateRun(runId, { status: 'stopped' });
    this.appendLine(runId, 'meta', 'Run stopped');
    return { ok: true, value: undefined };
  }

  async startNow(runId: RunId): Promise<Result<void>> {
    const run = await this.getRun(runId);
    if (!run) {
      return { ok: false, error: RUN_ERRORS.notFound(runId) };
    }

    await this.updateRun(runId, { status: 'running', resumesAt: null });
    this.appendLine(runId, 'meta', 'Run resumed');
    return { ok: true, value: undefined };
  }

  async resumeOn(runId: RunId, accountId: AccountId): Promise<Result<Run>> {
    const run = await this.getRun(runId);
    if (!run) {
      return { ok: false, error: RUN_ERRORS.notFound(runId) };
    }

    const envRes = await this.deps.profiles.sessionEnv(accountId);
    if (!envRes.ok) {
      return { ok: false, error: RUN_ERRORS.cannotResume(runId, envRes.error.message) };
    }

    const updated = await this.updateRun(runId, {
      accountId,
      status: 'running',
      resumesAt: null,
    });

    this.appendLine(runId, 'meta', `Resumed on account ${accountId}`);

    if (run.sessionId && this.deps.engine) {
      await this.deps.engine.request({
        op: 'session.resume',
        session: run.sessionId,
        env: envRes.value,
      });
      this.deps.sessions?.markResumed(run.sessionId, accountId);
      // The agent stopped mid-turn; nothing restarts it unless it is told to carry on.
      void this.deps.engine.request({ op: 'session.send', session: run.sessionId, text: CONTINUE_AFTER_LIMIT });
    }

    if (this.deps.onRunResumed && updated) {
      await this.deps.onRunResumed(updated, accountId);
    }

    return { ok: true, value: updated ?? run };
  }

  /**
   * QTA: an account reported available again (quota.available). Runs paused by a
   * limit on it with no known reset time resume on it now. Runs with a reset time
   * keep their timer (reset plus jitter).
   */
  async resumeWaitingOn(accountId: AccountId): Promise<void> {
    const rows = await this.deps.store.db
      .select()
      .from(runLinkTable)
      .where(and(eq(runLinkTable.status, 'paused_limit'), eq(runLinkTable.accountId, accountId), eq(runLinkTable.autoResume, true)));
    for (const row of rows) {
      if (row.resumeFireAt !== null) continue;
      this.appendLine(row.id as RunId, 'meta', 'Auto-resume: the account is available again');
      const res = await this.resumeOn(row.id as RunId, accountId);
      if (!res.ok) {
        this.appendLine(row.id as RunId, 'err', res.error.message);
      }
    }
  }

  /**
   * The auto-resume checkbox (QTA-04). Stored on the run, so it survives a restart.
   * Turning it on for a run paused by a limit arms the timer; turning it off cancels it.
   */
  async setAutoResume(runId: RunId, on: boolean): Promise<Result<void>> {
    const row = await this.row(runId);
    if (!row) {
      return { ok: false, error: RUN_ERRORS.notFound(runId) };
    }
    await this.deps.store.db
      .update(runLinkTable)
      .set({ autoResume: on })
      .where(eq(runLinkTable.id, runId));

    if (!on) {
      this.cancelTimer(runId);
    } else if (row.status === 'paused_limit' && row.resumeFireAt) {
      this.armTimer(runId, row.resumeFireAt);
    }
    return { ok: true, value: undefined };
  }
}
