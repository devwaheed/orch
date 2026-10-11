/**
 * The sessions service: lists sessions, shows the resume options and carries
 * out the four resume modes (SES-01..SES-03), and deletes ended sessions after
 * SES-04's 90 days. Dependencies come in through the constructor.
 */
import { randomInt } from 'node:crypto';
import { Emitter, type Event } from '@orch/base';
import {
  ResumeRequest,
  SessionId,
  type AccountId,
  type IAccountsService,
  type IQuotaService,
  type ISessionsService,
  type OrchEvent,
  type ResumeOption,
  type Result,
  type Session,
  type SessionStatus,
  type Timestamp,
  type WorktreeId,
} from '@orch/contracts';
import type { EngineClient } from '../../engine/common/engineClient.js';
import type { IProfilesService } from '../../profiles/common/profiles.js';
import {
  accountFacts,
  buildResumeOptions,
  expiredSessionIds,
  forkBaseOf,
  forkBranchName,
  isUsable,
  nextForkNumber,
  SESSION_ERRORS,
  sessionIdFromRandom,
  type AccountFacts,
  type ISessionRepository,
  type ISessionWorktrees,
  type SessionRecord,
} from '../common/sessions.js';

/** Starts a timer for `at` and returns a cancel function. Injected so tests control time. */
export type Scheduler = (at: Date, run: () => void) => () => void;

export interface SessionsServiceDeps {
  repo: ISessionRepository;
  accounts: Pick<IAccountsService, 'list'>;
  quota: Pick<IQuotaService, 'windows'>;
  profiles: Pick<IProfilesService, 'sessionEnv'>;
  engine: Pick<EngineClient, 'request'>;
  worktrees: ISessionWorktrees;
  now: () => Date;
  /** Random number in [0, 1) for session ids (JOB-01). */
  random?: () => number;
  /** Runs a callback at a time. Defaults to setTimeout, re-armed past the 24-day limit. */
  schedule?: Scheduler;
}

/** Engine status values that map onto a session status. */
export type EngineSessionStatus = 'running' | 'idle' | 'stopped' | 'failed';

const MAX_TIMER_MS = 2 ** 31 - 1;

export const setTimeoutScheduler: Scheduler = (at, run) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  const arm = (): void => {
    if (cancelled) return;
    const remaining = at.getTime() - Date.now();
    if (remaining > MAX_TIMER_MS) {
      timer = setTimeout(arm, MAX_TIMER_MS);
    } else {
      timer = setTimeout(run, Math.max(0, remaining));
    }
    timer.unref?.();
  };
  arm();
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
};

function defaultRandom(): number {
  return randomInt(0x10000) / 0x10000;
}

/** The position without a note: a new session starts without the old one's note. */
function basePosition(position: Session['position']): Session['position'] {
  return { step: position.step, index: position.index, total: position.total, attempt: position.attempt };
}

function engineHandleOf(value: unknown): string | null {
  const session = (value as { session?: unknown } | null)?.session;
  return typeof session === 'string' && session.length > 0 ? session : null;
}

export class SessionsService implements ISessionsService {
  private readonly emitter = new Emitter<OrchEvent>();
  /** Live events: session.changed. */
  readonly onEvent: Event<OrchEvent> = this.emitter.event;

  /** Pending timers for resumes that wait for an account's reset. */
  private readonly waits = new Map<SessionId, () => void>();
  private readonly schedule: Scheduler;
  private readonly random: () => number;

  constructor(private readonly deps: SessionsServiceDeps) {
    this.schedule = deps.schedule ?? setTimeoutScheduler;
    this.random = deps.random ?? defaultRandom;
  }

  async list(filter: 'all' | 'resumable' | 'live'): Promise<Result<Session[]>> {
    const sessions = this.deps.repo
      .list()
      .map((r) => r.session)
      .filter((s) => filter === 'all' || (filter === 'live' ? s.status === 'live' : s.status !== 'live'))
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
    return { ok: true, value: sessions };
  }

  async get(sessionId: SessionId): Promise<Result<Session & { status: SessionStatus }>> {
    const record = this.deps.repo.get(sessionId);
    if (!record) return { ok: false, error: SESSION_ERRORS.notFound(sessionId) };
    return { ok: true, value: record.session };
  }

  async resumeOptions(sessionId: SessionId): Promise<Result<ResumeOption[]>> {
    const record = this.deps.repo.get(sessionId);
    if (!record) return { ok: false, error: SESSION_ERRORS.notFound(sessionId) };
    const facts = await this.accountFacts();
    if (!facts.ok) return facts;
    return {
      ok: true,
      value: buildResumeOptions({
        session: record.session,
        hasEngineHandle: record.engineHandle !== null,
        accounts: facts.value,
      }),
    };
  }

  async resume(req: ResumeRequest): Promise<Result<Session>> {
    const parsed = ResumeRequest.safeParse(req);
    if (!parsed.success) {
      return { ok: false, error: { code: 'validation_failed', message: 'The resume request is not valid.', fix: 'Check the session and the target account, then try again.' } };
    }
    const request = parsed.data;
    const record = this.deps.repo.get(request.sessionId);
    if (!record) return { ok: false, error: SESSION_ERRORS.notFound(request.sessionId) };
    if (record.session.status === 'live') return { ok: false, error: SESSION_ERRORS.live(request.sessionId) };

    const options = await this.resumeOptions(request.sessionId);
    if (!options.ok) return options;
    const option = options.value.find((o) => o.mode === request.mode);
    if (!option || !option.available) {
      return { ok: false, error: SESSION_ERRORS.unavailable(request.sessionId, option?.description ?? 'this option is not offered.') };
    }

    switch (request.mode) {
      case 'same': {
        const facts = await this.accountFacts();
        if (!facts.ok) return facts;
        const limited = facts.value.find((a) => a.id === record.session.accountId)?.state === 'limited';
        return this.reopen(record, option.waitsUntil, limited);
      }
      case 'account':
      case 'agent':
        return this.handOff(record, request.to, request.mode);
      case 'fork':
        return this.fork(record);
    }
  }

  /** Deletes ended sessions older than SES-04's 90 days. Returns the ids removed. */
  async purgeExpired(): Promise<Result<SessionId[]>> {
    const ids = expiredSessionIds(this.deps.repo.list(), this.deps.now());
    for (const id of ids) this.deps.repo.delete(id);
    return { ok: true, value: ids };
  }

  /** Stores a session another service started (jobs and runs). Emits session.changed. */
  record(record: SessionRecord): void {
    this.deps.repo.put(record);
    this.emit(record.session);
  }

  /** Applies an engine status to the session that holds the handle. */
  applyEngineStatus(engineHandle: string, status: EngineSessionStatus): void {
    const record = this.deps.repo.list().find((r) => r.engineHandle === engineHandle);
    if (!record) return;
    const next: SessionStatus = status === 'running' || status === 'idle' ? 'live' : status === 'failed' ? 'interrupted' : 'ended';
    if (record.session.status === 'ended' && next !== 'live') return;
    this.update(record, { status: next, lastActivityAt: this.nowIso() });
  }

  dispose(): void {
    for (const cancel of this.waits.values()) cancel();
    this.waits.clear();
    this.emitter.dispose();
  }

  private nowIso(): Timestamp {
    return this.deps.now().toISOString() as Timestamp;
  }

  private emit(session: Session): void {
    this.emitter.fire({ type: 'session.changed', session });
  }

  private update(record: SessionRecord, patch: Partial<Session>, engineHandle?: string | null): SessionRecord {
    const next: SessionRecord = {
      session: { ...record.session, ...patch },
      engineHandle: engineHandle === undefined ? record.engineHandle : engineHandle,
      cwd: record.cwd,
    };
    this.deps.repo.put(next);
    this.emit(next.session);
    return next;
  }

  private async accountFacts(): Promise<Result<AccountFacts[]>> {
    const accounts = await this.deps.accounts.list();
    if (!accounts.ok) return accounts;
    const windows = await this.deps.quota.windows();
    if (!windows.ok) return windows;
    const now = this.deps.now();
    return { ok: true, value: accounts.value.map((a) => accountFacts(a, windows.value, now)) };
  }

  private freshSessionId(): SessionId {
    for (let attempt = 0; attempt < 100; attempt++) {
      const id = sessionIdFromRandom(this.random());
      if (!this.deps.repo.get(id)) return id;
    }
    throw new Error('No free session id after 100 tries.');
  }

  /**
   * SES-01: reopen the same session on its account. A limited account holds the
   * session paused: until its reset when the reset is known (a timer), otherwise
   * until the limit clears (no timer; the next resume starts it).
   */
  private async reopen(record: SessionRecord, waitsUntil: string | null, limited: boolean): Promise<Result<Session>> {
    const { session, engineHandle } = record;
    if (!engineHandle) return { ok: false, error: SESSION_ERRORS.noEngineRecord(session.id) };
    if (waitsUntil || limited) {
      this.waits.get(session.id)?.();
      this.waits.delete(session.id);
      if (waitsUntil) {
        const cancel = this.schedule(new Date(waitsUntil), () => {
          this.waits.delete(session.id);
          void this.runReopen(session.id);
        });
        this.waits.set(session.id, cancel);
      }
      const paused = this.update(record, { status: 'paused' });
      return { ok: true, value: paused.session };
    }
    return this.runReopen(session.id);
  }

  /** Sends the engine a resume on the session's own account. Used now, or when a wait ends. */
  private async runReopen(sessionId: SessionId): Promise<Result<Session>> {
    const record = this.deps.repo.get(sessionId);
    if (!record || !record.engineHandle) return { ok: false, error: SESSION_ERRORS.noEngineRecord(sessionId) };
    const env = await this.deps.profiles.sessionEnv(record.session.accountId);
    if (!env.ok) {
      this.update(record, { status: 'interrupted' });
      return env;
    }
    const reply = await this.deps.engine.request({ op: 'session.resume', session: record.engineHandle, env: env.value });
    if (!reply.ok) {
      this.update(record, { status: 'interrupted' });
      return reply;
    }
    const live = this.update(record, { status: 'live', lastActivityAt: this.nowIso() });
    return { ok: true, value: live.session };
  }

  /** SES-02: hand the session to another account or agent, in the same worktree (Claw's session.handoff). */
  private async handOff(record: SessionRecord, to: AccountId, mode: 'account' | 'agent'): Promise<Result<Session>> {
    const { session, engineHandle, cwd } = record;
    if (!engineHandle || !cwd || !session.worktree) return { ok: false, error: SESSION_ERRORS.noWorktree(session.id) };

    const facts = await this.accountFacts();
    if (!facts.ok) return facts;
    const target = facts.value.find((a) => a.id === to);
    const sameAgent = target?.agent === session.agent;
    const valid = target !== undefined && isUsable(target) && (mode === 'account' ? sameAgent : !sameAgent);
    if (!target || !valid) return { ok: false, error: SESSION_ERRORS.badTarget(to) };

    const env = await this.deps.profiles.sessionEnv(to);
    if (!env.ok) return env;
    const reply = await this.deps.engine.request({
      op: 'session.handoff',
      from: engineHandle,
      toAgent: target.agent,
      env: env.value,
      cwd,
    });
    if (!reply.ok) return reply;
    const handle = engineHandleOf(reply.value);
    if (!handle) return { ok: false, error: SESSION_ERRORS.badEngineReply };

    const newId = this.freshSessionId();
    const now = this.nowIso();
    const nextRecord: SessionRecord = {
      session: {
        id: newId,
        jobId: session.jobId,
        runId: session.runId,
        title: session.title,
        agent: target.agent,
        accountId: to,
        cliSessionId: '',
        status: 'live',
        worktree: session.worktree,
        startedAt: now,
        lastActivityAt: now,
        tokens: 0,
        position: basePosition(session.position),
        handedOffTo: null,
        handedOffFrom: session.id,
      },
      engineHandle: handle,
      cwd,
    };
    this.deps.repo.put(nextRecord);
    this.emit(nextRecord.session);
    this.update(record, {
      status: 'ended',
      lastActivityAt: now,
      handedOffTo: newId,
      position: { ...session.position, note: `Handed off to ${newId}` },
    });
    return { ok: true, value: nextRecord.session };
  }

  /** SES-03: a new branch from the worktree's current commit, with a new session on it. The original is unchanged. */
  private async fork(record: SessionRecord): Promise<Result<Session>> {
    const { session, cwd } = record;
    if (!session.worktree || !cwd) return { ok: false, error: SESSION_ERRORS.noWorktree(session.id) };

    const base = forkBaseOf(session.worktree as WorktreeId);
    const existing = this.deps.repo.list().map((r) => r.session.worktree).filter((w): w is WorktreeId => w !== null);
    const branch = forkBranchName(base, nextForkNumber(base, existing));

    const wt = await this.deps.worktrees.fork(cwd, branch);
    if (!wt.ok) return { ok: false, error: SESSION_ERRORS.forkFailed(session.id, wt.error.message) };

    const env = await this.deps.profiles.sessionEnv(session.accountId);
    if (!env.ok) return env;
    const reply = await this.deps.engine.request({
      op: 'session.start',
      agent: session.agent,
      cwd: wt.value.path,
      env: env.value,
      readOnly: false,
    });
    if (!reply.ok) return { ok: false, error: SESSION_ERRORS.forkFailed(session.id, reply.error.message) };
    const handle = engineHandleOf(reply.value);
    if (!handle) return { ok: false, error: SESSION_ERRORS.badEngineReply };

    const newId = this.freshSessionId();
    const now = this.nowIso();
    const forked: SessionRecord = {
      session: {
        id: newId,
        jobId: session.jobId,
        runId: null,
        title: session.title,
        agent: session.agent,
        accountId: session.accountId,
        cliSessionId: '',
        status: 'live',
        worktree: branch as WorktreeId,
        startedAt: now,
        lastActivityAt: now,
        tokens: 0,
        position: basePosition(session.position),
        handedOffTo: null,
        handedOffFrom: null,
      },
      engineHandle: handle,
      cwd: wt.value.path,
    };
    this.deps.repo.put(forked);
    this.emit(forked.session);
    return { ok: true, value: forked.session };
  }
}
