/**
 * The store-backed session repository (SES): one `session` row per record. The
 * store is synchronous (better-sqlite3), so these methods are too.
 */
import { eq } from 'drizzle-orm';
import type { AgentId, AccountId, JobId, RunId, Session, SessionId, WorktreeId } from '@orch/contracts';
import { sessionTable } from '../../store/common/schema.js';
import type { IStoreService } from '../../store/common/store.js';
import type { ISessionRepository, SessionRecord } from '../common/sessions.js';

type Row = typeof sessionTable.$inferSelect;

function toRecord(row: Row): SessionRecord {
  const session: Session = {
    id: row.id as SessionId,
    jobId: row.jobId as JobId,
    runId: (row.runId as RunId) ?? null,
    title: row.title,
    agent: row.agent as AgentId,
    accountId: row.accountId as AccountId,
    cliSessionId: row.cliSessionId,
    status: row.status,
    worktree: (row.worktree as WorktreeId) ?? null,
    startedAt: row.startedAt as Session['startedAt'],
    lastActivityAt: row.lastActivityAt as Session['lastActivityAt'],
    tokens: row.tokens,
    position: row.position,
    handedOffTo: (row.handedOffTo as SessionId) ?? null,
    handedOffFrom: (row.handedOffFrom as SessionId) ?? null,
  };
  return { session, engineHandle: row.engineHandle, cwd: row.cwd };
}

function toRow(record: SessionRecord): Row {
  const s = record.session;
  return {
    id: s.id,
    jobId: s.jobId,
    runId: s.runId,
    title: s.title,
    agent: s.agent,
    accountId: s.accountId,
    cliSessionId: s.cliSessionId,
    status: s.status,
    worktree: s.worktree,
    startedAt: s.startedAt,
    lastActivityAt: s.lastActivityAt,
    tokens: s.tokens,
    position: s.position,
    handedOffTo: s.handedOffTo,
    handedOffFrom: s.handedOffFrom,
    engineHandle: record.engineHandle,
    cwd: record.cwd,
  };
}

export class StoreSessionRepository implements ISessionRepository {
  constructor(private readonly store: IStoreService) {}

  list(): SessionRecord[] {
    return this.store.db.select().from(sessionTable).all().map(toRecord);
  }

  get(id: SessionId): SessionRecord | undefined {
    const [row] = this.store.db.select().from(sessionTable).where(eq(sessionTable.id, id)).all();
    return row ? toRecord(row) : undefined;
  }

  put(record: SessionRecord): void {
    const row = toRow(record);
    this.store.db
      .insert(sessionTable)
      .values(row)
      .onConflictDoUpdate({ target: sessionTable.id, set: row })
      .run();
  }

  delete(id: SessionId): void {
    this.store.db.delete(sessionTable).where(eq(sessionTable.id, id)).run();
  }
}
