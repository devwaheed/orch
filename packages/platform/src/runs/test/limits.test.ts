import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AccountId, EngineEnv, JobId, JobSpec, Run, RunId, Timestamp, WorktreeId } from '@orch/contracts';
import { StoreService } from '../../store/node/storeService.js';
import { RunsService } from '../node/runsService.js';
import { type ManualClock, ManualScheduler } from './manualScheduler.js';
import type { IProfilesService, ProfileInfo } from '../../profiles/common/profiles.js';
import { jobTable } from '../../store/common/schema.js';

const RESET = '2026-10-11T16:00:00.000Z';
const START = Date.parse('2026-10-11T12:00:00.000Z');
const clock: ManualClock = { ms: START };
const SECOND = 1000;
const acctA = 'claude-a' as AccountId;
const acctB = 'claude-b' as AccountId;
const runId = 'r-1' as RunId;

let tempDir: string;
let store: StoreService;
let scheduler: ManualScheduler;
let randomValue: number;
let engineRequests: Array<{ op: string; env?: EngineEnv }>;
let services: RunsService[];

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

function makeService(): RunsService {
  const service = new RunsService({
    store,
    profiles: new FakeProfiles(),
    engine: {
      request: async (request) => {
        engineRequests.push({ op: request.op, ...('env' in request ? { env: request.env } : {}) });
        return { ok: true, value: undefined };
      },
    },
    now: () => new Date(clock.ms),
    random: () => randomValue,
    scheduler,
  });
  services.push(service);
  return service;
}

async function insertJob(id = 'j-1'): Promise<void> {
  const spec: JobSpec = {
    mode: 'single',
    goal: 'limit goal',
    repoPath: '/repo',
    orchestrator: { agent: 'claude', account: 'auto' },
    workers: ['claude'],
    checks: [],
    onLimit: 'ask',
  };
  await store.db.insert(jobTable).values({
    id,
    title: 'limit goal',
    mode: 'single',
    spec,
    status: 'running',
    step: null,
    createdAt: '2026-10-11T12:00:00.000Z',
    scheduledFor: null,
  });
}

async function recordRunningRun(service: RunsService, accountId: AccountId = acctA): Promise<void> {
  const run: Run = {
    id: runId,
    jobId: 'j-1' as JobId,
    parentId: null,
    depth: 0,
    role: 'implementer',
    task: 'limit goal',
    agent: 'claude',
    accountId,
    status: 'running',
    worktree: 'orch/r-1' as WorktreeId,
    readOnly: false,
    sessionId: null,
    startedAt: '2026-10-11T12:00:00.000Z',
    resumesAt: null,
  };
  await service.recordRun(run);
}

async function statusOf(service: RunsService) {
  const run = await service.getRun(runId);
  if (!run) throw new Error('run missing');
  return run;
}

function autoResumeLines(service: RunsService): Promise<string[]> {
  return service.lines(runId, -1).then((res) => (res.ok ? res.value.filter((l) => l.text.startsWith('Auto-resume')).map((l) => l.text) : []));
}

beforeEach(async () => {
  clock.ms = START;
  randomValue = 0;
  scheduler = new ManualScheduler(clock);
  engineRequests = [];
  services = [];
  tempDir = await mkdtemp(path.join(tmpdir(), 'orch-limits-test-'));
  store = new StoreService();
  await store.open({
    dbPath: path.join(tempDir, 'orch.db'),
    backupDir: path.join(tempDir, 'backups'),
  });
  await insertJob('j-1');
});

afterEach(async () => {
  for (const s of services) s.dispose();
  store.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe('auto-resume after a limit (QTA-03, QTA-04)', () => {
  it('resumes at the reset time when the jitter is 0, keeping the worktree', async () => {
    const service = makeService();
    await recordRunningRun(service);
    await service.pauseForLimit(runId, RESET as Timestamp);

    await scheduler.advance(Date.parse(RESET) - clock.ms - SECOND);
    expect((await statusOf(service)).status).toBe('paused_limit');

    await scheduler.advance(SECOND);
    const run = await statusOf(service);
    expect(run.status).toBe('running');
    expect(run.accountId).toBe(acctA);
    expect(run.worktree).toBe('orch/r-1');
    expect(run.resumesAt).toBeNull();
    expect(await autoResumeLines(service)).toEqual(['Auto-resume after the limit reset']);
  });

  it('adds a random delay of 0 to 120 whole seconds after the reset (QTA-04)', async () => {
    randomValue = 0.9999;
    const service = makeService();
    await recordRunningRun(service);
    await service.pauseForLimit(runId, RESET as Timestamp);

    await scheduler.advance(Date.parse(RESET) + 120 * SECOND - clock.ms - 1);
    expect((await statusOf(service)).status).toBe('paused_limit');

    await scheduler.advance(1);
    expect((await statusOf(service)).status).toBe('running');
  });

  it('maps the random value onto whole seconds (0.5 gives 60 s)', async () => {
    randomValue = 0.5;
    const service = makeService();
    await recordRunningRun(service);
    await service.pauseForLimit(runId, RESET as Timestamp);

    expect(scheduler.armed).toBe(1);
    await scheduler.advance(Date.parse(RESET) + 59 * SECOND - clock.ms);
    expect((await statusOf(service)).status).toBe('paused_limit');
    await scheduler.advance(SECOND);
    expect((await statusOf(service)).status).toBe('running');
  });

  it('arms nothing when the limit has no reset time; it holds until cleared', async () => {
    const service = makeService();
    await recordRunningRun(service);
    await service.pauseForLimit(runId, null);

    expect(scheduler.armed).toBe(0);
    await scheduler.advance(30 * 24 * 60 * 60 * SECOND);
    expect((await statusOf(service)).status).toBe('paused_limit');
  });

  it('waits longer than one timer period when the reset is far away', async () => {
    const service = makeService();
    await recordRunningRun(service);
    const farReset = new Date(clock.ms + 30 * 24 * 60 * 60 * SECOND).toISOString() as Timestamp;
    await service.pauseForLimit(runId, farReset);

    await scheduler.advance(25 * 24 * 60 * 60 * SECOND);
    expect((await statusOf(service)).status).toBe('paused_limit');

    await scheduler.advance(5 * 24 * 60 * 60 * SECOND + 2 * SECOND);
    expect((await statusOf(service)).status).toBe('running');
  });

  it('the auto-resume checkbox off cancels the timer; on again resumes at once if the time has passed', async () => {
    const service = makeService();
    await recordRunningRun(service);
    await service.pauseForLimit(runId, RESET as Timestamp);

    expect((await service.setAutoResume(runId, false)).ok).toBe(true);
    expect(scheduler.armed).toBe(0);
    await scheduler.advance(Date.parse(RESET) - clock.ms + 120 * SECOND);
    expect((await statusOf(service)).status).toBe('paused_limit');

    expect((await service.setAutoResume(runId, true)).ok).toBe(true);
    await scheduler.advance(0);
    expect((await statusOf(service)).status).toBe('running');
  });

  it('a manual resume on another account cancels the timer', async () => {
    const service = makeService();
    await recordRunningRun(service);
    await service.pauseForLimit(runId, RESET as Timestamp);

    const resumed = await service.resumeOn(runId, acctB);
    expect(resumed.ok).toBe(true);
    expect(scheduler.armed).toBe(0);

    await scheduler.advance(Date.parse(RESET) + 200 * SECOND - clock.ms);
    const run = await statusOf(service);
    expect(run.accountId).toBe(acctB);
    expect(run.status).toBe('running');
    expect(await autoResumeLines(service)).toEqual([]);
  });

  it('Start now cancels the timer', async () => {
    const service = makeService();
    await recordRunningRun(service);
    await service.pauseForLimit(runId, RESET as Timestamp);

    expect((await service.startNow(runId)).ok).toBe(true);
    expect(scheduler.armed).toBe(0);
    expect(await autoResumeLines(service)).toEqual([]);
  });

  it('stopping a paused run cancels the timer and it stays stopped', async () => {
    const service = makeService();
    await recordRunningRun(service);
    await service.pauseForLimit(runId, RESET as Timestamp);

    expect((await service.stop(runId)).ok).toBe(true);
    expect(scheduler.armed).toBe(0);
    await scheduler.advance(Date.parse(RESET) + 200 * SECOND - clock.ms);
    expect((await statusOf(service)).status).toBe('stopped');
  });

  it('pausing a paused run cancels the timer', async () => {
    const service = makeService();
    await recordRunningRun(service);
    await service.pauseForLimit(runId, RESET as Timestamp);

    expect((await service.pause(runId)).ok).toBe(true);
    expect(scheduler.armed).toBe(0);
  });

  it('a restart re-arms the timer from the stored schedule (survives a core host restart)', async () => {
    randomValue = 0.5;
    const first = makeService();
    await recordRunningRun(first);
    await first.pauseForLimit(runId, RESET as Timestamp);
    first.dispose();
    expect(scheduler.armed).toBe(0);

    // A new service over the same store, as after a restart.
    const second = makeService();
    await second.restoreSchedules();
    expect(scheduler.armed).toBe(1);

    await scheduler.advance(Date.parse(RESET) + 59 * SECOND - clock.ms);
    expect((await statusOf(second)).status).toBe('paused_limit');
    await scheduler.advance(SECOND);
    expect((await statusOf(second)).status).toBe('running');
    expect(engineRequests.filter((r) => r.op === 'session.resume')).toHaveLength(0);
  });

  it('a restart after the stored time has passed resumes on the next tick', async () => {
    const first = makeService();
    await recordRunningRun(first);
    await first.pauseForLimit(runId, RESET as Timestamp);
    first.dispose();

    clock.ms = Date.parse(RESET) + 10 * 60 * SECOND;
    const second = makeService();
    await second.restoreSchedules();
    await scheduler.advance(0);
    expect((await statusOf(second)).status).toBe('running');
  });

  it('the checkbox survives a restart: a run with auto-resume off is not re-armed', async () => {
    const first = makeService();
    await recordRunningRun(first);
    await first.pauseForLimit(runId, RESET as Timestamp);
    await first.setAutoResume(runId, false);
    first.dispose();

    const second = makeService();
    await second.restoreSchedules();
    expect(scheduler.armed).toBe(0);
    await scheduler.advance(Date.parse(RESET) + 200 * SECOND - clock.ms);
    expect((await statusOf(second)).status).toBe('paused_limit');
  });

  it('defaults auto-resume on for a new run (the checkbox is on unless the user turns it off)', async () => {
    const service = makeService();
    await recordRunningRun(service);
    await service.pauseForLimit(runId, RESET as Timestamp);
    expect(scheduler.armed).toBe(1);
  });
});
