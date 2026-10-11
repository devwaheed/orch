import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  AccountId,
  AgentId,
  EngineEnv,
  EngineEvent,
  EngineRequest,
  JobSpec,
  LimitPolicy,
  PickAccountResult,
  QuotaObservation,
  Result,
  RunId,
} from '@orch/contracts';
import { createFakeAdapter } from '../../adapters/node/fake.js';
import { StoreService } from '../../store/node/storeService.js';
import { GitService, runGit } from '../../git/node/gitService.js';
import { RunsService } from '../../runs/node/runsService.js';
import { type ManualClock, ManualScheduler } from '../../runs/test/manualScheduler.js';
import { JobsService } from '../node/jobsService.js';
import type { IProfilesService, ProfileInfo } from '../../profiles/common/profiles.js';

/**
 * Each onLimit policy (JOB-08, QTA-03, QTA-04) applied to a limit that hits mid-run.
 * No real agent: the engine is a fake that records requests and lets the test emit events.
 */

const RESET = '2026-10-11T16:00:00.000Z';
const START = Date.parse('2026-10-11T12:00:00.000Z');
const acctA = 'claude-a' as AccountId;
const acctB = 'claude-b' as AccountId;
const runId = 'r-1' as RunId;
const LIMIT_TEXT = `Rate limit reached. Resets at ${RESET} (window: 5h, used: 100%)`;

let root = '';
let repoDir = '';
let store: StoreService;
let clock: ManualClock;
let scheduler: ManualScheduler;
let jobs: JobsService;
let runs: RunsService;
let engineRequests: EngineRequest[];
let engineListeners: Array<(event: EngineEvent) => void>;
let limitedAccounts: Set<string>;

class TestProfiles implements IProfilesService {
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
    return { ok: true, value: { CLAUDE_CONFIG_DIR: `/profiles/${accountId}` } };
  }
}

const quota = {
  async pickAccount(agent: AgentId): Promise<{ ok: true; value: PickAccountResult }> {
    if (agent !== 'claude') return { ok: true, value: { kind: 'none', agent, reason: 'unsupported' } };
    if (!limitedAccounts.has(acctA)) return { ok: true, value: { kind: 'account', accountId: acctA } };
    if (!limitedAccounts.has(acctB)) return { ok: true, value: { kind: 'account', accountId: acctB } };
    return { ok: true, value: { kind: 'wait', until: RESET, agent } };
  },
  observe(observation: QuotaObservation): Result<void> {
    if (observation.limited) limitedAccounts.add(observation.accountId);
    return { ok: true, value: undefined };
  },
};

const engine = {
  async request(request: EngineRequest): Promise<Result<unknown>> {
    engineRequests.push(request);
    if (request.op === 'workflow.start') {
      return { ok: true, value: { workflow: 'wf-1' } };
    }
    return { ok: true, value: undefined };
  },
  onEvent(listener: (event: EngineEvent) => void): () => void {
    engineListeners.push(listener);
    return () => {
      engineListeners = engineListeners.filter((l) => l !== listener);
    };
  },
};

function emit(event: EngineEvent): void {
  for (const listener of engineListeners) listener(event);
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timed out waiting for condition');
}

async function runOf() {
  const res = await runs.getRun(runId);
  if (!res) throw new Error('run missing');
  return res;
}

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'orch-limit-policy-'));
  repoDir = path.join(root, 'repo');
  mkdirSync(repoDir, { recursive: true });
  await runGit(['init', '-b', 'main', repoDir]);
  await runGit(['-C', repoDir, 'config', 'user.name', 'Test']);
  await runGit(['-C', repoDir, 'config', 'user.email', 'test@example.com']);
  writeFileSync(path.join(repoDir, 'README.md'), '# Main Repo\n', 'utf8');
  await runGit(['-C', repoDir, 'add', '.']);
  await runGit(['-C', repoDir, 'commit', '-m', 'Initial commit']);

  store = new StoreService();
  await store.open({ dbPath: path.join(root, 'orch.db'), backupDir: path.join(root, 'backups') });

  clock = { ms: START };
  scheduler = new ManualScheduler(clock);
  engineRequests = [];
  engineListeners = [];
  limitedAccounts = new Set();

  runs = new RunsService({
    store,
    profiles: new TestProfiles(),
    engine,
    now: () => new Date(clock.ms),
    random: () => 0,
    scheduler,
  });
  jobs = new JobsService({
    store,
    quota,
    profiles: new TestProfiles(),
    engine,
    git: new GitService(),
    runs,
    now: () => new Date(clock.ms),
    adapterFor: (agent) => createFakeAdapter(agent),
  });
});

afterEach(async () => {
  runs.dispose();
  store.close();
  rmSync(root, { recursive: true, force: true });
});

/** Starts a single-mode job on account A, then reports a session and a limit mid-run. */
async function startAndHitLimit(onLimit: LimitPolicy): Promise<void> {
  const spec: JobSpec = {
    mode: 'single',
    goal: 'hit a limit',
    repoPath: repoDir,
    orchestrator: { agent: 'claude', account: acctA },
    workers: ['claude'],
    checks: [],
    onLimit,
  };
  const started = await jobs.start(spec);
  if (!started.ok) throw new Error(started.error.message);

  // The first output line binds the session to the workflow's run (JOB-03).
  emit({ type: 'session.output', session: 's-1', seq: 1, kind: 'message', text: 'working' });
  emit({ type: 'session.status', session: 's-1', status: 'running' });
  await waitFor(async () => (await runOf()).sessionId === 's-1');

  emit({ type: 'session.output', session: 's-1', seq: 2, kind: 'result', text: LIMIT_TEXT });
}

function sessionResumes() {
  return engineRequests.filter((r): r is Extract<EngineRequest, { op: 'session.resume' }> => r.op === 'session.resume');
}

describe('onLimit policies on a limit mid-run (QTA-03, QTA-04, JOB-08)', () => {
  it('switch-account moves the run to another account now, keeps the worktree and resumes the session', async () => {
    await startAndHitLimit('switch-account');

    await waitFor(async () => (await runOf()).accountId === acctB && (await runOf()).status === 'running');
    expect(sessionResumes()).toEqual([
      { op: 'session.resume', session: 's-1', env: { CLAUDE_CONFIG_DIR: '/profiles/claude-b' } },
    ]);
    expect(existsSync(path.join(repoDir, '.orch', 'wt', 'r-1'))).toBe(true);
    expect(scheduler.armed).toBe(0);
  });

  it('ask leaves the run paused on its account and arms auto-resume at the reset time', async () => {
    await startAndHitLimit('ask');

    await waitFor(async () => (await runOf()).status === 'paused_limit' && scheduler.armed === 1);
    const run = await runOf();
    expect(run.accountId).toBe(acctA);
    expect(run.resumesAt).toBe(RESET);
    expect(sessionResumes()).toHaveLength(0);
    expect(existsSync(path.join(repoDir, '.orch', 'wt', 'r-1'))).toBe(true);

    // Auto-resume fires at the reset time on the same account, with the session kept.
    await scheduler.advance(Date.parse(RESET) - clock.ms);
    await waitFor(async () => (await runOf()).status === 'running');
    expect((await runOf()).accountId).toBe(acctA);
    expect(sessionResumes()).toEqual([
      { op: 'session.resume', session: 's-1', env: { CLAUDE_CONFIG_DIR: '/profiles/claude-a' } },
    ]);
  });

  it('switch-agent does not move the run to another account; it waits as ask does (open question: no spec defines it)', async () => {
    await startAndHitLimit('switch-agent');

    await waitFor(async () => (await runOf()).status === 'paused_limit' && scheduler.armed === 1);
    expect((await runOf()).accountId).toBe(acctA);
    expect(sessionResumes()).toHaveLength(0);
  });

  it('manual Resume now on another account cancels the scheduled auto-resume', async () => {
    await startAndHitLimit('ask');
    await waitFor(async () => scheduler.armed === 1);

    const resumed = await runs.resumeOn(runId, acctB);
    expect(resumed.ok).toBe(true);
    expect(scheduler.armed).toBe(0);

    await scheduler.advance(Date.parse(RESET) + 120_000 - clock.ms);
    expect((await runOf()).accountId).toBe(acctB);
    expect(sessionResumes()).toHaveLength(1);
  });

  it('abandoned workflow verdict does not overwrite the run after switch-account (QTA-03, JOB-08)', async () => {
    await startAndHitLimit('switch-account');

    await waitFor(async () => (await runOf()).accountId === acctB && (await runOf()).status === 'running');

    // The workflow on account A that hit the limit now finishes with failure
    emit({ type: 'verdict', workflow: 'wf-1', verdict: 'unverified', evidenceRef: null });
    await new Promise((r) => setTimeout(r, 50));

    // The run must stay running on account B, not overwritten by wf-1's verdict
    const run = await runOf();
    expect(run.accountId).toBe(acctB);
    expect(run.status).toBe('running');
  });
});
