import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  AccountId,
  AgentId,
  EngineEnv,
  JobId,
  JobSpec,
  OrchEvent,
  PickAccountResult,
  QuotaObservation,
  Run,
  RunId,
  SessionId,
  Timestamp,
  WorktreeId,
} from '@orch/contracts';
import { EngineClient } from '../../engine/common/engineClient.js';
import { createPortPair } from '../../engine/test/portPair.js';
import { serveEngine, type ServedEngine } from '../../engine/node/serve.js';
import type { EngineHost } from '../../engine/node/engineHost.js';
import { FAKE_AGENT_SCRIPT_PATH, createFakeAdapter } from '../../adapters/node/fake.js';
import { StoreService } from '../../store/node/storeService.js';
import { GitService, runGit } from '../../git/node/gitService.js';
import { RunsService } from '../../runs/node/runsService.js';
import { JobsService } from '../../jobs/node/jobsService.js';
import { ReviewService } from './reviewService.js';
import type { IProfilesService, ProfileInfo } from '../../profiles/common/profiles.js';
import { jobTable, reviewTable, trustLevelTable } from '../../store/common/schema.js';
import { eq } from 'drizzle-orm';

let root = '';
let engineDir = '';
let repoDir = '';
let client: EngineClient;
let host: EngineHost;
let served: ServedEngine;
let store: StoreService;
let gitService: GitService;
let runsService: RunsService;
let jobsService: JobsService;
let reviewService: ReviewService;
const events: OrchEvent[] = [];

let dirA = '';
const acctA: AccountId = 'claude-a' as AccountId;

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
    void accountId;
    return { ok: true, value: { CLAUDE_CONFIG_DIR: dirA } };
  }
}

class TestQuota {
  async pickAccount(agent: AgentId): Promise<{ ok: true; value: PickAccountResult }> {
    if (agent === 'claude') {
      return { ok: true, value: { kind: 'account', accountId: acctA } };
    }
    return { ok: true, value: { kind: 'none', agent, reason: 'unsupported' } };
  }
  observe(obs: QuotaObservation) {
    void obs;
    return { ok: true as const, value: undefined };
  }
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timed out waiting for condition');
}

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'orch-review-integration-'));
  engineDir = path.join(root, 'engine');
  const home = path.join(engineDir, 'home');
  mkdirSync(home, { recursive: true });

  dirA = path.join(root, 'acct-a');
  mkdirSync(dirA, { recursive: true });
  writeFileSync(
    path.join(dirA, 'account.json'),
    JSON.stringify({ emailMasked: 'a•••@example.com', plan: 'pro', signedIn: true }),
  );

  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('CLAWO_NO_EMBEDDED_SERVER', '1');
  vi.stubEnv('CLAWO_WF_DIR', path.join(engineDir, 'wf'));
  vi.stubEnv('CLAWO_RUNS_DIR', path.join(engineDir, 'runs'));

  const { createEngineHost } = await import('../../engine/node/engineHost.js');
  host = await createEngineHost({
    engineDir,
    realHome: { HOME: path.join(root, 'real-home') },
    claudeBin: FAKE_AGENT_SCRIPT_PATH,
  });
  const pair = createPortPair();
  served = serveEngine(host, pair.right);
  client = new EngineClient(pair.left);

  store = new StoreService();
  await store.open({
    dbPath: path.join(root, 'orch.db'),
    backupDir: path.join(root, 'backups'),
  });

  gitService = new GitService();
  repoDir = path.join(root, 'repo');
  mkdirSync(repoDir, { recursive: true });
  await runGit(['init', '-b', 'main', repoDir]);
  await runGit(['-C', repoDir, 'config', 'user.name', 'Test User']);
  await runGit(['-C', repoDir, 'config', 'user.email', 'test@example.com']);
  writeFileSync(path.join(repoDir, 'README.md'), '# Main Repo\n', 'utf8');
  mkdirSync(path.join(repoDir, 'test'), { recursive: true });
  writeFileSync(path.join(repoDir, 'test', 'existing.test.js'), '// original test\n', 'utf8');
  await runGit(['-C', repoDir, 'add', '.']);
  await runGit(['-C', repoDir, 'commit', '-m', 'Initial commit']);

  const testQuota = new TestQuota();
  runsService = new RunsService({
    store,
    profiles: new TestProfiles(),
    engine: client,
    onEvent: (e) => events.push(e),
  });

  jobsService = new JobsService({
    store,
    quota: testQuota,
    profiles: new TestProfiles(),
    engine: client,
    git: gitService,
    runs: runsService,
    onEvent: (e) => events.push(e),
    adapterFor: (a) => createFakeAdapter(a),
  });

  reviewService = new ReviewService({
    store,
    git: gitService,
    runs: runsService,
    jobs: jobsService,
    engine: client,
    onEvent: (e) => events.push(e),
  });
});

afterAll(async () => {
  served?.close();
  client?.close();
  await host?.dispose();
  store?.close();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe('ReviewService basic operations', () => {
  it('list and get return not_found for non-existent review', async () => {
    const res = await reviewService.get('orch/non-existent' as WorktreeId);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('not_found');
    }
  });

  it('correct records a correction in the store', async () => {
    // Insert a dummy review row
    await store.db.insert(jobTable).values({
      id: 'j-test-correct' as JobId,
      title: 'Test job',
      mode: 'single',
      spec: {
        mode: 'single',
        goal: 'test',
        repoPath: repoDir,
        orchestrator: { agent: 'claude', account: 'auto' },
        workers: ['claude'],
        checks: [],
        onLimit: 'switch-account',
      },
      status: 'failed',
      step: null,
      createdAt: new Date().toISOString(),
      scheduledFor: null,
    });

    await store.db.insert(reviewTable).values({
      worktree: 'orch/r-test-correct' as WorktreeId,
      jobId: 'j-test-correct' as JobId,
      runId: 'r-test-correct' as RunId,
      sessionId: null,
      title: 'Test job',
      state: 'failing',
      verdict: 'refuted',
      checks: [],
      files: [],
      evidenceRef: null,
      note: 'Test failed because mocking was absent',
    });

    const correctRes = await reviewService.correct(
      'orch/r-test-correct' as WorktreeId,
      'codebase',
      'Add test helper',
    );
    expect(correctRes.ok).toBe(true);
    if (correctRes.ok) {
      expect(correctRes.value.followUpJobId).toBeNull();
    }
  });
});

// Real engine host + git per test, like the jobs integration tests (30 s each).
describe.skipIf(process.platform === 'win32')('ReviewService integration (fake agent, engine host, git)', { timeout: 30_000 }, () => {
  it('diff returns before and after contents for changed files', async () => {
    // 1. Create a worktree manually for r-diff
    const runId = 'r-diff';
    const wtRes = await gitService.createWorktree({ repoPath: repoDir, runId });
    expect(wtRes.ok).toBe(true);
    if (!wtRes.ok) return;

    const wtPath = wtRes.value.worktreePath;
    // Modify README.md and add new-file.txt
    writeFileSync(path.join(wtPath, 'README.md'), '# Main Repo\nUpdated line\n', 'utf8');
    writeFileSync(path.join(wtPath, 'new-file.txt'), 'Hello world\n', 'utf8');

    // Create job and review rows
    const jobId = 'j-diff' as JobId;
    await store.db.insert(jobTable).values({
      id: jobId,
      title: 'Diff test',
      mode: 'single',
      spec: {
        mode: 'single',
        goal: 'diff test',
        repoPath: repoDir,
        orchestrator: { agent: 'claude', account: 'auto' },
        workers: ['claude'],
        checks: [],
        onLimit: 'switch-account',
      },
      status: 'done',
      step: null,
      createdAt: new Date().toISOString(),
      scheduledFor: null,
    });

    await store.db.insert(reviewTable).values({
      worktree: `orch/${runId}` as WorktreeId,
      jobId,
      runId: runId as RunId,
      sessionId: null,
      title: 'Diff test',
      state: 'ready',
      verdict: 'verified',
      checks: [],
      files: [
        { path: 'README.md', added: 1, removed: 0 },
        { path: 'new-file.txt', added: 1, removed: 0 },
      ],
      evidenceRef: null,
      note: null,
    });

    // Test diff on modified file
    const readmeDiff = await reviewService.diff(`orch/${runId}` as WorktreeId, 'README.md');
    expect(readmeDiff.ok).toBe(true);
    if (readmeDiff.ok) {
      expect(readmeDiff.value.before).toBe('# Main Repo');
      expect(readmeDiff.value.after).toBe('# Main Repo\nUpdated line\n');
    }

    // Test diff on added file
    const newFileDiff = await reviewService.diff(`orch/${runId}` as WorktreeId, 'new-file.txt');
    expect(newFileDiff.ok).toBe(true);
    if (newFileDiff.ok) {
      expect(newFileDiff.value.before).toBe('');
      expect(newFileDiff.value.after).toBe('Hello world\n');
    }

    // Clean up worktree
    await gitService.removeWorktree({ repoPath: repoDir, runId, deleteBranch: true });
  });

  it('approveAndMerge fails with not_verified when verdict is refuted or unverified (REV-01)', async () => {
    const runId = 'r-unverified';
    const jobId = 'j-unverified' as JobId;
    await store.db.insert(jobTable).values({
      id: jobId,
      title: 'Unverified job',
      mode: 'single',
      spec: {
        mode: 'single',
        goal: 'unverified goal',
        repoPath: repoDir,
        orchestrator: { agent: 'claude', account: 'auto' },
        workers: ['claude'],
        checks: [],
        onLimit: 'switch-account',
      },
      status: 'failed',
      step: null,
      createdAt: new Date().toISOString(),
      scheduledFor: null,
    });

    await store.db.insert(reviewTable).values({
      worktree: `orch/${runId}` as WorktreeId,
      jobId,
      runId: runId as RunId,
      sessionId: null,
      title: 'Unverified job',
      state: 'failing',
      verdict: 'refuted',
      checks: [],
      files: [],
      evidenceRef: null,
      note: null,
    });

    const mergeRes = await reviewService.approveAndMerge(`orch/${runId}` as WorktreeId);
    expect(mergeRes.ok).toBe(false);
    if (!mergeRes.ok) {
      expect(mergeRes.error.code).toBe('not_verified');
    }

    // Change to unverified
    await store.db
      .update(reviewTable)
      .set({ verdict: 'unverified' })
      .where(eq(reviewTable.worktree, `orch/${runId}`));

    const mergeRes2 = await reviewService.approveAndMerge(`orch/${runId}` as WorktreeId);
    expect(mergeRes2.ok).toBe(false);
    if (!mergeRes2.ok) {
      expect(mergeRes2.error.code).toBe('not_verified');
    }
  });

  it('approveAndMerge rebases, squashes into commit format, and updates review state (REV-02, REV-03)', async () => {
    const runId = 'r-merge-ok';
    const jobId = 'j-merge-ok' as JobId;
    const wtRes = await gitService.createWorktree({ repoPath: repoDir, runId });
    expect(wtRes.ok).toBe(true);
    if (!wtRes.ok) return;

    const wtPath = wtRes.value.worktreePath;
    writeFileSync(path.join(wtPath, 'feature.txt'), 'Feature line 1\n', 'utf8');

    await store.db.insert(jobTable).values({
      id: jobId,
      title: 'Add feature file',
      mode: 'single',
      spec: {
        mode: 'single',
        goal: 'Add feature file',
        repoPath: repoDir,
        orchestrator: { agent: 'claude', account: 'auto' },
        workers: ['claude'],
        checks: [],
        onLimit: 'switch-account',
      },
      status: 'done',
      step: null,
      createdAt: new Date().toISOString(),
      scheduledFor: null,
    });

    await store.db.insert(reviewTable).values({
      worktree: `orch/${runId}` as WorktreeId,
      jobId,
      runId: runId as RunId,
      sessionId: null,
      title: 'Add feature file',
      state: 'ready',
      verdict: 'verified',
      checks: [],
      files: [{ path: 'feature.txt', added: 1, removed: 0 }],
      evidenceRef: null,
      note: null,
    });

    const mergeRes = await reviewService.approveAndMerge(`orch/${runId}` as WorktreeId);
    expect(mergeRes.ok).toBe(true);

    // Verify commit on main branch
    const logRes = await runGit(['-C', repoDir, 'log', '-1', '--pretty=%B']);
    const commitMsg = logRes.stdout.trim();

    // Check message format: {title} + blank line + orch: job {job}, run {run}, verified {YYYY-MM-DD}
    const today = new Date().toISOString().slice(0, 10);
    const expectedMsg = `Add feature file\n\norch: job ${jobId}, run ${runId}, verified ${today}`;
    expect(commitMsg).toBe(expectedMsg);

    // Verify file exists on main branch
    expect(existsSync(path.join(repoDir, 'feature.txt'))).toBe(true);

    // Verify review state is merged in DB
    const reviewInDb = await reviewService.get(`orch/${runId}` as WorktreeId);
    expect(reviewInDb.ok).toBe(true);
    if (reviewInDb.ok) {
      expect(reviewInDb.value.state).toBe('merged');
    }

    // Clean up
    await gitService.removeWorktree({ repoPath: repoDir, runId, deleteBranch: true });
  });

  it('approveAndMerge blocks merge when checks fail after rebase (rebase-then-recheck path)', async () => {
    const runId = 'r-recheck-fail';
    const jobId = 'j-recheck-fail' as JobId;
    const wtRes = await gitService.createWorktree({ repoPath: repoDir, runId });
    expect(wtRes.ok).toBe(true);
    if (!wtRes.ok) return;

    const wtPath = wtRes.value.worktreePath;
    // Trip guardrail: add eslint-disable suppression (JOB-05)
    writeFileSync(path.join(wtPath, 'suppressed.js'), '// eslint-disable-next-line\nconst x = 1;\n', 'utf8');

    await store.db.insert(jobTable).values({
      id: jobId,
      title: 'Job with suppression',
      mode: 'single',
      spec: {
        mode: 'single',
        goal: 'Job with suppression',
        repoPath: repoDir,
        orchestrator: { agent: 'claude', account: 'auto' },
        workers: ['claude'],
        checks: [],
        onLimit: 'switch-account',
      },
      status: 'done',
      step: null,
      createdAt: new Date().toISOString(),
      scheduledFor: null,
    });

    // Mark as verified initially to test re-check on rebase
    await store.db.insert(reviewTable).values({
      worktree: `orch/${runId}` as WorktreeId,
      jobId,
      runId: runId as RunId,
      sessionId: null,
      title: 'Job with suppression',
      state: 'ready',
      verdict: 'verified',
      checks: [],
      files: [{ path: 'suppressed.js', added: 2, removed: 0 }],
      evidenceRef: null,
      note: null,
    });

    const mergeRes = await reviewService.approveAndMerge(`orch/${runId}` as WorktreeId);
    expect(mergeRes.ok).toBe(false);
    if (!mergeRes.ok) {
      expect(mergeRes.error.code).toBe('not_verified');
    }

    // Verify verdict updated to refuted in DB
    const reviewInDb = await reviewService.get(`orch/${runId}` as WorktreeId);
    expect(reviewInDb.ok).toBe(true);
    if (reviewInDb.ok) {
      expect(reviewInDb.value.verdict).toBe('refuted');
      expect(reviewInDb.value.state).toBe('failing');
    }

    // Clean up
    await gitService.removeWorktree({ repoPath: repoDir, runId, deleteBranch: true });
  });

  it('discard deletes worktree and branch and sets review state to discarded (REV-04)', async () => {
    const runId = 'r-discard';
    const jobId = 'j-discard' as JobId;
    const wtRes = await gitService.createWorktree({ repoPath: repoDir, runId });
    expect(wtRes.ok).toBe(true);
    if (!wtRes.ok) return;

    const wtPath = wtRes.value.worktreePath;
    expect(existsSync(wtPath)).toBe(true);

    await store.db.insert(jobTable).values({
      id: jobId,
      title: 'Job to discard',
      mode: 'single',
      spec: {
        mode: 'single',
        goal: 'Job to discard',
        repoPath: repoDir,
        orchestrator: { agent: 'claude', account: 'auto' },
        workers: ['claude'],
        checks: [],
        onLimit: 'switch-account',
      },
      status: 'failed',
      step: null,
      createdAt: new Date().toISOString(),
      scheduledFor: null,
    });

    await store.db.insert(reviewTable).values({
      worktree: `orch/${runId}` as WorktreeId,
      jobId,
      runId: runId as RunId,
      sessionId: null,
      title: 'Job to discard',
      state: 'failing',
      verdict: 'refuted',
      checks: [],
      files: [],
      evidenceRef: null,
      note: null,
    });

    const discardRes = await reviewService.discard(`orch/${runId}` as WorktreeId);
    expect(discardRes.ok).toBe(true);

    // Verify worktree folder removed
    expect(existsSync(wtPath)).toBe(false);

    // Verify branch removed
    const { stdout: branches } = await runGit(['-C', repoDir, 'branch', '--list', `orch/${runId}`]);
    expect(branches.trim()).toBe('');

    // Verify review state is discarded
    const reviewInDb = await reviewService.get(`orch/${runId}` as WorktreeId);
    expect(reviewInDb.ok).toBe(true);
    if (reviewInDb.ok) {
      expect(reviewInDb.value.state).toBe('discarded');
    }
  });

  it('requestChanges sends text to session and starts new try, re-verifies (REV-05)', async () => {
    // Multi-turn scenario: turn 0 fails check, turn 1 fixes it
    writeFileSync(
      path.join(dirA, 'fake-agent.json'),
      JSON.stringify({
        turns: [
          {
            scenario: 'fail_tests',
            files: [{ path: 'calc.js', content: 'module.exports = { add: () => 0 };' }],
          },
          {
            scenario: 'succeed',
            files: [{ path: 'calc.js', content: 'module.exports = { add: (a, b) => a + b };' }],
          },
        ],
      }),
      'utf8',
    );

    writeFileSync(
      path.join(repoDir, 'test-check.js'),
      "const { add } = require('./calc.js'); if (add(1, 2) !== 3) process.exit(1);\n",
      'utf8',
    );
    await runGit(['-C', repoDir, 'add', 'test-check.js']);
    await runGit(['-C', repoDir, 'commit', '-m', 'Add test-check.js']);

    const checkScript = `${process.execPath} test-check.js`;
    const spec: JobSpec = {
      mode: 'single',
      goal: 'implement add function',
      repoPath: repoDir,
      orchestrator: { agent: 'claude', account: 'auto' },
      workers: ['claude'],
      checks: [
        {
          kind: 'command',
          run: checkScript,
        },
      ],
      onLimit: 'switch-account',
    };

    const startRes = await jobsService.start(spec);
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;

    const job = startRes.value;

    // Wait for first try to finish (should fail)
    await waitFor(async () => {
      const current = await jobsService.get(job.id);
      return current.ok && (current.value.status === 'done' || current.value.status === 'failed');
    });

    const failedJob = await jobsService.get(job.id);
    expect(failedJob.ok).toBe(true);
    if (!failedJob.ok) return;
    expect(failedJob.value.status).toBe('failed');

    const runsRes = await runsService.list(job.id);
    expect(runsRes.ok).toBe(true);
    if (!runsRes.ok) return;
    const run = runsRes.value[0]!;

    const reviewRes = await reviewService.get(run.worktree!);
    expect(reviewRes.ok).toBe(true);
    if (!reviewRes.ok) return;
    expect(reviewRes.value.verdict).toBe('refuted');
    expect(reviewRes.value.state).toBe('failing');

    // Start session on the worktree and link to run (REV-05: run has a session)
    const wtPath = path.join(repoDir, '.orch', 'wt', run.id);
    writeFileSync(
      path.join(dirA, 'fake-agent.json'),
      JSON.stringify({
        scenario: 'succeed',
        files: [{ path: 'calc.js', content: 'module.exports = { add: (a, b) => a + b };' }],
      }),
      'utf8',
    );
    const sessionRes = await client.request({
      op: 'session.start',
      agent: 'claude',
      cwd: wtPath,
      env: { CLAUDE_CONFIG_DIR: dirA },
      readOnly: false,
    });
    expect(sessionRes.ok).toBe(true);
    if (!sessionRes.ok) return;
    const session = (sessionRes.value as { session: SessionId }).session;
    await runsService.updateRun(run.id, { sessionId: session });
    await store.db.update(reviewTable).set({ sessionId: session }).where(eq(reviewTable.worktree, run.worktree!));

    // Request changes
    const reqRes = await reviewService.requestChanges(run.worktree!, 'Please make add(1, 2) return 3.');
    expect(reqRes.ok).toBe(true);

    // After requestChanges, verify new try completed and verified
    const recheckedReview = await reviewService.get(run.worktree!);
    expect(recheckedReview.ok).toBe(true);
    if (!recheckedReview.ok) return;
    expect(recheckedReview.value.verdict).toBe('verified');
    expect(recheckedReview.value.state).toBe('ready');

    const recheckedJob = await jobsService.get(job.id);
    expect(recheckedJob.ok).toBe(true);
    if (!recheckedJob.ok) return;
    expect(recheckedJob.value.status).toBe('done');
    expect(recheckedJob.value.step?.attempt).toBe(2);

    // Now approveAndMerge can succeed!
    const mergeRes = await reviewService.approveAndMerge(run.worktree!);
    expect(mergeRes.ok).toBe(true);

    const mergedReview = await reviewService.get(run.worktree!);
    expect(mergedReview.ok).toBe(true);
    if (!mergedReview.ok) return;
    expect(mergedReview.value.state).toBe('merged');

    // Clean up
    await gitService.removeWorktree({ repoPath: repoDir, runId: run.id, deleteBranch: true });
  });

  it('TRU-03 level-3 auto-merge rule: autoMergeAllowed for single-mode jobs only', async () => {
    const runId = 'r-trust-auto';
    const jobId = 'j-trust-auto' as JobId;
    const wtRes = await gitService.createWorktree({ repoPath: repoDir, runId });
    expect(wtRes.ok).toBe(true);
    if (!wtRes.ok) return;

    const wtPath = wtRes.value.worktreePath;
    // Create doc file and test file (matching TRU-03 allowlist)
    writeFileSync(path.join(wtPath, 'docs.md'), '# Documentation update\n', 'utf8');

    // Set agent trust level to 3 in trustLevelTable
    await store.db
      .insert(trustLevelTable)
      .values({ agent: 'claude', level: 3, changedAt: new Date().toISOString() })
      .onConflictDoUpdate({ target: trustLevelTable.agent, set: { level: 3 } });

    await store.db.insert(jobTable).values({
      id: jobId,
      title: 'Doc update only',
      mode: 'single',
      spec: {
        mode: 'single',
        goal: 'Doc update only',
        repoPath: repoDir,
        orchestrator: { agent: 'claude', account: 'auto' },
        workers: ['claude'],
        checks: [],
        onLimit: 'switch-account',
      },
      status: 'done',
      step: null,
      createdAt: new Date().toISOString(),
      scheduledFor: null,
    });

    const run: Run = {
      id: runId as RunId,
      jobId,
      parentId: null,
      depth: 0,
      role: 'implementer',
      task: 'Doc update only',
      agent: 'claude',
      accountId: acctA,
      status: 'done',
      worktree: `orch/${runId}` as WorktreeId,
      readOnly: false,
      sessionId: null,
      startedAt: new Date().toISOString() as Timestamp,
      resumesAt: null,
    };
    await runsService.recordRun(run);

    await store.db.insert(reviewTable).values({
      worktree: `orch/${runId}` as WorktreeId,
      jobId,
      runId: runId as RunId,
      sessionId: null,
      title: 'Doc update only',
      state: 'ready',
      verdict: 'verified',
      checks: [],
      files: [{ path: 'docs.md', added: 1, removed: 0 }],
      evidenceRef: null,
      note: null,
    });

    // Check maybeAutoMerge
    const autoMergeRes = await reviewService.maybeAutoMerge(`orch/${runId}` as WorktreeId);
    expect(autoMergeRes.ok).toBe(true);
    if (autoMergeRes.ok) {
      expect(autoMergeRes.value).toBe(true);
    }

    // Verify it was merged
    const finalReview = await reviewService.get(`orch/${runId}` as WorktreeId);
    expect(finalReview.ok).toBe(true);
    if (finalReview.ok) {
      expect(finalReview.value.state).toBe('merged');
    }

    // Clean up
    await gitService.removeWorktree({ repoPath: repoDir, runId, deleteBranch: true });
  });

  it('TRU-03 level 3 does not auto-merge when changed file is outside allowlist', async () => {
    const runId = 'r-trust-no-auto';
    const jobId = 'j-trust-no-auto' as JobId;
    const wtRes = await gitService.createWorktree({ repoPath: repoDir, runId });
    expect(wtRes.ok).toBe(true);
    if (!wtRes.ok) return;

    const wtPath = wtRes.value.worktreePath;
    writeFileSync(path.join(wtPath, 'src-file.ts'), 'export const x = 1;\n', 'utf8');

    await store.db.insert(jobTable).values({
      id: jobId,
      title: 'Code update',
      mode: 'single',
      spec: {
        mode: 'single',
        goal: 'Code update',
        repoPath: repoDir,
        orchestrator: { agent: 'claude', account: 'auto' },
        workers: ['claude'],
        checks: [],
        onLimit: 'switch-account',
      },
      status: 'done',
      step: null,
      createdAt: new Date().toISOString(),
      scheduledFor: null,
    });

    const run: Run = {
      id: runId as RunId,
      jobId,
      parentId: null,
      depth: 0,
      role: 'implementer',
      task: 'Code update',
      agent: 'claude',
      accountId: acctA,
      status: 'done',
      worktree: `orch/${runId}` as WorktreeId,
      readOnly: false,
      sessionId: null,
      startedAt: new Date().toISOString() as Timestamp,
      resumesAt: null,
    };
    await runsService.recordRun(run);

    await store.db.insert(reviewTable).values({
      worktree: `orch/${runId}` as WorktreeId,
      jobId,
      runId: runId as RunId,
      sessionId: null,
      title: 'Code update',
      state: 'ready',
      verdict: 'verified',
      checks: [],
      files: [{ path: 'src-file.ts', added: 1, removed: 0 }],
      evidenceRef: null,
      note: null,
    });

    const autoMergeRes = await reviewService.maybeAutoMerge(`orch/${runId}` as WorktreeId);
    expect(autoMergeRes.ok).toBe(true);
    if (autoMergeRes.ok) {
      expect(autoMergeRes.value).toBe(false);
    }

    // Still ready, not merged
    const finalReview = await reviewService.get(`orch/${runId}` as WorktreeId);
    expect(finalReview.ok).toBe(true);
    if (finalReview.ok) {
      expect(finalReview.value.state).toBe('ready');
    }

    // Clean up
    await gitService.removeWorktree({ repoPath: repoDir, runId, deleteBranch: true });
  });
});
