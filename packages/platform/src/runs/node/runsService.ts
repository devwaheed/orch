import { eq } from 'drizzle-orm';
import { Emitter, type Event } from '@orch/base';
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
} from '@orch/contracts';
import { runLinkTable } from '../../store/common/schema.js';
import type { IStoreService } from '../../store/common/store.js';
import type { IProfilesService } from '../../profiles/common/profiles.js';
import type { EngineClient } from '../../engine/common/engineClient.js';
import {
  formatRunId,
  type IRunsService,
  parseRunIdCounter,
  RUN_ERRORS,
} from '../common/runs.js';

export interface RunsServiceDeps {
  store: IStoreService;
  profiles: IProfilesService;
  engine?: EngineClient;
  now?: () => Date;
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
  private readonly autoResumeMap = new Map<RunId, boolean>();

  constructor(private readonly deps: RunsServiceDeps) {
    if (deps.onEvent) {
      this.emitter.event(deps.onEvent);
    }
  }

  private nowIso(): Timestamp {
    const d = this.deps.now ? this.deps.now() : new Date();
    return d.toISOString() as Timestamp;
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
    await this.deps.store.db
      .update(runLinkTable)
      .set({
        status: updated.status,
        accountId: updated.accountId,
        sessionId: updated.sessionId,
        worktree: updated.worktree,
        startedAt: updated.startedAt,
        resumesAt: updated.resumesAt,
      })
      .where(eq(runLinkTable.id, runId));

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
    }

    if (this.deps.onRunResumed && updated) {
      await this.deps.onRunResumed(updated, accountId);
    }

    return { ok: true, value: updated ?? run };
  }

  async setAutoResume(runId: RunId, on: boolean): Promise<Result<void>> {
    const run = await this.getRun(runId);
    if (!run) {
      return { ok: false, error: RUN_ERRORS.notFound(runId) };
    }
    this.autoResumeMap.set(runId, on);
    return { ok: true, value: undefined };
  }

  isAutoResumeEnabled(runId: RunId): boolean {
    return this.autoResumeMap.get(runId) ?? true;
  }
}
