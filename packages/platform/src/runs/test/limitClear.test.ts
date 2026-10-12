/**
 * QTA-03 / QTA-04 limit clear: a run paused by a limit with no known reset time
 * resumes on its account when quota reports the account available again. Runs
 * with a reset time keep their timer. Real store; the engine and sessions are fakes.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AccountId, EngineEnv, EngineRequest, JobId, JobSpec, Run, RunId, SessionId, Timestamp, WorktreeId } from '@orchagents/contracts';
import { StoreService } from '../../store/node/storeService.js';
import { jobTable } from '../../store/common/schema.js';
import { RunsService } from '../node/runsService.js';
import { CONTINUE_AFTER_LIMIT } from '../common/runs.js';
import type { IProfilesService, ProfileInfo } from '../../profiles/common/profiles.js';
import { ManualScheduler, type ManualClock } from './manualScheduler.js';

const START = Date.parse('2026-10-11T12:00:00.000Z');
const RESET = '2026-10-11T16:00:00.000Z' as Timestamp;
const acctA = 'claude-a' as AccountId;
const acctB = 'claude-b' as AccountId;
const JOB = 'j-1' as JobId;

let tempDir: string;
let store: StoreService;
let requests: EngineRequest[];
let marked: Array<[string, AccountId]>;
let clock: ManualClock;

class FakeProfiles implements IProfilesService {
  async create(): Promise<{ ok: true; value: ProfileInfo }> {
    throw new Error('not implemented');
  }
  async remove(): Promise<{ ok: true; value: void }> {
    return { ok: true, value: undefined };
  }
  async setSharedSkills(): Promise<{ ok: true; value: boolean }> {
    return { ok: true, value: true };
  }
  async sessionEnv(accountId: string): Promise<{ ok: true; value: EngineEnv }> {
    return { ok: true, value: { CLAUDE_CONFIG_DIR: `/path/${accountId}` } };
  }
}

function service(autoScheduler = new ManualScheduler(clock)): RunsService {
  return new RunsService({
    store,
    profiles: new FakeProfiles(),
    engine: {
      request: async (request: EngineRequest) => {
        requests.push(request);
        return { ok: true, value: { session: 's-1' } };
      },
    },
    sessions: {
      markResumed: (handle: string, accountId: AccountId) => {
        marked.push([handle, accountId]);
      },
    },
    now: () => new Date(clock.ms),
    random: () => 0,
    scheduler: autoScheduler,
  });
}

async function pausedRun(svc: RunsService, id: string, accountId: AccountId, resetsAt: Timestamp | null, autoResume = true): Promise<RunId> {
  const runId = id as RunId;
  await store.db.insert(jobTable).values({
    id: JOB,
    title: 'goal',
    mode: 'single',
    spec: {
      mode: 'single',
      goal: 'goal',
      repoPath: '/repo',
      orchestrator: { agent: 'claude', account: 'auto' },
      workers: ['claude'],
      checks: [],
      onLimit: 'switch-account',
    } satisfies JobSpec,
    status: 'running',
    step: null,
    createdAt: '2026-10-11T12:00:00.000Z',
    scheduledFor: null,
  }).onConflictDoNothing();
  const run: Run = {
    id: runId,
    jobId: JOB,
    parentId: null,
    depth: 0,
    role: 'implementer',
    task: 'goal',
    agent: 'claude',
    accountId,
    status: 'running',
    worktree: `orch/${id}` as WorktreeId,
    readOnly: false,
    sessionId: `s-${id}` as SessionId,
    startedAt: '2026-10-11T12:00:00.000Z' as Timestamp,
    resumesAt: null,
  };
  await svc.recordRun(run);
  await svc.pauseForLimit(runId, resetsAt);
  if (!autoResume) await svc.setAutoResume(runId, false);
  requests.length = 0;
  return runId;
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'orch-limit-clear-'));
  store = new StoreService();
  await store.open({ dbPath: path.join(tempDir, 'orch.db'), backupDir: path.join(tempDir, 'backups') });
  requests = [];
  marked = [];
  clock = { ms: START };
});

afterEach(async () => {
  store.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe('a limit clears: runs waiting on the account resume (QTA-03, QTA-05)', () => {
  it('resumes a run paused with no reset time on its account, and moves its session record', async () => {
    const svc = service();
    const runId = await pausedRun(svc, 'r-1', acctA, null);
    expect((await svc.getRun(runId))?.status).toBe('paused_limit');

    await svc.resumeWaitingOn(acctA);

    const run = await svc.getRun(runId);
    expect(run).toMatchObject({ status: 'running', accountId: acctA });
    // The session is revived on the account, then the agent is told to carry on (it stopped mid-turn).
    expect(requests).toEqual([
      { op: 'session.resume', session: 's-r-1', env: { CLAUDE_CONFIG_DIR: `/path/${acctA}` } },
      { op: 'session.send', session: 's-r-1', text: CONTINUE_AFTER_LIMIT },
    ]);
    expect(marked).toEqual([['s-r-1', acctA]]);
  });

  it('leaves a run with a reset time alone: its timer resumes it (reset plus jitter)', async () => {
    const svc = service();
    const runId = await pausedRun(svc, 'r-2', acctA, RESET);

    await svc.resumeWaitingOn(acctA);

    expect((await svc.getRun(runId))?.status).toBe('paused_limit');
    expect(requests).toEqual([]);
  });

  it('leaves a run alone when auto-resume is off, or when it waits on another account', async () => {
    const svc = service();
    const off = await pausedRun(svc, 'r-3', acctA, null, false);
    const elsewhere = await pausedRun(svc, 'r-4', acctB, null);

    await svc.resumeWaitingOn(acctA);

    expect((await svc.getRun(off))?.status).toBe('paused_limit');
    expect((await svc.getRun(elsewhere))?.status).toBe('paused_limit');
    expect(requests).toEqual([]);
  });
});
