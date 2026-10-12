import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type {
  AccountId,
  AgentId,
  EngineEnv,
  EngineEvent,
  EngineRequest,
  JobSpec,
  PickAccountResult,
  QuotaObservation,
  Result,
  RunId,
} from '@orchagents/contracts';
import { createFakeAdapter } from '../../adapters/node/fake.js';
import { StoreService } from '../../store/node/storeService.js';
import { GitService, runGit } from '../../git/node/gitService.js';
import { RunsService } from '../../runs/node/runsService.js';
import { CONTINUE_AFTER_LIMIT } from '../../runs/common/runs.js';
import { type ManualClock, ManualScheduler } from '../../runs/test/manualScheduler.js';
import { JobsService } from '../node/jobsService.js';
import { reviewTable } from '../../store/common/schema.js';
import type { IProfilesService, ProfileInfo } from '../../profiles/common/profiles.js';

/**
 * F-06 / ADR 0008: a run resumed OUTSIDE its engine workflow (switch-account,
 * switch-agent, manual or auto resume) never gets the workflow verdict, because
 * the abandoned workflow keeps its spawn account and its late verdict is ignored
 * (F-04, commit 9744107). When the resumed session goes idle, orch itself must
 * run the job's checks and the two always-on guardrails, then record the verdict.
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
let verifyPassed: boolean;

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
    if (request.op === 'verify.run') {
      return { ok: true, value: { evidenceId: 'ev-1', passed: verifyPassed, rounds: 1 } };
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

function worktreePath(): string {
  return path.join(repoDir, '.orch', 'wt', runId);
}

function verifyRequests() {
  return engineRequests.filter((r): r is Extract<EngineRequest, { op: 'verify.run' }> => r.op === 'verify.run');
}

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'orch-verify-resumed-'));
  repoDir = path.join(root, 'repo');
  mkdirSync(repoDir, { recursive: true });
  await runGit(['init', '-b', 'main', repoDir]);
  await runGit(['-C', repoDir, 'config', 'user.name', 'Test']);
  await runGit(['-C', repoDir, 'config', 'user.email', 'test@example.com']);
  writeFileSync(path.join(repoDir, 'README.md'), '# Main Repo\n', 'utf8');
  mkdirSync(path.join(repoDir, 'test'), { recursive: true });
  writeFileSync(path.join(repoDir, 'test', 'existing.test.js'), '// original test\n', 'utf8');
  await runGit(['-C', repoDir, 'add', '.']);
  await runGit(['-C', repoDir, 'commit', '-m', 'Initial commit']);

  store = new StoreService();
  await store.open({ dbPath: path.join(root, 'orch.db'), backupDir: path.join(root, 'backups') });

  clock = { ms: START };
  scheduler = new ManualScheduler(clock);
  engineRequests = [];
  engineListeners = [];
  limitedAccounts = new Set();
  verifyPassed = true;

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

/** Starts a single-mode job on account A, binds a session, then reports a limit mid-run. */
async function startAndHitLimit(onLimit: JobSpec['onLimit']): Promise<void> {
  const spec: JobSpec = {
    mode: 'single',
    goal: 'run that gets resumed',
    repoPath: repoDir,
    orchestrator: { agent: 'claude', account: acctA },
    workers: ['claude'],
    checks: [{ kind: 'command', run: `${process.execPath} -e "process.exit(0)"` }],
    onLimit,
  };
  const started = await jobs.start(spec);
  if (!started.ok) throw new Error(started.error.message);

  emit({ type: 'session.output', session: 's-1', seq: 1, kind: 'message', text: 'working' });
  emit({ type: 'session.status', session: 's-1', status: 'running' });
  await waitFor(async () => (await runOf()).sessionId === 's-1');

  emit({ type: 'session.output', session: 's-1', seq: 2, kind: 'result', text: LIMIT_TEXT });
}

/** The engine reports the resumed session running, then idle when the continue turn ends. */
function resumedTurnEnds(): void {
  emit({ type: 'session.status', session: 's-1', status: 'running' });
  emit({ type: 'session.status', session: 's-1', status: 'idle' });
}

async function jobOf() {
  const res = await jobs.list();
  if (!res.ok) throw new Error(res.error.message);
  return res.value[0]!;
}

async function reviewOf() {
  const [row] = await store.db.select().from(reviewTable).where(eq(reviewTable.jobId, 'j-1'));
  return row;
}

describe('a run resumed outside its workflow is verified by orch (F-06, ADR 0008)', () => {
  it('switch-account then idle: run gets verdict verified when the check passes (QTA-03, QTA-04, REV-03)', async () => {
    verifyPassed = true;
    await startAndHitLimit('switch-account');

    await waitFor(async () => (await runOf()).accountId === acctB && (await runOf()).status === 'running');

    // The idle that closes the limited turn itself is not the end of the resumed work.
    emit({ type: 'session.status', session: 's-1', status: 'idle' });
    await new Promise((r) => setTimeout(r, 50));
    expect(verifyRequests()).toHaveLength(0);

    // The resume told the agent to continue; that turn runs and ends.
    expect(engineRequests).toContainEqual({ op: 'session.send', session: 's-1', text: CONTINUE_AFTER_LIMIT });
    resumedTurnEnds();

    await waitFor(async () => (await jobOf()).status === 'done');

    const run = await runOf();
    expect(run.status).toBe('done');

    const review = await reviewOf();
    expect(review).toBeDefined();
    expect(review?.verdict).toBe('verified');
    expect(review?.state).toBe('ready');

    // Checks ran through the engine's verifier in the run's worktree.
    const verify = verifyRequests();
    expect(verify).toHaveLength(1);
    expect(verify[0]?.cwd).toBe(worktreePath());
  });

  it('switch-account then idle: run gets verdict refuted when the check fails', async () => {
    verifyPassed = false;
    await startAndHitLimit('switch-account');

    await waitFor(async () => (await runOf()).accountId === acctB && (await runOf()).status === 'running');
    resumedTurnEnds();

    await waitFor(async () => (await jobOf()).status === 'failed');

    const run = await runOf();
    expect(run.status).toBe('failed');

    const review = await reviewOf();
    expect(review?.verdict).toBe('refuted');
    expect(review?.state).toBe('failing');
  });

  it('guardrail failure after resume: verdict is refuted even when the check passes (JOB-05, JOB-06)', async () => {
    verifyPassed = true;
    await startAndHitLimit('switch-account');

    await waitFor(async () => (await runOf()).accountId === acctB && (await runOf()).status === 'running');

    // The resumed agent tampered with an existing test file in its worktree.
    writeFileSync(path.join(worktreePath(), 'test', 'existing.test.js'), '// TAMPERED TEST CONTENT\n', 'utf8');

    resumedTurnEnds();

    await waitFor(async () => (await jobOf()).status === 'failed');

    const review = await reviewOf();
    expect(review?.verdict).toBe('refuted');

    const protectedCheck = review?.checks.find(
      (c) => c.check.kind === 'guardrail' && c.check.rule === 'protected_files',
    );
    expect(protectedCheck?.status).toBe('failed');
  });

  it('the abandoned workflow verdict cannot overwrite the resumed run (F-04, F-06)', async () => {
    verifyPassed = true;
    await startAndHitLimit('switch-account');

    await waitFor(async () => (await runOf()).accountId === acctB && (await runOf()).status === 'running');

    // The old workflow on account A finishes after the switch and reports failure.
    emit({ type: 'verdict', workflow: 'wf-1', verdict: 'unverified', evidenceRef: null });
    resumedTurnEnds();

    await waitFor(async () => (await jobOf()).status === 'done');

    const review = await reviewOf();
    expect(review?.verdict).toBe('verified');
  });
});
