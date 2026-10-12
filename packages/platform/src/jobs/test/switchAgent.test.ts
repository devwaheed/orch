/**
 * onLimit 'switch-agent' (QTA-03, SES-02) and the session producers in jobs
 * (SES, sessions persistence). Real store, runs, jobs and sessions; the engine,
 * git, quota and profiles are fakes, so no agent runs and no git repo is needed.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TAKE_OVER_AFTER_LIMIT } from '../../runs/common/runs.js';
import type {
  Account,
  AccountId,
  AgentId,
  ChangedFile,
  EngineEnv,
  EngineEvent,
  EngineRequest,
  JobSpec,
  OrchEvent,
  PickAccountResult,
  Result,
  RunId,
  Session,
} from '@orchagents/contracts';
import { StoreService } from '../../store/node/storeService.js';
import { RunsService } from '../../runs/node/runsService.js';
import { SessionsService } from '../../sessions/node/sessionsService.js';
import { StoreSessionRepository } from '../../sessions/node/storeSessionRepository.js';
import type { CreateWorktreeOptions, CreateWorktreeResult, IGitService } from '../../git/common/git.js';
import type { IProfilesService, ProfileInfo } from '../../profiles/common/profiles.js';
import { createFakeAdapter } from '../../adapters/node/fake.js';
import { JobsService } from '../node/jobsService.js';

// Always in the future, whatever the wall clock says.
const RESET = new Date(Date.now() + 4 * 3_600_000).toISOString();
const CLAUDE_A = 'claude-a' as AccountId;
const CLAUDE_B = 'claude-b' as AccountId;
const CODEX_A = 'codex-a' as AccountId;

let root: string;
let store: StoreService;
let engineRequests: EngineRequest[];
let engineListeners: Array<(event: EngineEvent) => void>;
let workflowCount: number;
let handoffCount: number;
let accounts: Account[];
let roomFor: Partial<Record<AgentId, AccountId | null>>;
let jobs: JobsService;
let runs: RunsService;
let sessions: SessionsService;
const events: OrchEvent[] = [];

function account(id: AccountId, agent: AgentId): Account {
  return { id, agent, name: id, primary: false, use: true, state: 'available', profileDir: `/profiles/${id}`, skillsShared: true };
}

/** Makes worktree folders only as paths: the jobs under test never read them. */
class FakeGit implements IGitService {
  async ensureExclude(): Promise<Result<void>> {
    return { ok: true, value: undefined };
  }
  async getDefaultBranch(): Promise<Result<string>> {
    return { ok: true, value: 'main' };
  }
  async createWorktree(options: CreateWorktreeOptions): Promise<Result<CreateWorktreeResult>> {
    const runId = options.runId;
    return { ok: true, value: { worktreePath: path.join(root, 'wt', runId), branch: `orch/${runId}`, targetBranch: 'main' } };
  }
  async removeWorktree(): Promise<Result<void>> {
    return { ok: true, value: undefined };
  }
  async getDiff(): Promise<Result<string>> {
    return { ok: true, value: '' };
  }
  async getChangedFiles(): Promise<Result<ChangedFile[]>> {
    return { ok: true, value: [] };
  }
}

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
    return { ok: true, value: accountId.startsWith('codex') ? { CODEX_HOME: `/p/${accountId}` } : { CLAUDE_CONFIG_DIR: `/p/${accountId}` } };
  }
}

function engineReply(request: EngineRequest): unknown {
  switch (request.op) {
    case 'workflow.start':
      workflowCount += 1;
      return { workflow: `wf-${workflowCount}` };
    case 'session.handoff':
      handoffCount += 1;
      return { session: `s-handed-${handoffCount}` };
    default:
      return { session: request.op === 'session.resume' ? request.session : 's-other' };
  }
}

const quota = {
  async pickAccount(agent: AgentId): Promise<Result<PickAccountResult>> {
    const id = roomFor[agent];
    if (id) return { ok: true, value: { kind: 'account', accountId: id } };
    return { ok: true, value: { kind: 'wait', agent, until: RESET } };
  },
  observe() {
    return { ok: true as const, value: undefined };
  },
};

function emitEngine(event: EngineEvent): void {
  for (const listener of engineListeners) listener(event);
}

async function waitFor(description: string, check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${description}`);
}

function spec(onLimit: JobSpec['onLimit']): JobSpec {
  return {
    mode: 'single',
    goal: 'switch when limited',
    repoPath: path.join(root, 'repo'),
    orchestrator: { agent: 'claude', account: CLAUDE_A },
    workers: ['claude', 'codex'],
    checks: [],
    onLimit,
  };
}

/** Starts a job, sets its session running, and reports a limit on that session. Returns the run id. */
async function startLimitedJob(onLimit: JobSpec['onLimit']): Promise<RunId> {
  const started = await jobs.start(spec(onLimit));
  expect(started.ok).toBe(true);
  const runId = 'r-1' as RunId;
  emitEngine({ type: 'session.status', session: 's-1', status: 'running' });
  await waitFor('the session to be recorded', async () => {
    const listed = await sessions.list('all');
    return listed.ok && listed.value.length === 1;
  });
  emitEngine({
    type: 'session.output',
    session: 's-1',
    seq: 1,
    kind: 'result',
    text: `Rate limit reached. Resets at ${RESET} (window: 5h, used: 100%)`,
  });
  await waitFor('the limit to be handled', async () => (await runs.getRun(runId))?.status !== 'running' || (await runs.getRun(runId))?.agent !== 'claude');
  return runId;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'orch-switch-agent-'));
  store = new StoreService();
  await store.open({ dbPath: path.join(root, 'orch.db'), backupDir: path.join(root, 'backups') });
  engineRequests = [];
  engineListeners = [];
  workflowCount = 0;
  handoffCount = 0;
  accounts = [account(CLAUDE_A, 'claude'), account(CLAUDE_B, 'claude'), account(CODEX_A, 'codex')];
  roomFor = { codex: CODEX_A, claude: CLAUDE_B };
  events.length = 0;

  const engine = {
    request: async (request: EngineRequest): Promise<Result<unknown>> => {
      engineRequests.push(request);
      return { ok: true, value: engineReply(request) };
    },
    onEvent: (listener: (event: EngineEvent) => void) => {
      engineListeners.push(listener);
      return () => undefined;
    },
  };
  let seq = 0;
  sessions = new SessionsService({
    repo: new StoreSessionRepository(store),
    accounts: { list: async () => ({ ok: true, value: accounts }) },
    quota: { windows: async () => ({ ok: true, value: [] }) },
    profiles: new FakeProfiles(),
    engine,
    worktrees: { fork: async () => ({ ok: true, value: { path: '/unused' } }) },
    now: () => new Date('2026-10-11T12:00:00.000Z'),
    random: () => {
      seq += 1;
      return seq / 0x10000;
    },
    schedule: () => () => undefined,
  });
  runs = new RunsService({ store, profiles: new FakeProfiles(), engine, sessions, onEvent: (e) => events.push(e), now: () => new Date('2026-10-11T12:00:00.000Z') });
  jobs = new JobsService({
    store,
    quota,
    profiles: new FakeProfiles(),
    engine,
    git: new FakeGit(),
    runs,
    sessions,
    onEvent: (e) => events.push(e),
    adapterFor: (agent) => createFakeAdapter(agent),
  });
});

afterEach(async () => {
  store.close();
  await rm(root, { recursive: true, force: true });
});

describe('onLimit switch-agent (QTA-03, SES-02)', () => {
  it('hands the paused run to another agent with room, in the same worktree, and the old session ends "Handed off to"', async () => {
    const runId = await startLimitedJob('switch-agent');

    await waitFor('the run to move to codex', async () => (await runs.getRun(runId))?.agent === 'codex');
    const run = await runs.getRun(runId);
    expect(run).toMatchObject({ agent: 'codex', accountId: CODEX_A, status: 'running', sessionId: 's-handed-1' });

    const handoff = engineRequests.find((r) => r.op === 'session.handoff');
    expect(handoff).toMatchObject({ op: 'session.handoff', from: 's-1', toAgent: 'codex', cwd: path.join(root, 'wt', 'r-1') });
    // The new agent is given the task to carry on with; a handoff alone starts no turn.
    expect(engineRequests).toContainEqual({ op: 'session.send', session: 's-handed-1', text: TAKE_OVER_AFTER_LIMIT('switch when limited') });

    const listed = await sessions.list('all');
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const old = listed.value.find((s: Session) => s.status === 'ended');
    const fresh = listed.value.find((s: Session) => s.status === 'live');
    expect(old?.position.note).toBe(`Handed off to ${fresh?.id}`);
    expect(fresh).toMatchObject({ agent: 'codex', accountId: CODEX_A, worktree: 'orch/r-1', handedOffFrom: old?.id });
  });

  it('stays paused when no other agent has an account with room', async () => {
    roomFor = { claude: CLAUDE_B, codex: null };
    const runId = await startLimitedJob('switch-agent');

    await waitFor('the limit to be applied', async () => (await runs.getRun(runId))?.status === 'paused_limit');
    expect(engineRequests.some((r) => r.op === 'session.handoff')).toBe(false);
    expect((await runs.getRun(runId))?.agent).toBe('claude');
  });

  it("'ask' stays paused and does not hand the run to another agent", async () => {
    const runId = await startLimitedJob('ask');

    await waitFor('the limit to be applied', async () => (await runs.getRun(runId))?.status === 'paused_limit');
    expect(engineRequests.some((r) => r.op === 'session.handoff')).toBe(false);
  });
});

describe('session producers in jobs (SES)', () => {
  it('records the run session on first sight and applies its engine status', async () => {
    const started = await jobs.start(spec('switch-account'));
    expect(started.ok).toBe(true);
    emitEngine({ type: 'session.status', session: 's-1', status: 'running' });

    await waitFor('the session to be live', async () => {
      const listed = await sessions.list('all');
      return listed.ok && listed.value.some((s) => s.status === 'live' && s.agent === 'claude' && s.accountId === CLAUDE_A);
    });
    emitEngine({ type: 'session.status', session: 's-1', status: 'failed' });
    await waitFor('the session to be interrupted', async () => {
      const listed = await sessions.list('all');
      return listed.ok && listed.value.some((s) => s.status === 'interrupted');
    });
    expect((await runs.getRun('r-1' as RunId))?.sessionId).toBe('s-1');
  });
});
