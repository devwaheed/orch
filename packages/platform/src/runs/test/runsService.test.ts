import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AccountId, EngineEnv, JobId, JobSpec, OrchEvent, Run, RunId } from '@orchagents/contracts';
import { StoreService } from '../../store/node/storeService.js';
import { RunsService } from '../node/runsService.js';
import type { IProfilesService, ProfileInfo } from '../../profiles/common/profiles.js';
import { jobTable } from '../../store/common/schema.js';

let tempDir: string;
let store: StoreService;
let runsService: RunsService;
const events: OrchEvent[] = [];

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

async function insertTestJob(id: string = 'j-1') {
  const spec: JobSpec = {
    mode: 'single',
    goal: 'test goal',
    repoPath: '/repo',
    orchestrator: { agent: 'claude', account: 'auto' },
    workers: ['claude'],
    checks: [],
    onLimit: 'switch-account',
  };
  await store.db.insert(jobTable).values({
    id,
    title: 'test goal',
    mode: 'single',
    spec,
    status: 'running',
    step: null,
    createdAt: '2026-10-11T12:00:00.000Z',
    scheduledFor: null,
  });
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'orch-runs-test-'));
  store = new StoreService();
  await store.open({
    dbPath: path.join(tempDir, 'orch.db'),
    backupDir: path.join(tempDir, 'backups'),
  });

  events.length = 0;
  runsService = new RunsService({
    store,
    profiles: new FakeProfiles(),
    onEvent: (e) => events.push(e),
  });
});

afterEach(async () => {
  store.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe('RunsService', () => {
  it('nextRunId generates sequential base-36 IDs (JOB-01)', async () => {
    expect(await runsService.nextRunId()).toBe('r-1');
  });

  it('records, gets and lists runs', async () => {
    await insertTestJob('j-1');
    const runId = await runsService.nextRunId();
    const run: Run = {
      id: runId,
      jobId: 'j-1' as JobId,
      parentId: null,
      depth: 0,
      role: 'implementer',
      task: 'do task',
      agent: 'claude',
      accountId: 'claude-a' as AccountId,
      status: 'running',
      worktree: null,
      readOnly: false,
      sessionId: null,
      startedAt: '2026-10-11T12:00:00.000Z',
      resumesAt: null,
    };

    await runsService.recordRun(run);
    expect(events.some((e) => e.type === 'run.changed' && e.run.id === runId)).toBe(true);

    const fetched = await runsService.getRun(runId);
    expect(fetched).toEqual(run);

    const listRes = await runsService.list('j-1' as JobId);
    expect(listRes.ok).toBe(true);
    if (!listRes.ok) return;
    expect(listRes.value).toHaveLength(1);
    expect(listRes.value[0]?.id).toBe(runId);

    // Next ID should now be r-2
    expect(await runsService.nextRunId()).toBe('r-2');
  });

  it('appendLine stores and retrieves run lines and emits run.line', async () => {
    const runId = 'r-1' as RunId;
    runsService.appendLine(runId, 'prompt', 'hello');
    runsService.appendLine(runId, 'meta', 'working');
    runsService.appendLine(runId, 'ok', 'done');

    const linesRes = await runsService.lines(runId, 0);
    expect(linesRes.ok).toBe(true);
    if (!linesRes.ok) return;
    expect(linesRes.value).toHaveLength(2);
    expect(linesRes.value[0]?.text).toBe('working');
    expect(linesRes.value[1]?.text).toBe('done');

    expect(events.filter((e) => e.type === 'run.line')).toHaveLength(3);
  });

  it('pause, stop, startNow, and resumeOn update run status', async () => {
    await insertTestJob('j-1');
    const runId = 'r-1' as RunId;
    const run: Run = {
      id: runId,
      jobId: 'j-1' as JobId,
      parentId: null,
      depth: 0,
      role: 'implementer',
      task: 'do task',
      agent: 'claude',
      accountId: 'claude-a' as AccountId,
      status: 'running',
      worktree: null,
      readOnly: false,
      sessionId: null,
      startedAt: '2026-10-11T12:00:00.000Z',
      resumesAt: null,
    };
    await runsService.recordRun(run);

    // Pause -> stopped
    await runsService.pause(runId);
    let current = await runsService.getRun(runId);
    expect(current?.status).toBe('stopped');

    // startNow -> running
    await runsService.startNow(runId);
    current = await runsService.getRun(runId);
    expect(current?.status).toBe('running');

    // resumeOn -> switches account
    const resumed = await runsService.resumeOn(runId, 'claude-b' as AccountId);
    expect(resumed.ok).toBe(true);
    current = await runsService.getRun(runId);
    expect(current?.accountId).toBe('claude-b');
    expect(current?.status).toBe('running');
  });
});
