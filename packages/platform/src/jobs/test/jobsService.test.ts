import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  SpecRun,
  CriterionResult,
  WorktreeId,
} from '@orchagents/contracts';
import { EngineClient, type EnginePort } from '../../engine/common/engineClient.js';
import { createPortPair } from '../../engine/test/portPair.js';
import { serveEngine, type ServedEngine } from '../../engine/node/serve.js';
import type { EngineHost } from '../../engine/node/engineHost.js';
import { FAKE_AGENT_SCRIPT_PATH, createFakeAdapter } from '../../adapters/node/fake.js';
import { StoreService } from '../../store/node/storeService.js';
import { GitService, runGit } from '../../git/node/gitService.js';
import { RunsService } from '../../runs/node/runsService.js';
import { JobsService } from '../node/jobsService.js';
import { ReviewService } from '../../review/node/reviewService.js';
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
    // Fixed clock: the limit fixtures reset at 16:00Z, which must stay in the future.
    now: () => new Date('2026-10-11T12:00:00.000Z'),
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
  }, 30_000);

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
  }, 30_000);

  it('limit mid-run then resume on another account (worktree kept) (QTA-03, JOB-08)', async () => {
    // Reset quota
    testQuota.limitedAccounts.clear();

    // acctA triggers limit
    // Always in the future, whatever the wall clock says (a fixed time here became a time bomb).
    const resetTime = new Date(Date.now() + 4 * 3_600_000).toISOString();
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
  }, 30_000);

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
  }, 30_000);

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
  }, 30_000);

  async function runSingle(goal: string, files: Array<{ path: string; content: string }>, checks: JobSpec['checks']) {
    writeFileSync(path.join(dirA, 'fake-agent.json'), JSON.stringify({ scenario: 'edit_files', files }), 'utf8');
    const started = await jobsService.start({
      mode: 'single',
      goal,
      repoPath: repoDir,
      orchestrator: { agent: 'claude', account: acctA },
      workers: ['claude'],
      checks,
      onLimit: 'switch-account',
    });
    if (!started.ok) throw new Error(started.error.message);
    await waitFor(async () => {
      const current = await jobsService.get(started.value.id);
      return current.ok && (current.value.status === 'done' || current.value.status === 'failed');
    });
    const [review] = await store.db.select().from(reviewTable).where(eq(reviewTable.jobId, started.value.id));
    return review!;
  }

  const GUARDRAILS: JobSpec['checks'] = [
    { kind: 'guardrail', rule: 'no_new_suppressions' },
    { kind: 'guardrail', rule: 'protected_files' },
  ];

  it('a suppression in a NEW file refutes the run: new files are part of the diff (JOB-05)', async () => {
    const review = await runSingle('sneak a suppression in', [{ path: 'src/sneaky.ts', content: '// eslint-disable-next-line\nexport const x = 1;\n' }], GUARDRAILS);
    expect(review.verdict).toBe('refuted');
    expect(review.files).toContainEqual({ path: 'src/sneaky.ts', added: 2, removed: 0 });
  }, 30_000);

  it('a job whose only checks are the guardrails is verified when they pass, each listed once', async () => {
    const review = await runSingle('add a hello function', [{ path: 'src/hello.js', content: "export const hello = () => 'hi';\n" }], GUARDRAILS);
    expect(review.verdict).toBe('verified');
    expect(review.checks.map((c) => [c.check.kind, c.status])).toEqual([
      ['guardrail', 'passed'],
      ['guardrail', 'passed'],
    ]);
    expect(review.files).toEqual([{ path: 'src/hello.js', added: 1, removed: 0 }]);
  }, 30_000);

  it('a file rule refutes a change outside its folders and is listed with its own result', async () => {
    const rule: JobSpec['checks'] = [...GUARDRAILS, { kind: 'file_rule', allow: ['src/**', 'test/**'] }];
    const review = await runSingle('touch the readme', [{ path: 'src/a.js', content: '1\n' }, { path: 'docs/a.md', content: 'x\n' }], rule);
    expect(review.verdict).toBe('refuted');
    expect(review.checks.map((c) => [c.check.kind, c.status])).toEqual([
      ['guardrail', 'passed'],
      ['guardrail', 'passed'],
      ['file_rule', 'failed'],
    ]);
  }, 30_000);

  it('compare: agents answer read-only, each run shows its answer, combine gets them all; no review (JOB-03, JOB-09)', async () => {
    // Earlier tests may leave claude-a limited, so either account can answer.
    for (const dir of [dirA, dirB]) {
      writeFileSync(path.join(dir, 'fake-agent.json'), JSON.stringify({ scenario: 'succeed', response: 'Use a queue.', recordInputs: true }), 'utf8');
      rmSync(path.join(dir, 'inputs.jsonl'), { force: true });
    }

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
    if (!startRes.ok) throw new Error(startRes.error.message);
    const job = startRes.value;

    await waitFor(async () => {
      const current = await jobsService.get(job.id);
      return current.ok && (current.value.status === 'done' || current.value.status === 'failed');
    });
    const finalJob = await jobsService.get(job.id);
    expect(finalJob.ok && finalJob.value).toMatchObject({ status: 'done', step: { name: 'Combine' } });

    const runsRes = await runsService.list(job.id);
    if (!runsRes.ok) throw new Error(runsRes.error.message);
    const [claude, codex, combiner] = runsRes.value;
    for (const run of [claude, codex]) {
      expect(run).toMatchObject({ role: 'implementer', status: 'done', readOnly: true, worktree: null });
      const lines = await runsService.lines(run!.id, -1);
      expect(lines.ok && lines.value.map((l) => `${l.kind}:${l.text}`)).toContain('message:Use a queue.');
    }
    expect(combiner).toMatchObject({ role: 'orchestrator', agent: 'claude', status: 'done', readOnly: true });

    // The combine turn was given both answers, labelled by agent.
    const inputs = [dirA, dirB].map((dir) => (existsSync(path.join(dir, 'inputs.jsonl')) ? readFileSync(path.join(dir, 'inputs.jsonl'), 'utf8') : '')).join('');
    expect(inputs).toContain('agents worked on the same goal');
    expect(inputs).toContain('## claude');
    expect(inputs).toContain('## codex');

    // Nothing to merge: compare never opens a review.
    const reviews = await store.db.select().from(reviewTable).where(eq(reviewTable.jobId, job.id));
    expect(reviews).toHaveLength(0);
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

  it('autoloop approvePlan moves the job from Plan to Code (JOB-09)', async () => {
    writeFileSync(path.join(dirA, 'fake-agent.json'), JSON.stringify({ scenario: 'succeed' }), 'utf8');

    const spec: JobSpec = {
      mode: 'autoloop',
      goal: 'autoloop approve plan test',
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
    expect(job.status).toBe('running');
    expect(job.step?.name).toBe('Plan');

    const approveRes = await jobsService.approvePlan(job.id);
    expect(approveRes.ok).toBe(true);

    const updatedJob = await jobsService.get(job.id);
    expect(updatedJob.ok).toBe(true);
    if (!updatedJob.ok) return;
    expect(updatedJob.value.status).toBe('running');
    expect(updatedJob.value.step?.name).toBe('Code');
    expect(updatedJob.value.step?.index).toBe(2);
    // Approval is only offered once: the job has left the Plan step.
    expect((await jobsService.approvePlan(job.id)).ok).toBe(false);
  }, 30_000);

  it('autoloop rejectPlan keeps the job at Plan for a revised plan (JOB-09)', async () => {
    writeFileSync(path.join(dirA, 'fake-agent.json'), JSON.stringify({ scenario: 'succeed' }), 'utf8');

    const spec: JobSpec = {
      mode: 'autoloop',
      goal: 'autoloop reject plan test',
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

    const rejectRes = await jobsService.rejectPlan(job.id, 'Plan not aligned with goal');
    expect(rejectRes.ok).toBe(true);

    const updatedJob = await jobsService.get(job.id);
    expect(updatedJob.ok).toBe(true);
    if (!updatedJob.ok) return;
    expect(updatedJob.value.status).toBe('running');
    expect(updatedJob.value.step?.name).toBe('Plan');
  }, 30_000);

  it('spec-owned failed engine run fails the job while its verification stays in the spec runner', async () => {
    writeFileSync(path.join(dirA, 'fake-agent.json'), JSON.stringify({ scenario: 'succeed' }), 'utf8');
    const jobSpec: JobSpec = {
      mode: 'single', goal: 'implement spec-owned change', repoPath: repoDir,
      orchestrator: { agent: 'claude', account: 'auto' }, workers: ['claude'], checks: [], onLimit: 'switch-account',
    };
    const started = await jobsService.start(jobSpec, { worktreeRunId: 'spec-900', verifiedBy: 'spec' });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    await waitFor(async () => {
      const current = await jobsService.get(started.value.id);
      return current.ok && (current.value.status === 'done' || current.value.status === 'failed');
    });
    const reviewBeforeSpecVerification = await store.db.select().from(reviewTable).where(eq(reviewTable.worktree, 'orch/spec-900')).get();
    expect(reviewBeforeSpecVerification).toBeUndefined();
    const jobRuns = await runsService.list(started.value.id);
    expect(jobRuns.ok).toBe(true);
    if (!jobRuns.ok || jobRuns.value.length === 0) return;
    await runsService.updateRun(jobRuns.value[0]!.id, { status: 'failed' });
    await (jobsService as unknown as { recordVerdict(meta: { jobId: JobId; runId: import('@orchagents/contracts').RunId; targetBranch: string; worktreePath: string; accountId: AccountId; verifiedBy: 'spec' }, verdict: 'verified' | 'refuted' | 'unverified', evidenceRef: string | null): Promise<void> }).recordVerdict({
      jobId: started.value.id, runId: jobRuns.value[0]!.id,
      targetBranch: 'main', worktreePath: path.join(repoDir, '.orch', 'wt', 'spec-900'), accountId: acctA, verifiedBy: 'spec',
    }, 'unverified', null);
    const failedEngineJob = await jobsService.get(started.value.id);
    expect(failedEngineJob.ok && failedEngineJob.value.status).toBe('failed');
    const failedCriteria: CriterionResult[] = [{ index: 0, state: 'not_met', summary: 'Command failed with code 127', auditor: null }];
    const specRun: SpecRun = {
      id: '900' as SpecRun['id'], queueId: 'q-1' as SpecRun['queueId'], position: 1, file: 'docs/specs/900-task.md',
      spec: { id: '900', title: 'Spec-owned change', depends_on: [], scope: [], done_when: [{ by: 'check', text: 'npm test', check: { kind: 'command', run: 'npm test' } }], agent: 'auto', mode: 'single', agents: [] },
      state: 'needs_you', attempt: 3, jobId: started.value.id, worktree: 'orch/spec-900' as SpecRun['worktree'],
      implementer: null, criteria: failedCriteria, blockedBy: [], startedAt: null, finishedAt: null, tokens: 0, history: [],
    };
    await jobsService.recordSpecVerdict(specRun, started.value.id, failedCriteria, false, ['npm test']);
    const recorded = await store.db.select().from(reviewTable).where(eq(reviewTable.worktree, 'orch/spec-900')).get();
    expect(recorded?.verdict).toBe('refuted');
    expect(recorded?.checks.find((result) => result.check.kind === 'command')?.summary).toBe('Command failed with code 127');
    expect(recorded?.note).toBe("Spec 900 isn't verified: npm test (Command failed with code 127).");
    expect(recorded?.note).not.toMatch(/\.\.$/);
    await jobsService.markSpecRefuted('900', 'Reverification failed after rebase...');
    const refutedAgain = await store.db.select().from(reviewTable).where(eq(reviewTable.worktree, 'orch/spec-900')).get();
    expect(refutedAgain?.note).toBe("Spec 900 isn't verified: Reverification failed after rebase.");
    let approved: { repoPath: string; specId: string } | undefined;
    const routedReview = new ReviewService({
      store, git: gitService, runs: runsService, jobs: jobsService,
      approveSpec: async (repoPath, specId) => { approved = { repoPath, specId }; return { ok: true, value: undefined }; },
    });
    const refused = await routedReview.approveAndMerge('orch/spec-900' as WorktreeId);
    expect(refused.ok).toBe(false);
    expect(approved).toBeUndefined();
    await store.db.update(reviewTable).set({ state: 'ready', verdict: 'verified', note: null }).where(eq(reviewTable.worktree, 'orch/spec-900'));
    const approvedRes = await routedReview.approveAndMerge('orch/spec-900' as WorktreeId);
    expect(approvedRes.ok).toBe(true);
    expect(approved).toEqual({ repoPath: repoDir, specId: '900' });
  }, 30_000);

  it('records Claw text stream lines while the job is still running', async () => {
    const scenario = JSON.stringify({
      scenario: 'stream_then_delay',
      response: 'The implementation is underway.',
      files: [{ path: 'src/streamed.js', content: 'export const streamed = true;\n' }],
    });
    writeFileSync(path.join(dirA, 'fake-agent.json'), scenario, 'utf8');
    writeFileSync(path.join(dirB, 'fake-agent.json'), scenario, 'utf8');

    const started = await jobsService.start({
      mode: 'single',
      goal: 'stream implementation output',
      repoPath: repoDir,
      orchestrator: { agent: 'claude', account: 'auto' },
      workers: ['claude'],
      checks: [{ kind: 'command', run: `${process.execPath} -e "process.exit(0)"` }],
      onLimit: 'switch-account',
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    await waitFor(async () => {
      const runs = await runsService.list(started.value.id);
      if (!runs.ok || !runs.value[0]) return false;
      const lines = await runsService.lines(runs.value[0].id, 0);
      return lines.ok && lines.value.some((line) => line.kind === 'message' && line.text.includes('implementation is underway'));
    });

    const runs = await runsService.list(started.value.id);
    expect(runs.ok && runs.value[0]?.status).toBe('running');
    if (!runs.ok || !runs.value[0]) return;
    const streamedLines = await runsService.lines(runs.value[0].id, 0);
    expect(streamedLines.ok && streamedLines.value.some((line) => line.kind === 'tool' && line.text.includes('Write') && line.text.includes('src/streamed.js'))).toBe(true);
    const current = await jobsService.get(started.value.id);
    expect(current.ok && current.value.status).toBe('running');
    expect(events.some((event) => event.type === 'job.changed' && event.job.id === started.value.id && event.job.step?.name === 'Triage' && event.job.step.index === 1 && event.job.step.total === 3)).toBe(true);
    await waitFor(async () => {
      const job = await jobsService.get(started.value.id);
      return job.ok && (job.value.status === 'done' || job.value.status === 'failed');
    });
    expect(events.some((event) => event.type === 'job.changed' && event.job.id === started.value.id && event.job.step?.name === 'Implement' && event.job.step.index === 2 && event.job.step.total === 3)).toBe(true);
    expect(events.some((event) => event.type === 'job.changed' && event.job.id === started.value.id && event.job.step?.name === 'Verify' && event.job.step.index === 3 && event.job.step.total === 3)).toBe(true);
  }, 30_000);
});

