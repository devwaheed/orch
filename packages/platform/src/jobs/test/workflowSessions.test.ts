/**
 * Story E-01: Workflow sessions tracking, state file persistence, session.resume/handoff,
 * and concurrent jobs session attribution.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  Account,
  AccountId,
  AgentId,
  EngineEnv,
  JobSpec,
  OrchEvent,
  PickAccountResult,
  Session,
} from '@orchagents/contracts';
import { EngineClient } from '../../engine/common/engineClient.js';
import { createPortPair } from '../../engine/test/portPair.js';
import { serveEngine, type ServedEngine } from '../../engine/node/serve.js';
import type { EngineHost } from '../../engine/node/engineHost.js';
import { FAKE_AGENT_SCRIPT_PATH, createFakeAdapter } from '../../adapters/node/fake.js';
import { StoreService } from '../../store/node/storeService.js';
import { GitService, runGit } from '../../git/node/gitService.js';
import { RunsService } from '../../runs/node/runsService.js';
import { SessionsService } from '../../sessions/node/sessionsService.js';
import { StoreSessionRepository } from '../../sessions/node/storeSessionRepository.js';
import { JobsService } from '../node/jobsService.js';
import type { IProfilesService, ProfileInfo } from '../../profiles/common/profiles.js';

let root = '';
let engineDir = '';
let repoDir = '';
let client: EngineClient;
let host: EngineHost;
let served: ServedEngine;
let store: StoreService;
let gitService: GitService;
let runsService: RunsService;
let sessionsService: SessionsService;
let jobsService: JobsService;
const events: OrchEvent[] = [];

let dirA = '';
let dirB = '';
const acctA: AccountId = 'claude-a' as AccountId;
const acctB: AccountId = 'claude-b' as AccountId;

const accounts: Account[] = [
  { id: acctA, agent: 'claude', name: 'Claude A', primary: true, use: true, state: 'available', profileDir: '', skillsShared: true },
  { id: acctB, agent: 'claude', name: 'Claude B', primary: false, use: true, state: 'available', profileDir: '', skillsShared: true },
];

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
  async pickAccount(agent: AgentId): Promise<{ ok: true; value: PickAccountResult }> {
    if (agent === 'claude') {
      return { ok: true, value: { kind: 'account', accountId: acctA } };
    }
    return { ok: true, value: { kind: 'none', agent, reason: 'unsupported' } };
  }

  observe() {
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
  root = mkdtempSync(path.join(tmpdir(), 'orch-wf-sessions-'));
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
  await runGit(['-C', repoDir, 'config', 'user.name', 'Test']);
  await runGit(['-C', repoDir, 'config', 'user.email', 'test@example.com']);
  writeFileSync(path.join(repoDir, 'README.md'), '# Main Repo\n', 'utf8');
  mkdirSync(path.join(repoDir, 'test'), { recursive: true });
  writeFileSync(path.join(repoDir, 'test', 'existing.test.js'), '// original test\n', 'utf8');
  await runGit(['-C', repoDir, 'add', '.']);
  await runGit(['-C', repoDir, 'commit', '-m', 'Initial commit']);

  const profiles = new TestProfiles();
  const quota = new TestQuota();
  sessionsService = new SessionsService({
    repo: new StoreSessionRepository(store),
    accounts: { list: async () => ({ ok: true, value: accounts }) },
    quota: { windows: async () => ({ ok: true, value: [] }) },
    profiles,
    engine: client,
    worktrees: { fork: async () => ({ ok: true, value: { path: '/unused' } }) },
    now: () => new Date(),
  });

  runsService = new RunsService({
    store,
    profiles,
    engine: client,
    sessions: sessionsService,
    onEvent: (e) => events.push(e),
  });

  jobsService = new JobsService({
    store,
    quota,
    profiles,
    engine: client,
    git: gitService,
    runs: runsService,
    sessions: sessionsService,
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

describe.skipIf(process.platform === 'win32')('Workflow sessions tracking & resume/handoff (Story E-01)', () => {
  it('records implementer session in state file, emits session.status, and allows session.resume and session.handoff', async () => {
    writeFileSync(path.join(dirA, 'fake-agent.json'), JSON.stringify({ scenario: 'succeed' }), 'utf8');

    const spec: JobSpec = {
      mode: 'single',
      goal: 'implement e-01 feature',
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

    // Wait for job to finish
    await waitFor(async () => {
      const current = await jobsService.get(job.id);
      return current.ok && (current.value.status === 'done' || current.value.status === 'failed');
    });

    const finalJob = await jobsService.get(job.id);
    expect(finalJob.ok).toBe(true);
    if (!finalJob.ok) return;
    expect(finalJob.value.status).toBe('done');

    // 1. Verify engine host state file has recorded the workflow sessions
    const stateFile = path.join(engineDir, 'state.json');
    expect(existsSync(stateFile)).toBe(true);
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    const sessionEntries = Object.entries(state.sessions ?? {}) as Array<[string, Record<string, unknown>]>;
    expect(sessionEntries.length).toBeGreaterThan(0);

    const implementSession = sessionEntries.find(([, rec]) => rec.node === 'implement');
    expect(implementSession).toBeDefined();
    const [implementHandle, implementRec] = implementSession!;
    expect(implementRec.workflow).toBeDefined();
    expect(implementRec.agent).toBe('claude');
    expect(implementRec.env).toEqual({ CLAUDE_CONFIG_DIR: dirA });

    // 2. Verify sessionsService has recorded this session
    const listed = await sessionsService.list('all');
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const recordedSession = listed.value.find((s: Session) => s.jobId === job.id);
    expect(recordedSession).toBeDefined();

    // 3. Test session.resume on the workflow session handle
    const resumeRes = await client.request({
      op: 'session.resume',
      session: implementHandle,
      env: { CLAUDE_CONFIG_DIR: dirA },
    });
    expect(resumeRes.ok).toBe(true);

    // Stop session before handoff
    await client.request({
      op: 'session.stop',
      session: implementHandle,
    });

    // 4. Test session.handoff on the workflow session handle
    const handoffRes = await client.request({
      op: 'session.handoff',
      from: implementHandle,
      toAgent: 'claude',
      env: { CLAUDE_CONFIG_DIR: dirB },
      cwd: String(implementRec.cwd),
    });
    expect(handoffRes.ok).toBe(true);
    if (!handoffRes.ok) return;
    const handedHandle = (handoffRes.value as { session?: string })?.session;
    expect(handedHandle).toBeDefined();

    // Clean up handed off session
    if (handedHandle) {
      await client.request({ op: 'session.stop', session: handedHandle });
    }
  });

  it('two concurrent jobs attribute sessions correctly without crossover', async () => {
    writeFileSync(path.join(dirA, 'fake-agent.json'), JSON.stringify({ scenario: 'succeed' }), 'utf8');

    const spec1: JobSpec = {
      mode: 'single',
      goal: 'concurrent job 1',
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

    const spec2: JobSpec = {
      mode: 'single',
      goal: 'concurrent job 2',
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

    const start1 = await jobsService.start(spec1);
    const start2 = await jobsService.start(spec2);
    expect(start1.ok).toBe(true);
    expect(start2.ok).toBe(true);
    if (!start1.ok || !start2.ok) return;

    await waitFor(async () => {
      const [j1, j2] = await Promise.all([jobsService.get(start1.value.id), jobsService.get(start2.value.id)]);
      return (
        j1.ok && (j1.value.status === 'done' || j1.value.status === 'failed') &&
        j2.ok && (j2.value.status === 'done' || j2.value.status === 'failed')
      );
    }, 45_000);

    const [runs1, runs2] = await Promise.all([runsService.list(start1.value.id), runsService.list(start2.value.id)]);
    expect(runs1.ok).toBe(true);
    expect(runs2.ok).toBe(true);
    if (!runs1.ok || !runs2.ok) return;
    expect(runs1.value.length).toBeGreaterThan(0);
    expect(runs2.value.length).toBeGreaterThan(0);

    const run1 = runs1.value[0]!;
    const run2 = runs2.value[0]!;

    expect(run1.sessionId).toBeDefined();
    expect(run2.sessionId).toBeDefined();
    expect(run1.sessionId).not.toBe(run2.sessionId);

    // Check sessions service
    const sessionsList = await sessionsService.list('all');
    expect(sessionsList.ok).toBe(true);
    if (!sessionsList.ok) return;
    const session1 = sessionsList.value.find((s: Session) => s.jobId === start1.value.id);
    const session2 = sessionsList.value.find((s: Session) => s.jobId === start2.value.id);
    expect(session1).toBeDefined();
    expect(session2).toBeDefined();
    expect(session1?.runId).toBe(run1.id);
    expect(session2?.runId).toBe(run2.id);
  });
});
