/**
 * Each resume mode end to end: the real engine host (pinned Claw, ADR 0011)
 * with the fake agent standing in for `claude`, a real git repository and the
 * real GitService for the worktree. No real agent runs and no quota is spent.
 *
 * Hand-off to another agent is not covered here: the engine host only takes a
 * claude binary, so Claw cannot start another agent with the fake. The unit
 * tests cover that path against a stub engine.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ok } from '@orch/base';
import type { Account, AccountId, EngineEnv, EngineRequest, Result, Session, SessionId, WorktreeId } from '@orch/contracts';
import { EngineClient } from '../../engine/common/engineClient.js';
import { createPortPair } from '../../engine/test/portPair.js';
import { FAKE_AGENT_SCRIPT_PATH } from '../../adapters/node/fake.js';
import type { EngineHost } from '../../engine/node/engineHost.js';
import { serveEngine, type ServedEngine } from '../../engine/node/serve.js';
import { GitService, runGit } from '../../git/node/gitService.js';
import { InMemorySessionRepository } from '../common/sessions.js';
import { GitSessionWorktrees } from './forkWorktree.js';
import { SessionsService } from './sessionsService.js';

const describeUnix = process.platform === 'win32' ? describe.skip : describe;

let root = '';
let host: EngineHost;
let served: ServedEngine;
let client: EngineClient;
let repo = '';
let worktree = '';
let sessions: SessionsService;
let store: InMemorySessionRepository;
const engineCalls: EngineRequest[] = [];

let envA: EngineEnv = { CLAUDE_CONFIG_DIR: '' };
let envB: EngineEnv = { CLAUDE_CONFIG_DIR: '' };
const accounts: Account[] = [];

function envFor(id: string): EngineEnv | undefined {
  if (id === 'claude-a') return envA;
  if (id === 'claude-b') return envB;
  return undefined;
}

function account(id: string, state: Account['state'] = 'available'): Account {
  const [agent, name] = id.split('-') as [Account['agent'], string];
  return { id: id as AccountId, agent, name, primary: false, use: true, state, profileDir: '', skillsShared: true };
}

async function git(args: string[], cwd: string): Promise<string> {
  const result = await runGit(['-C', cwd, '-c', 'user.name=orch', '-c', 'user.email=orch@example.com', ...args]);
  return result.stdout;
}

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'orch-sessions-e2e-'));
  const home = path.join(root, 'engine', 'home');
  mkdirSync(home, { recursive: true });

  // A real repository with one commit, and a worktree from the real GitService (JOB-02).
  repo = path.join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  await git(['init', '-q', '-b', 'main'], repo);
  writeFileSync(path.join(repo, 'README.md'), 'hello\n');
  await git(['add', '.'], repo);
  await git(['commit', '-q', '-m', 'init'], repo);
  const wt = await new GitService().createWorktree({ repoPath: repo, runId: 'r-01' });
  if (!wt.ok) throw new Error(wt.error.message);
  worktree = wt.value.worktreePath;

  for (const id of ['claude-a', 'claude-b']) {
    const dir = path.join(root, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'account.json'), JSON.stringify({ emailMasked: `${id[7]}•••@example.com`, plan: 'pro', signedIn: true }));
    if (id === 'claude-a') envA = { CLAUDE_CONFIG_DIR: dir };
    else envB = { CLAUDE_CONFIG_DIR: dir };
    accounts.push(account(id));
  }

  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('CLAWO_NO_EMBEDDED_SERVER', '1');
  vi.stubEnv('CLAWO_WF_DIR', path.join(root, 'engine', 'wf'));
  vi.stubEnv('CLAWO_RUNS_DIR', path.join(root, 'engine', 'runs'));

  const { createEngineHost } = await import('../../engine/node/engineHost.js');
  host = await createEngineHost({
    engineDir: path.join(root, 'engine'),
    realHome: { HOME: path.join(root, 'real-home') },
    claudeBin: FAKE_AGENT_SCRIPT_PATH,
  });
  const pair = createPortPair();
  served = serveEngine(host, pair.right);
  client = new EngineClient(pair.left);

  const engine = {
    request: async (request: EngineRequest): Promise<Result<unknown>> => {
      engineCalls.push(request);
      return client.request(request);
    },
  };
  store = new InMemorySessionRepository();
  sessions = new SessionsService({
    repo: store,
    accounts: { list: async () => ok(accounts) },
    quota: { windows: async () => ok([]) },
    profiles: {
      sessionEnv: async (id: string) => {
        const env = envFor(id);
        return env ? ok(env) : { ok: false, error: { code: 'not_found', message: `no profile ${id}` } };
      },
    },
    engine,
    worktrees: new GitSessionWorktrees(),
    now: () => new Date(),
  });
});

afterAll(async () => {
  sessions?.dispose();
  served?.close();
  client?.close();
  await host?.dispose();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

async function call(request: EngineRequest): Promise<Record<string, unknown>> {
  const result = await client.request(request);
  if (!result.ok) throw new Error(`${request.op} failed: ${result.error.code} ${result.error.message}`);
  return (result.value ?? {}) as Record<string, unknown>;
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

describeUnix('resume modes with the real engine and the fake agent', () => {
  let seededId = '' as SessionId;
  let engineHandle = '';

  it('seeds a session the way a paused run leaves it: started, used, stopped', async () => {
    const started = await call({ op: 'session.start', agent: 'claude', cwd: worktree, env: envA, readOnly: false });
    engineHandle = String(started.session);
    await call({ op: 'session.send', session: engineHandle, text: 'say hello' });
    await call({ op: 'session.stop', session: engineHandle });

    seededId = 's-e2e1' as SessionId;
    store.put({
      session: {
        id: seededId,
        jobId: 'j-01' as Session['jobId'],
        runId: 'r-01' as Session['runId'],
        title: 'Add OAuth login',
        agent: 'claude',
        accountId: 'claude-a' as AccountId,
        cliSessionId: '',
        status: 'paused',
        worktree: 'orch/r-01' as WorktreeId,
        startedAt: new Date().toISOString() as Session['startedAt'],
        lastActivityAt: new Date().toISOString() as Session['lastActivityAt'],
        tokens: 0,
        position: { step: 'Implement', index: 1, total: 2, attempt: 1 },
        handedOffTo: null,
        handedOffFrom: null,
      },
      engineHandle,
      cwd: worktree,
    });
    expect(unwrap(await sessions.list('resumable')).map((s) => s.id)).toEqual([seededId]);
  });

  it('continue (SES-01): reopens the same session on its own account', async () => {
    const resumed = unwrap(await sessions.resume({ mode: 'same', sessionId: seededId }));
    expect(resumed).toMatchObject({ id: seededId, status: 'live', accountId: 'claude-a' });
    expect(engineCalls).toContainEqual({ op: 'session.resume', session: engineHandle, env: envA });
    // Claw hands off only a session with a completed exchange in this process. A paused
    // session (JOB-07) is still running in Claw, so pause it in orch's record and hand it off.
    await call({ op: 'session.send', session: engineHandle, text: 'before handoff' });
    const current = store.get(seededId);
    if (!current) throw new Error('seeded session missing');
    store.put({ ...current, session: { ...current.session, status: 'paused' } });
    expect(unwrap(await sessions.get(seededId))).toMatchObject({ status: 'paused' });
  });

  it('hand off to another account (SES-02): same worktree, old session ended with a pointer', async () => {
    const handed = unwrap(await sessions.resume({ mode: 'account', sessionId: seededId, to: 'claude-b' as AccountId }));
    expect(handed).toMatchObject({ agent: 'claude', accountId: 'claude-b', status: 'live', worktree: 'orch/r-01', handedOffFrom: seededId });

    const old = unwrap(await sessions.get(seededId));
    expect(old).toMatchObject({ status: 'ended', handedOffTo: handed.id, position: expect.objectContaining({ note: `Handed off to ${handed.id}` }) });
    const handle = store.get(handed.id)?.engineHandle ?? '';
    const sent = await call({ op: 'session.send', session: handle, text: 'continue' });
    expect(typeof sent.output).toBe('string');
  });

  it('fork (SES-03): new branch and worktree from the current state, with a new session; the original stays', async () => {
    const forked = unwrap(await sessions.resume({ mode: 'fork', sessionId: seededId }));
    expect(forked).toMatchObject({ agent: 'claude', accountId: 'claude-a', status: 'live', worktree: 'orch/r-01-fork-1', runId: null });

    const forkPath = path.join(repo, '.orch', 'wt', 'r-01-fork-1');
    expect(existsSync(forkPath)).toBe(true);
    const branches = await git(['branch', '--list', 'orch/r-01-fork-1'], repo);
    expect(branches).toContain('orch/r-01-fork-1');
    const head = await git(['rev-parse', '--abbrev-ref', 'HEAD'], forkPath);
    expect(head.trim()).toBe('orch/r-01-fork-1');
    expect(unwrap(await sessions.get(seededId))).toMatchObject({ worktree: 'orch/r-01', handedOffTo: expect.any(String) });
  });
});
