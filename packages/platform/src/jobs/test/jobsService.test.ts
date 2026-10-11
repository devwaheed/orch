import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  AccountId,
  AgentId,
  EngineEnv,
  JobSpec,
  OrchEvent,
  PickAccountResult,
  QuotaObservation,
} from '@orch/contracts';
import { EngineClient, type EnginePort } from '../../engine/common/engineClient.js';
import { createPortPair } from '../../engine/test/portPair.js';
import { serveEngine, type ServedEngine } from '../../engine/node/serve.js';
import type { EngineHost } from '../../engine/node/engineHost.js';
import { FAKE_AGENT_SCRIPT_PATH, createFakeAdapter } from '../../adapters/node/fake.js';
import { StoreService } from '../../store/node/storeService.js';
import { GitService, runGit } from '../../git/node/gitService.js';
import { RunsService } from '../../runs/node/runsService.js';
import { JobsService } from '../node/jobsService.js';
import type { IProfilesService, ProfileInfo } from '../../profiles/common/profiles.js';
import { reviewTable } from '../../store/common/schema.js';
import { eq } from 'drizzle-orm';

let root = '';
let engineDir = '';
let repoDir = '';
let client: EngineClient;
let enginePort: EnginePort;
let host: EngineHost;
let served: ServedEngine;
let store: StoreService;
let gitService: GitService;
let runsService: RunsService;
let jobsService: JobsService;
const events: OrchEvent[] = [];

let dirA = '';
let dirB = '';
const acctA: AccountId = 'claude-a' as AccountId;
const acctB: AccountId = 'claude-b' as AccountId;

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
    const p = accountId === 'claude-b' ? dirB : dirA;
    return { ok: true, value: { CLAUDE_CONFIG_DIR: p } };
  }
}

class TestQuota {
  limitedAccounts = new Set<string>();
  observations: QuotaObservation[] = [];

  async pickAccount(agent: AgentId): Promise<{ ok: true; value: PickAccountResult }> {
    if (agent === 'claude') {
      if (!this.limitedAccounts.has('claude-a')) {
        return { ok: true, value: { kind: 'account', accountId: acctA } };
      }
      if (!this.limitedAccounts.has('claude-b')) {
        return { ok: true, value: { kind: 'account', accountId: acctB } };
      }
      return { ok: true, value: { kind: 'wait', until: '2026-10-11T16:00:00.000Z', agent } };
    }
    return { ok: true, value: { kind: 'account', accountId: `${agent}-a` as AccountId } };
  }

  observe(obs: QuotaObservation) {
    this.observations.push(obs);
    if (obs.limited) {
      this.limitedAccounts.add(obs.accountId);
    }
    return { ok: true as const, value: undefined };
  }
}

let testQuota: TestQuota;

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timed out waiting for condition');
}

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'orch-jobs-integration-'));
  engineDir = path.join(root, 'engine');
  const home = path.join(engineDir, 'home');
  mkdirSync(home, { recursive: true });

  dirA = path.join(root, 'acct-a');
  dirB = path.join(root, 'acct-b');
  mkdirSync(dirA, { recursive: true });
  mkdirSync(dirB, { recursive: true });
  writeFileSync(path.join(dirA, 'account.json'), JSON.stringify({ emailMasked: 'a•••@example.com', plan: 'pro', signedIn: true }));
  writeFileSync(path.join(dirB, 'account.json'), JSON.stringify({ emailMasked: 'b•••@example.com', plan: 'pro', signedIn: true }));

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
    agentBins: {
      codex: FAKE_AGENT_SCRIPT_PATH,
      gemini: FAKE_AGENT_SCRIPT_PATH,
      opencode: FAKE_AGENT_SCRIPT_PATH,
      agy: FAKE_AGENT_SCRIPT_PATH,
    },
  });
  const pair = createPortPair();
  enginePort = pair.right;
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
  await runGit(['-C', repoDir, 'config', 'user.name', 'Test']);
  await runGit(['-C', repoDir, 'config', 'user.email', 'test@example.com']);
  writeFileSync(path.join(repoDir, 'README.md'), '# Main Repo\n', 'utf8');
  mkdirSync(path.join(repoDir, 'test'), { recursive: true });
  writeFileSync(path.join(repoDir, 'test', 'existing.test.js'), '// original test\n', 'utf8');
  await runGit(['-C', repoDir, 'add', '.']);
  await runGit(['-C', repoDir, 'commit', '-m', 'Initial commit']);

  testQuota = new TestQuota();
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
});

afterAll(async () => {
  served?.close();
  client?.close();
  await host?.dispose();
  store?.close();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(process.platform === 'win32')('Jobs & Runs integration (fake agent, real engine host)', () => {
  it('success -> verified: single mode job runs, check passes, verdict is verified (JOB-01, JOB-02, REV-03)', async () => {
    // Fake agent scenario: succeed
    writeFileSync(path.join(dirA, 'fake-agent.json'), JSON.stringify({ scenario: 'succeed' }), 'utf8');

    const spec: JobSpec = {
      mode: 'single',
      goal: 'implement feature',
      repoPath: repoDir,
      orchestrator: { agent: 'claude', account: 'auto' },
      workers: ['claude'],
      checks: [
        {
          kind: 'command',
          run: `${process.execPath} -e "process.exit(0)"`,
        },
      ],
      onLimit: 'switch-account',
    };

    const startRes = await jobsService.start(spec);
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;

    const job = startRes.value;
    expect(job.id).toBe('j-1'); // JOB-01: j-1
    expect(job.status).toBe('running');

    // Wait for job to finish
    await waitFor(async () => {
      const current = await jobsService.get(job.id);
      return current.ok && (current.value.status === 'done' || current.value.status === 'failed');
    });

    const finalJob = await jobsService.get(job.id);
    expect(finalJob.ok).toBe(true);
    if (!finalJob.ok) return;
    expect(finalJob.value.status).toBe('done');

    // Verify run
    const runsRes = await runsService.list(job.id);
    expect(runsRes.ok).toBe(true);
    if (!runsRes.ok) return;
    expect(runsRes.value).toHaveLength(1);
    const run = runsRes.value[0]!;
    expect(run.id).toBe('r-1');
    expect(run.status).toBe('done');
    expect(run.worktree).toBe('orch/r-1');

    // Verify worktree folder exists and exclude was added (JOB-02)
    const wtPath = path.join(repoDir, '.orch', 'wt', 'r-1');
    expect(existsSync(wtPath)).toBe(true);
    expect(readFileSync(path.join(repoDir, '.git', 'info', 'exclude'), 'utf8')).toContain('.orch/');

    // Verify WorktreeReview in store
    const [review] = await store.db.select().from(reviewTable).where(eq(reviewTable.jobId, job.id));
    expect(review).toBeDefined();
    if (!review) return;
    expect(review.verdict).toBe('verified');
    expect(review.state).toBe('ready');

    // Verify guardrails are present in review checks
    const checkRules = review.checks.map((c) => (c.check.kind === 'guardrail' ? c.check.rule : null)).filter(Boolean);
    expect(checkRules).toContain('no_new_suppressions');
    expect(checkRules).toContain('protected_files');
  });

  it('refuted: when check fails, verdict is refuted and job status is failed', async () => {
    writeFileSync(path.join(dirA, 'fake-agent.json'), JSON.stringify({ scenario: 'succeed' }), 'utf8');

    const spec: JobSpec = {
      mode: 'single',
      goal: 'implement with failing test',
      repoPath: repoDir,
      orchestrator: { agent: 'claude', account: 'auto' },
      workers: ['claude'],
      checks: [
        {
          kind: 'command',
          run: `${process.execPath} -e "process.exit(3)"`,
        },
      ],
      onLimit: 'switch-account',
    };

    const startRes = await jobsService.start(spec);
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;

    const job = startRes.value;
    expect(job.id).toBe('j-2');

    await waitFor(async () => {
      const current = await jobsService.get(job.id);
      return current.ok && (current.value.status === 'done' || current.value.status === 'failed');
    });

    const finalJob = await jobsService.get(job.id);
    expect(finalJob.ok).toBe(true);
    if (!finalJob.ok) return;
    expect(finalJob.value.status).toBe('failed');

    const [review] = await store.db.select().from(reviewTable).where(eq(reviewTable.jobId, job.id));
    expect(review).toBeDefined();
    if (!review) return;
    expect(review.verdict).toBe('refuted');
    expect(review.state).toBe('failing');
  });

  it('limit mid-run then resume on another account (worktree kept) (QTA-03, JOB-08)', async () => {
    // Reset quota
    testQuota.limitedAccounts.clear();

    // acctA triggers limit
    const resetTime = '2026-10-11T16:00:00.000Z';
    writeFileSync(
      path.join(dirA, 'fake-agent.json'),
      JSON.stringify({
        scenario: 'limit',
        resetsAt: resetTime,
        window: '5h',
        usedPct: 100,
      }),
      'utf8',
    );
    // acctB succeeds
    writeFileSync(path.join(dirB, 'fake-agent.json'), JSON.stringify({ scenario: 'succeed' }), 'utf8');

    const spec: JobSpec = {
      mode: 'single',
      goal: 'run that hits limit',
      repoPath: repoDir,
      orchestrator: { agent: 'claude', account: 'auto' },
      workers: ['claude'],
      checks: [
        {
          kind: 'command',
          run: `${process.execPath} -e "process.exit(0)"`,
        },
      ],
      onLimit: 'switch-account',
    };

    const startRes = await jobsService.start(spec);
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;
    const job = startRes.value;

    // Simulate engine session output reporting a rate limit mid-run
    const limitLine = `Rate limit reached. Resets at ${resetTime} (window: 5h, used: 100%)`;
    enginePort.postMessage({
      type: 'session.output',
      session: 's-limit-session',
      seq: 1,
      kind: 'result',
      text: limitLine,
    });

    // Wait for limit signal to observe limit and auto-resume on account B (switch-account)
    await waitFor(async () => {
      const runs = await runsService.list(job.id);
      if (!runs.ok || runs.value.length === 0) return false;
      const r = runs.value[0]!;
      return r.status === 'paused_limit' || (r.status === 'running' && r.accountId === acctB);
    });

    // Check that limit observation was recorded by quota service
    expect(testQuota.limitedAccounts.has(acctA)).toBe(true);

    const runs = await runsService.list(job.id);
    expect(runs.ok).toBe(true);
    if (!runs.ok) return;
    const run = runs.value[0]!;

    // Worktree exists and is kept (QTA-03)
    const wtPath = path.join(repoDir, '.orch', 'wt', run.id);
    expect(existsSync(wtPath)).toBe(true);
    expect(readFileSync(path.join(repoDir, '.git', 'info', 'exclude'), 'utf8')).toContain('.orch/');

    // When onLimit was switch-account, it auto-resumed on account B, worktree still kept
    expect(run.accountId).toBe(acctB);
    expect(run.status).toBe('running');

    // Also verify manual resumeOn preserves worktree
    await runsService.updateRun(run.id, { status: 'paused_limit' });
    const manuallyResumed = await runsService.resumeOn(run.id, acctB);
    expect(manuallyResumed.ok).toBe(true);
    if (manuallyResumed.ok) {
      expect(manuallyResumed.value.accountId).toBe(acctB);
      expect(manuallyResumed.value.status).toBe('running');
      expect(manuallyResumed.value.worktree).toBe(run.worktree);
    }
  });

  it('crash then resume (worktree kept)', async () => {
    // Account A triggers crash
    writeFileSync(
      path.join(dirA, 'fake-agent.json'),
      JSON.stringify({
        scenario: 'crash',
        crashOnStartup: true,
        errorMessage: 'Crash on startup\n',
        exitCode: 1,
      }),
      'utf8',
    );

    const spec: JobSpec = {
      mode: 'single',
      goal: 'run that crashes',
      repoPath: repoDir,
      orchestrator: { agent: 'claude', account: acctA },
      workers: ['claude'],
      checks: [
        {
          kind: 'command',
          run: `${process.execPath} -e "process.exit(0)"`,
        },
      ],
      onLimit: 'switch-account',
    };

    const startRes = await jobsService.start(spec);
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;
    const job = startRes.value;

    const runsRes = await runsService.list(job.id);
    expect(runsRes.ok).toBe(true);
    if (!runsRes.ok) return;
    const run = runsRes.value[0]!;

    // Fix crash scenario in account A
    writeFileSync(path.join(dirA, 'fake-agent.json'), JSON.stringify({ scenario: 'succeed' }), 'utf8');

    // Resume the run
    const resumeRes = await runsService.startNow(run.id);
    expect(resumeRes.ok).toBe(true);

    const current = await runsService.getRun(run.id);
    expect(current?.status).toBe('running');
    // Worktree was kept
    expect(current?.worktree).toBe(run.worktree);
  });

  it('guardrail fails when an existing test file is edited (JOB-06)', async () => {
    // Agent edits the existing test file committed in repo
    writeFileSync(
      path.join(dirA, 'fake-agent.json'),
      JSON.stringify({
        scenario: 'edit_files',
        files: [
          {
            path: 'test/existing.test.js',
            content: '// TAMPERED TEST CONTENT\n',
          },
        ],
      }),
      'utf8',
    );

    const spec: JobSpec = {
      mode: 'single',
      goal: 'tamper with existing test file',
      repoPath: repoDir,
      orchestrator: { agent: 'claude', account: acctA },
      workers: ['claude'],
      checks: [
        {
          kind: 'command',
          run: `${process.execPath} -e "process.exit(0)"`,
        },
      ],
      onLimit: 'switch-account',
    };

    const startRes = await jobsService.start(spec);
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;
    const job = startRes.value;

    await waitFor(async () => {
      const current = await jobsService.get(job.id);
      return current.ok && (current.value.status === 'done' || current.value.status === 'failed');
    });

    const finalJob = await jobsService.get(job.id);
    expect(finalJob.ok).toBe(true);
    if (!finalJob.ok) return;
    // Job MUST fail because guardrail failed!
    expect(finalJob.value.status).toBe('failed');

    const [review] = await store.db.select().from(reviewTable).where(eq(reviewTable.jobId, job.id));
    expect(review).toBeDefined();
    if (!review) return;
    expect(review.verdict).toBe('refuted');

    const protectedCheck = review.checks.find(
      (c) => c.check.kind === 'guardrail' && c.check.rule === 'protected_files',
    );
    expect(protectedCheck).toBeDefined();
    expect(protectedCheck?.status).toBe('failed');
    expect(protectedCheck?.summary).toBe('1 protected file changed');
  });

  it('compare mode: starts job, records run for each agent, starts engine fanout (JOB-08, JOB-09)', async () => {
    writeFileSync(path.join(dirA, 'fake-agent.json'), JSON.stringify({ scenario: 'succeed' }), 'utf8');

    const spec: JobSpec = {
      mode: 'compare',
      goal: 'compare two implementations',
      repoPath: repoDir,
      agents: ['claude', 'codex'],
      combine: true,
      checks: [],
      onLimit: 'switch-account',
    };

    const startRes = await jobsService.start(spec);
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;

    const job = startRes.value;
    expect(job.spec.mode).toBe('compare');
    expect(job.step?.name).toBe('Compare');

    const runsRes = await runsService.list(job.id);
    expect(runsRes.ok).toBe(true);
    if (!runsRes.ok) return;
    expect(runsRes.value).toHaveLength(2);
    expect(runsRes.value[0]?.agent).toBe('claude');
    expect(runsRes.value[1]?.agent).toBe('codex');
    expect(runsRes.value[0]?.status).toBe('running');
    expect(runsRes.value[1]?.status).toBe('running');

    await waitFor(async () => {
      const current = await jobsService.get(job.id);
      return current.ok && (current.value.status === 'done' || current.value.status === 'failed');
    });

    const finalJob = await jobsService.get(job.id);
    expect(finalJob.ok).toBe(true);
    if (!finalJob.ok) return;
    expect(finalJob.value.status).toBe('done');
  }, 30_000);

  it('council mode: starts job, records member runs, starts engine council (JOB-08, JOB-09)', async () => {
    writeFileSync(path.join(dirA, 'fake-agent.json'), JSON.stringify({ scenario: 'succeed' }), 'utf8');

    const spec: JobSpec = {
      mode: 'council',
      goal: 'council debate feature',
      repoPath: repoDir,
      agents: ['claude', 'codex', 'opencode'],
      maxRounds: 1,
      checks: [
        {
          kind: 'command',
          run: `${process.execPath} -e "process.exit(0)"`,
        },
      ],
      onLimit: 'switch-account',
    };

    const startRes = await jobsService.start(spec);
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;

    const job = startRes.value;
    expect(job.spec.mode).toBe('council');
    expect(job.step?.name).toBe('Council');

    const runsRes = await runsService.list(job.id);
    expect(runsRes.ok).toBe(true);
    if (!runsRes.ok) return;
    expect(runsRes.value).toHaveLength(3);
    for (const r of runsRes.value) {
      expect(r.role).toBe('member');
      expect(r.status).toBe('running');
    }

    await waitFor(async () => {
      const current = await jobsService.get(job.id);
      return current.ok && (current.value.status === 'done' || current.value.status === 'failed');
    });

    const finalJob = await jobsService.get(job.id);
    expect(finalJob.ok).toBe(true);
    if (!finalJob.ok) return;
    expect(finalJob.value.status).toBe('done');
  }, 30_000);

  it('autoloop mode: starts job, records planner, coder, reviewer runs (JOB-08, JOB-09)', async () => {
    writeFileSync(path.join(dirA, 'fake-agent.json'), JSON.stringify({ scenario: 'succeed' }), 'utf8');

    const spec: JobSpec = {
      mode: 'autoloop',
      goal: 'autoloop long running task',
      repoPath: repoDir,
      roles: {
        planner: 'claude',
        coder: 'codex',
        reviewer: 'gemini',
      },
      checks: [
        {
          kind: 'command',
          run: `${process.execPath} -e "process.exit(0)"`,
        },
      ],
      onLimit: 'switch-account',
    };

    const startRes = await jobsService.start(spec);
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;

    const job = startRes.value;
    expect(job.spec.mode).toBe('autoloop');
    expect(job.step?.name).toBe('Plan');

    const runsRes = await runsService.list(job.id);
    expect(runsRes.ok).toBe(true);
    if (!runsRes.ok) return;
    expect(runsRes.value).toHaveLength(3);

    const rolesFound = runsRes.value.map((r) => r.role);
    expect(rolesFound).toContain('planner');
    expect(rolesFound).toContain('coder');
    expect(rolesFound).toContain('reviewer');

    const plannerRun = runsRes.value.find((r) => r.role === 'planner');
    expect(plannerRun?.agent).toBe('claude');
    expect(plannerRun?.readOnly).toBe(true);

    const coderRun = runsRes.value.find((r) => r.role === 'coder');
    expect(coderRun?.agent).toBe('codex');
    expect(coderRun?.readOnly).toBe(false);

    const reviewerRun = runsRes.value.find((r) => r.role === 'reviewer');
    expect(reviewerRun?.agent).toBe('gemini');
    expect(reviewerRun?.readOnly).toBe(true);
  }, 30_000);
});

