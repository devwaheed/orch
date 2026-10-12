import { describe, expect, it } from 'vitest';
import { err, ok } from '@orchagents/base';
import type {
  Account,
  AccountId,
  EngineEnv,
  EngineRequest,
  OrchEvent,
  QuotaWindow,
  Result,
  Session,
  SessionId,
  WorktreeId,
} from '@orchagents/contracts';
import { InMemorySessionRepository, type ISessionWorktrees, type SessionRecord } from '../common/sessions.js';
import { SessionsService, type Scheduler } from './sessionsService.js';

const NOW = new Date('2026-10-11T12:00:00.000Z');
const RESET = '2026-10-11T15:00:00.000Z';

function account(id: string, over: Partial<Account> = {}): Account {
  const [agent, name] = id.split('-') as [Account['agent'], string];
  return {
    id: id as AccountId,
    agent,
    name: name.replace(/^./, (c) => c.toUpperCase()),
    primary: false,
    use: true,
    state: 'available',
    profileDir: `/profiles/${id}`,
    skillsShared: true,
    ...over,
  };
}

function session(over: Partial<Session> = {}): Session {
  return {
    id: 's-91e0' as SessionId,
    jobId: 'j-01' as Session['jobId'],
    runId: 'r-04' as Session['runId'],
    title: 'Add OAuth login',
    agent: 'codex',
    accountId: 'codex-personal' as AccountId,
    cliSessionId: 'c1',
    status: 'paused',
    worktree: 'orch/r-04' as WorktreeId,
    startedAt: '2026-10-11T10:00:00.000Z',
    lastActivityAt: '2026-10-11T11:00:00.000Z',
    tokens: 1200,
    position: { step: 'Implement', index: 1, total: 2, attempt: 1 },
    handedOffTo: null,
    handedOffFrom: null,
    ...over,
  };
}

function envFor(id: string): EngineEnv {
  return id.startsWith('claude') ? { CLAUDE_CONFIG_DIR: `/profiles/${id}` } : { CODEX_HOME: `/profiles/${id}` };
}

interface Harness {
  service: SessionsService;
  repo: InMemorySessionRepository;
  calls: EngineRequest[];
  worktreeCalls: Array<{ from: string; branch: string }>;
  events: OrchEvent[];
  accounts: Account[];
  windows: QuotaWindow[];
  clock: { now: Date };
  timers: Array<{ at: Date; run: () => void; cancelled: boolean }>;
  failEngine: { value: string | null };
  failEnv: Set<string>;
  seed(record: SessionRecord): void;
}

function harness(opts: { accounts?: Account[]; windows?: QuotaWindow[]; now?: Date } = {}): Harness {
  const repo = new InMemorySessionRepository();
  const calls: EngineRequest[] = [];
  const worktreeCalls: Array<{ from: string; branch: string }> = [];
  const events: OrchEvent[] = [];
  const accounts = opts.accounts ?? [account('codex-personal'), account('codex-team'), account('claude-work')];
  const windows = opts.windows ?? [];
  const clock = { now: opts.now ?? NOW };
  const timers: Harness['timers'] = [];
  const failEngine: Harness['failEngine'] = { value: null };
  const failEnv = new Set<string>();
  let handle = 0;

  const engine = {
    request: async (request: EngineRequest): Promise<Result<unknown>> => {
      calls.push(request);
      if (failEngine.value && request.op === 'session.handoff') {
        return err({ code: 'internal', message: failEngine.value });
      }
      switch (request.op) {
        case 'session.start':
        case 'session.handoff':
          handle += 1;
          return ok({ session: `h-${handle}` });
        case 'session.resume':
          return ok({ session: request.session, resumed: true });
        default:
          return ok(null);
      }
    },
  };
  const worktrees: ISessionWorktrees = {
    fork: async (from, branch) => {
      worktreeCalls.push({ from, branch });
      return ok({ path: `/repo/.orch/wt/${branch.slice('orch/'.length)}` });
    },
  };
  const scheduler: Scheduler = (at, run) => {
    const timer = { at, run, cancelled: false };
    timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  };

  const service = new SessionsService({
    repo,
    accounts: { list: async () => ok(accounts) },
    quota: { windows: async () => ok(windows) },
    profiles: {
      sessionEnv: async (id: string) => (failEnv.has(id) ? err({ code: 'not_found', message: 'no profile' }) : ok(envFor(id))),
    },
    engine,
    worktrees,
    now: () => clock.now,
    random: (() => {
      let n = 0;
      return () => {
        n += 1;
        return (0x1000 + n * 0x111) / 0x10000;
      };
    })(),
    schedule: scheduler,
  });
  service.onEvent((event) => events.push(event));

  return {
    service,
    repo,
    calls,
    worktreeCalls,
    events,
    accounts,
    windows,
    clock,
    timers,
    failEngine,
    failEnv,
    seed: (record) => repo.put(record),
  };
}

function record(over: Partial<Session> = {}, engineHandle: string | null = 'h-seed', cwd: string | null = '/repo/.orch/wt/r-04'): SessionRecord {
  return { session: session(over), engineHandle, cwd };
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

describe('SessionsService.list', () => {
  it('filters all, resumable (not live) and live, newest activity first', async () => {
    const h = harness();
    h.seed(record({ id: 's-0001' as SessionId, status: 'live', lastActivityAt: '2026-10-11T11:30:00.000Z' }));
    h.seed(record({ id: 's-0002' as SessionId, status: 'ended', lastActivityAt: '2026-10-11T11:45:00.000Z' }));
    h.seed(record({ id: 's-0003' as SessionId, status: 'interrupted', lastActivityAt: '2026-10-10T18:40:00.000Z' }));
    expect(unwrap(await h.service.list('all')).map((s) => s.id)).toEqual(['s-0002', 's-0001', 's-0003']);
    expect(unwrap(await h.service.list('resumable')).map((s) => s.id)).toEqual(['s-0002', 's-0003']);
    expect(unwrap(await h.service.list('live')).map((s) => s.id)).toEqual(['s-0001']);
  });
});

describe('SessionsService.resumeOptions', () => {
  it('returns the four options for a paused session', async () => {
    const h = harness();
    h.seed(record());
    const options = unwrap(await h.service.resumeOptions('s-91e0' as SessionId));
    expect(options.map((o) => [o.mode, o.available])).toEqual([
      ['same', true],
      ['account', true],
      ['agent', true],
      ['fork', true],
    ]);
  });

  it('returns no options for a live session', async () => {
    const h = harness();
    h.seed(record({ status: 'live' }));
    expect(unwrap(await h.service.resumeOptions('s-91e0' as SessionId))).toEqual([]);
  });

  it('reports not_found for an unknown session', async () => {
    const h = harness();
    const result = await h.service.resumeOptions('s-ffff' as SessionId);
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});

describe('SessionsService.resume: continue (SES-01)', () => {
  it('reopens the same session on its account with the engine', async () => {
    const h = harness();
    h.seed(record());
    const resumed = unwrap(await h.service.resume({ mode: 'same', sessionId: 's-91e0' as SessionId }));
    expect(resumed).toMatchObject({ id: 's-91e0', status: 'live', accountId: 'codex-personal' });
    expect(h.calls).toContainEqual({ op: 'session.resume', session: 'h-seed', env: { CODEX_HOME: '/profiles/codex-personal' } });
    expect(h.events).toContainEqual({ type: 'session.changed', session: expect.objectContaining({ id: 's-91e0', status: 'live' }) });
  });

  it('waits for the account reset when it is limited, then reopens on its own account', async () => {
    const h = harness({
      accounts: [account('codex-personal', { state: 'limited' }), account('codex-team')],
      windows: [{ accountId: 'codex-personal' as AccountId, window: '5h', usedPct: 100, resetsAt: RESET, source: 'reported', seenAt: '2026-10-11T11:59:00.000Z' }],
    });
    h.seed(record());
    const waiting = unwrap(await h.service.resume({ mode: 'same', sessionId: 's-91e0' as SessionId }));
    expect(waiting.status).toBe('paused');
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]?.at.toISOString()).toBe(RESET);
    expect(h.calls.some((c) => c.op === 'session.resume')).toBe(false);

    h.timers[0]?.run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.calls).toContainEqual({ op: 'session.resume', session: 'h-seed', env: { CODEX_HOME: '/profiles/codex-personal' } });
    expect((await h.service.get('s-91e0' as SessionId))).toMatchObject({ ok: true, value: { status: 'live' } });
  });

  it('holds a limited session with no known reset until the limit clears, with no timer', async () => {
    const h = harness({ accounts: [account('codex-personal', { state: 'limited' }), account('codex-team')] });
    h.seed(record());
    const held = unwrap(await h.service.resume({ mode: 'same', sessionId: 's-91e0' as SessionId }));
    expect(held.status).toBe('paused');
    expect(h.timers).toHaveLength(0);
    expect(h.calls.some((c) => c.op === 'session.resume')).toBe(false);
  });

  it('refuses when orch has no engine record of the session', async () => {
    const h = harness();
    h.seed(record({}, null));
    const result = await h.service.resume({ mode: 'same', sessionId: 's-91e0' as SessionId });
    expect(result).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(h.calls).toEqual([]);
  });

  it('never falls back to another account when the session account has no env', async () => {
    const h = harness();
    h.seed(record());
    h.failEnv.add('codex-personal');
    const result = await h.service.resume({ mode: 'same', sessionId: 's-91e0' as SessionId });
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(h.calls).toEqual([]);
  });
});

describe('SessionsService.resume: hand off (SES-02)', () => {
  it('hands off to another account in the same worktree and ends the old session', async () => {
    const h = harness();
    h.seed(record());
    const handed = unwrap(await h.service.resume({ mode: 'account', sessionId: 's-91e0' as SessionId, to: 'codex-team' as AccountId }));

    expect(h.calls).toContainEqual({
      op: 'session.handoff',
      from: 'h-seed',
      toAgent: 'codex',
      env: { CODEX_HOME: '/profiles/codex-team' },
      cwd: '/repo/.orch/wt/r-04',
    });
    expect(handed).toMatchObject({ agent: 'codex', accountId: 'codex-team', status: 'live', worktree: 'orch/r-04', handedOffFrom: 's-91e0', handedOffTo: null });
    expect(handed.id).not.toBe('s-91e0');
    const old = unwrap(await h.service.get('s-91e0' as SessionId));
    expect(old).toMatchObject({ status: 'ended', handedOffTo: handed.id, position: expect.objectContaining({ note: `Handed off to ${handed.id}` }) });
  });

  it('hands off to another agent in the same worktree', async () => {
    const h = harness();
    h.seed(record());
    const handed = unwrap(await h.service.resume({ mode: 'agent', sessionId: 's-91e0' as SessionId, to: 'claude-work' as AccountId }));
    expect(h.calls).toContainEqual(expect.objectContaining({ op: 'session.handoff', toAgent: 'claude', env: { CLAUDE_CONFIG_DIR: '/profiles/claude-work' } }));
    expect(handed).toMatchObject({ agent: 'claude', accountId: 'claude-work', status: 'live' });
  });

  it('rejects a target of the wrong kind, without calling the engine', async () => {
    const h = harness();
    h.seed(record());
    expect(await h.service.resume({ mode: 'account', sessionId: 's-91e0' as SessionId, to: 'claude-work' as AccountId })).toMatchObject({ ok: false, error: { code: 'validation_failed' } });
    expect(await h.service.resume({ mode: 'agent', sessionId: 's-91e0' as SessionId, to: 'codex-team' as AccountId })).toMatchObject({ ok: false, error: { code: 'validation_failed' } });
    expect(h.calls).toEqual([]);
  });

  it('refuses a limited account as a hand-off target (the option check runs first)', async () => {
    const h = harness({ accounts: [account('codex-personal'), account('codex-team', { state: 'limited' })] });
    h.seed(record());
    expect(await h.service.resume({ mode: 'account', sessionId: 's-91e0' as SessionId, to: 'codex-team' as AccountId })).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(h.calls).toEqual([]);
  });

  it('leaves the old session as it was when the engine refuses the hand-off', async () => {
    const h = harness();
    h.seed(record());
    h.failEngine.value = 'Claw refused the hand-off.';
    const result = await h.service.resume({ mode: 'account', sessionId: 's-91e0' as SessionId, to: 'codex-team' as AccountId });
    expect(result).toMatchObject({ ok: false, error: { message: 'Claw refused the hand-off.' } });
    expect(unwrap(await h.service.get('s-91e0' as SessionId))).toMatchObject({ status: 'paused', handedOffTo: null });
    expect(unwrap(await h.service.list('all'))).toHaveLength(1);
  });
});

describe('SessionsService.resume: fork (SES-03)', () => {
  it('creates orch/<run-id>-fork-<n> from the worktree and starts a new session there; the original is unchanged', async () => {
    const h = harness();
    h.seed(record());
    const forked = unwrap(await h.service.resume({ mode: 'fork', sessionId: 's-91e0' as SessionId }));

    expect(h.worktreeCalls).toEqual([{ from: '/repo/.orch/wt/r-04', branch: 'orch/r-04-fork-1' }]);
    expect(h.calls).toContainEqual({
      op: 'session.start',
      agent: 'codex',
      cwd: '/repo/.orch/wt/r-04-fork-1',
      env: { CODEX_HOME: '/profiles/codex-personal' },
      readOnly: false,
    });
    expect(forked).toMatchObject({ agent: 'codex', accountId: 'codex-personal', status: 'live', worktree: 'orch/r-04-fork-1', runId: null, jobId: 'j-01' });
    const original = unwrap(await h.service.get('s-91e0' as SessionId));
    expect(original).toMatchObject({ status: 'paused', worktree: 'orch/r-04', handedOffTo: null });
  });

  it('numbers the next fork after the forks already in use', async () => {
    const h = harness();
    h.seed(record());
    unwrap(await h.service.resume({ mode: 'fork', sessionId: 's-91e0' as SessionId }));
    const second = unwrap(await h.service.resume({ mode: 'fork', sessionId: 's-91e0' as SessionId }));
    expect(second.worktree).toBe('orch/r-04-fork-2');
  });

  it('reports a failed worktree and creates no session', async () => {
    const h = harness();
    h.seed(record());
    const failing: ISessionWorktrees = { fork: async () => err({ code: 'conflict', message: 'branch exists' }) };
    const service = new SessionsService({ ...depsOf(h), worktrees: failing });
    const result = await service.resume({ mode: 'fork', sessionId: 's-91e0' as SessionId });
    expect(result).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(h.calls).toEqual([]);
  });
});

describe('SessionsService.resume: rules', () => {
  it('refuses to resume a live session', async () => {
    const h = harness();
    h.seed(record({ status: 'live' }));
    const result = await h.service.resume({ mode: 'fork', sessionId: 's-91e0' as SessionId });
    expect(result).toMatchObject({ ok: false, error: { code: 'conflict', message: 'Session s-91e0 is still live.' } });
  });

  it('refuses an option that is not available, with its reason', async () => {
    const h = harness({ accounts: [account('codex-personal')] });
    h.seed(record());
    const result = await h.service.resume({ mode: 'account', sessionId: 's-91e0' as SessionId, to: 'codex-team' as AccountId });
    expect(result).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(h.calls).toEqual([]);
  });

  it('rejects a request that does not match the schema', async () => {
    const h = harness();
    h.seed(record());
    const result = await h.service.resume({ mode: 'account', sessionId: 'nope' } as unknown as Parameters<SessionsService['resume']>[0]);
    expect(result).toMatchObject({ ok: false, error: { code: 'validation_failed' } });
  });
});

describe('SessionsService retention (SES-04)', () => {
  it('deletes ended sessions 90 days after they end, using the injected clock', async () => {
    const h = harness();
    h.seed(record({ id: 's-old1' as SessionId, status: 'ended', lastActivityAt: '2026-07-13T12:00:00.000Z' }));
    h.seed(record({ id: 's-new1' as SessionId, status: 'ended', lastActivityAt: '2026-07-14T12:00:00.000Z' }));
    h.seed(record({ id: 's-pau1' as SessionId, status: 'paused', lastActivityAt: '2026-01-01T00:00:00.000Z' }));

    expect(unwrap(await h.service.purgeExpired())).toEqual(['s-old1']);
    expect(unwrap(await h.service.list('all')).map((s) => s.id).sort()).toEqual(['s-new1', 's-pau1']);

    h.clock.now = new Date('2026-10-12T12:00:00.000Z');
    expect(unwrap(await h.service.purgeExpired())).toEqual(['s-new1']);
  });
});

describe('SessionsService engine status', () => {
  it('marks a failed engine session interrupted and a stopped one ended', async () => {
    const h = harness();
    h.seed(record({ status: 'live' }));
    h.service.applyEngineStatus('h-seed', 'failed');
    expect(unwrap(await h.service.get('s-91e0' as SessionId)).status).toBe('interrupted');
    h.service.applyEngineStatus('h-seed', 'stopped');
    expect(unwrap(await h.service.get('s-91e0' as SessionId)).status).toBe('ended');
  });
});

function depsOf(h: Harness) {
  return {
    repo: h.repo,
    accounts: { list: async () => ok(h.accounts) },
    quota: { windows: async () => ok(h.windows) },
    profiles: { sessionEnv: async (id: string) => ok(envFor(id)) },
    engine: { request: async () => ok(null) },
    worktrees: { fork: async () => ok({ path: '/x' }) },
    now: () => h.clock.now,
    schedule: (() => () => undefined) as Scheduler,
  };
}
