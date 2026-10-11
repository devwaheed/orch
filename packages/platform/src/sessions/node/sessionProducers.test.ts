/**
 * Session producers and the store-backed repository (SES-01, SES-02, sessions
 * persistence). Real store, real sessions service; the engine, accounts, quota
 * and profiles are small fakes, so no agent runs.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Account, AccountId, EngineEnv, EngineRequest, JobId, JobSpec, Session, SessionId, WorktreeId } from '@orch/contracts';
import { StoreService } from '../../store/node/storeService.js';
import { jobTable } from '../../store/common/schema.js';
import { SessionsService, type SessionsServiceDeps } from './sessionsService.js';
import { StoreSessionRepository } from './storeSessionRepository.js';

const JOB = 'j-1' as JobId;
const WT = 'orch/r-1' as WorktreeId;
const CWD = '/repo/.orch/wt/r-1';
const NOW = new Date('2026-10-11T12:00:00.000Z');

let root: string;
let stores: StoreService[];
let requests: EngineRequest[];
let accounts: Account[];
let replies: Record<string, unknown>;
/** Counts up so every new session gets a distinct id. */
let ids = 0;

function account(id: string, agent: Account['agent']): Account {
  return { id: id as AccountId, agent, name: id, primary: false, use: true, state: 'available', profileDir: `/profiles/${id}`, skillsShared: true };
}

function openStore(): StoreService {
  const s = new StoreService();
  stores.push(s);
  return s;
}

async function makeService(store: StoreService): Promise<SessionsService> {
  const deps: SessionsServiceDeps = {
    repo: new StoreSessionRepository(store),
    accounts: { list: async () => ({ ok: true, value: accounts }) },
    quota: { windows: async () => ({ ok: true, value: [] }) },
    profiles: {
      sessionEnv: async (id: string) => ({ ok: true, value: { CLAUDE_CONFIG_DIR: `/profiles/${id}` } as EngineEnv }),
    },
    engine: {
      request: async (request: EngineRequest) => {
        requests.push(request);
        return { ok: true, value: replies[request.op] ?? { session: 's-unknown' } };
      },
    },
    worktrees: { fork: async () => ({ ok: true, value: { path: '/unused' } }) },
    now: () => NOW,
    random: () => {
      ids += 1;
      return ids / 0x10000;
    },
    schedule: () => () => undefined,
  };
  return new SessionsService(deps);
}

async function insertJob(store: StoreService): Promise<void> {
  const spec: JobSpec = {
    mode: 'single',
    goal: 'goal',
    repoPath: '/repo',
    orchestrator: { agent: 'claude', account: 'auto' },
    workers: ['claude'],
    checks: [],
    onLimit: 'switch-account',
  };
  await store.db.insert(jobTable).values({
    id: JOB,
    title: 'goal',
    mode: 'single',
    spec,
    status: 'running',
    step: null,
    createdAt: NOW.toISOString(),
    scheduledFor: null,
  });
}

async function statusOf(service: SessionsService, id: SessionId): Promise<Session['status'] | undefined> {
  const got = await service.get(id);
  return got.ok ? got.value.status : undefined;
}

function position(): Session['position'] {
  return { step: 'Implement', index: 1, total: 2, attempt: 1 };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'orch-sessions-'));
  stores = [];
  requests = [];
  replies = {};
  ids = 0;
  accounts = [account('claude-a', 'claude'), account('claude-b', 'claude'), account('codex-a', 'codex')];
});

afterEach(async () => {
  for (const s of stores) s.close();
  await rm(root, { recursive: true, force: true });
});

function opts(): { dbPath: string; backupDir: string } {
  return { dbPath: path.join(root, 'orch.db'), backupDir: path.join(root, 'backups') };
}

describe('sessions persistence (store-backed repository)', () => {
  it('keeps session records across a restart of the store', async () => {
    const first = openStore();
    await first.open(opts());
    await insertJob(first);
    const service = await makeService(first);
    const created = service.recordEngineSession({
      engineHandle: 's-engine-1',
      jobId: JOB,
      runId: 'r-1' as Session['runId'],
      title: 'goal',
      agent: 'claude',
      accountId: 'claude-a' as AccountId,
      worktree: WT,
      cwd: CWD,
      position: position(),
    });
    first.close();

    const second = openStore();
    await second.open(opts());
    const reopened = await makeService(second);
    const listed = await reopened.list('all');
    expect(listed.ok && listed.value.map((s) => s.id)).toEqual([created.id]);
    const record = new StoreSessionRepository(second).get(created.id);
    expect(record?.engineHandle).toBe('s-engine-1');
    expect(record?.cwd).toBe(CWD);
  });
});

describe('session producers (SES)', () => {
  it('creates one session per engine handle and updates it on later calls', async () => {
    const store = openStore();
    await store.open(opts());
    await insertJob(store);
    const service = await makeService(store);

    const first = service.recordEngineSession({
      engineHandle: 's-engine-1',
      jobId: JOB,
      runId: 'r-1' as Session['runId'],
      title: 'goal',
      agent: 'claude',
      accountId: 'claude-a' as AccountId,
      worktree: WT,
      cwd: CWD,
      position: position(),
      cliSessionId: 'cli-1',
    });
    expect(first.id).toMatch(/^s-[0-9a-f]{4}$/);
    expect(first.status).toBe('live');
    expect(first.cliSessionId).toBe('cli-1');

    const again = service.recordEngineSession({
      engineHandle: 's-engine-1',
      jobId: JOB,
      runId: 'r-1' as Session['runId'],
      title: 'goal',
      agent: 'claude',
      accountId: 'claude-b' as AccountId,
      worktree: WT,
      cwd: null,
      position: position(),
    });
    expect(again.id).toBe(first.id);
    expect(again.accountId).toBe('claude-b');
    const all = await service.list('all');
    expect(all.ok && all.value).toHaveLength(1);
    expect(new StoreSessionRepository(store).get(first.id)?.cwd).toBe(CWD);
  });

  it('feeds engine statuses into the session (failed: interrupted, stopped: ended)', async () => {
    const store = openStore();
    await store.open(opts());
    await insertJob(store);
    const service = await makeService(store);
    const created = service.recordEngineSession({
      engineHandle: 's-engine-2',
      jobId: JOB,
      runId: null,
      title: 'goal',
      agent: 'claude',
      accountId: 'claude-a' as AccountId,
      worktree: WT,
      cwd: CWD,
      position: position(),
    });

    service.applyEngineStatus('s-engine-2', 'failed');
    expect(await statusOf(service, created.id)).toBe('interrupted');

    service.applyEngineStatus('s-engine-2', 'stopped');
    expect(await statusOf(service, created.id)).toBe('ended');
  });

  it('a session that waits for its account resumes when quota reports the account available (SES-01)', async () => {
    const store = openStore();
    await store.open(opts());
    await insertJob(store);
    const service = await makeService(store);
    const waiting = service.recordEngineSession({
      engineHandle: 's-wait-a',
      jobId: JOB,
      runId: null,
      title: 'goal',
      agent: 'claude',
      accountId: 'claude-a' as AccountId,
      worktree: WT,
      cwd: CWD,
      position: position(),
    });
    const other = service.recordEngineSession({
      engineHandle: 's-wait-b',
      jobId: JOB,
      runId: null,
      title: 'other',
      agent: 'claude',
      accountId: 'claude-b' as AccountId,
      worktree: WT,
      cwd: CWD,
      position: position(),
    });
    new StoreSessionRepository(store).put({
      session: { ...waiting, status: 'paused' },
      engineHandle: 's-wait-a',
      cwd: CWD,
    });
    new StoreSessionRepository(store).put({
      session: { ...other, status: 'paused' },
      engineHandle: 's-wait-b',
      cwd: CWD,
    });

    await service.onAccountAvailable('claude-a' as AccountId);

    expect(requests).toEqual([{ op: 'session.resume', session: 's-wait-a', env: { CLAUDE_CONFIG_DIR: '/profiles/claude-a' } }]);
    expect(await statusOf(service, waiting.id)).toBe('live');
    expect(await statusOf(service, other.id)).toBe('paused');
  });

  it('a run resumed on another account moves its session record to that account (markResumed)', async () => {
    const store = openStore();
    await store.open(opts());
    await insertJob(store);
    const service = await makeService(store);
    const created = service.recordEngineSession({
      engineHandle: 's-moved',
      jobId: JOB,
      runId: null,
      title: 'goal',
      agent: 'claude',
      accountId: 'claude-a' as AccountId,
      worktree: WT,
      cwd: CWD,
      position: position(),
    });
    service.markResumed('s-moved', 'claude-b' as AccountId);
    const current = await service.get(created.id);
    expect(current.ok && current.value.accountId).toBe('claude-b');
  });

  it('hands the session to an agent in the same worktree, and the old session ends "Handed off to {id}" (SES-02)', async () => {
    const store = openStore();
    await store.open(opts());
    await insertJob(store);
    const service = await makeService(store);
    const old = service.recordEngineSession({
      engineHandle: 's-old',
      jobId: JOB,
      runId: 'r-1' as Session['runId'],
      title: 'goal',
      agent: 'claude',
      accountId: 'claude-a' as AccountId,
      worktree: WT,
      cwd: CWD,
      position: position(),
    });
    replies['session.handoff'] = { session: 's-new' };

    const handed = await service.handOffEngineSession('s-old', 'codex-a' as AccountId);

    expect(handed.ok).toBe(true);
    if (!handed.ok) return;
    expect(handed.value.engineHandle).toBe('s-new');
    expect(handed.value.session).toMatchObject({ agent: 'codex', accountId: 'codex-a', status: 'live', worktree: WT, handedOffFrom: old.id });
    expect(requests.find((r) => r.op === 'session.handoff')).toMatchObject({ from: 's-old', toAgent: 'codex', cwd: CWD });

    const ended = await service.get(old.id);
    expect(ended.ok && ended.value).toMatchObject({ status: 'ended', handedOffTo: handed.value.session.id });
    expect(ended.ok && ended.value.position.note).toBe(`Handed off to ${handed.value.session.id}`);
  });

  it('refuses a hand-off to an account of the same agent for an agent hand-off', async () => {
    const store = openStore();
    await store.open(opts());
    await insertJob(store);
    const service = await makeService(store);
    service.recordEngineSession({
      engineHandle: 's-same',
      jobId: JOB,
      runId: null,
      title: 'goal',
      agent: 'claude',
      accountId: 'claude-a' as AccountId,
      worktree: WT,
      cwd: CWD,
      position: position(),
    });
    const refused = await service.handOffEngineSession('s-same', 'claude-b' as AccountId);
    expect(refused.ok).toBe(false);
    expect(requests.some((r) => r.op === 'session.handoff')).toBe(false);
  });
});
