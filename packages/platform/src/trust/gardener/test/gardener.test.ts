import type { Account, AccountId, AgentId, IAccountsService, IJobsService, Job, JobId, JobSpec, Result, TrustLevel } from '@orch/contracts';
import { describe, expect, it, vi } from 'vitest';
import { FakeClock } from '../../test/clock.js';
import type { ITrustLevelStore } from '../../common/ports.js';
import { GardenerService, type GardenerDeps, type GardenerTimers } from '../node/gardener.js';

const GOAL = 'test goal';
const REPO = '/repo';
const ZONE = 'Europe/London';
// Sunday 2026-10-11 12:00 BST (11:00Z). The next run is Monday 2026-10-12 09:00 BST (08:00Z).
const NOW = '2026-10-11T11:00:00Z';
const NEXT = '2026-10-12T08:00:00.000Z';

function account(id: string, overrides: Partial<Account> = {}): Account {
  return {
    id: id as AccountId,
    agent: id.split('-')[0] as AgentId,
    name: id,
    primary: true,
    use: true,
    state: 'available',
    profileDir: `/profiles/${id}`,
    skillsShared: false,
    ...overrides,
  };
}

class FakeTimers implements GardenerTimers {
  pending: { callback: () => void; delayMs: number; handle: number } | null = null;
  private next = 1;
  set = vi.fn((callback: () => void, delayMs: number): unknown => {
    const handle = this.next++;
    this.pending = { callback, delayMs, handle };
    return handle;
  });
  clear = vi.fn((handle: unknown): void => {
    if (this.pending?.handle === handle) this.pending = null;
  });
}

function setup(options: { accounts?: Account[]; levels?: Partial<Record<AgentId, TrustLevel>>; accountsError?: boolean; startResult?: Result<Job> } = {}) {
  const clock = new FakeClock(new Date(NOW));
  const accounts = options.accounts ?? [account('claude-main'), account('codex-team')];
  const levelMap = options.levels ?? {};
  const started: JobSpec[] = [];
  const accountsService: Pick<IAccountsService, 'list'> = {
    list: async () =>
      options.accountsError
        ? { ok: false, error: { code: 'internal', message: 'x', fix: 'y' } }
        : { ok: true, value: accounts },
  };
  const jobs: Pick<IJobsService, 'start'> = {
    start: async (spec: JobSpec) => {
      started.push(spec);
      return options.startResult ?? { ok: true, value: { id: 'j-1' as JobId, title: 't', spec, status: 'scheduled', step: null, createdAt: NOW as Job['createdAt'], scheduledFor: null } };
    },
  };
  const levels: Pick<ITrustLevelStore, 'levelOf'> = { levelOf: (agent) => levelMap[agent] };
  const timers = new FakeTimers();
  const deps: GardenerDeps = { accounts: accountsService, levels, jobs, goal: GOAL, repoPath: REPO, clock: clock.now, timeZone: () => ZONE };
  const gardener = new GardenerService(deps, timers);
  return { gardener, clock, timers, started };
}

describe('GardenerService state (TRU-04)', () => {
  it('is on by default and reports the next Monday 09:00 local run', () => {
    const { gardener } = setup();
    expect(gardener.state()).toEqual({ on: true, nextRunAt: NEXT, findings: [] });
  });

  it('off has no next run', () => {
    const { gardener } = setup();
    gardener.setOn(false);
    expect(gardener.state()).toEqual({ on: false, nextRunAt: null, findings: [] });
  });
});

describe('GardenerService job creation', () => {
  it('starts a single-mode job on the primary account of the highest-level agent', async () => {
    const { gardener, started } = setup({ levels: { codex: 2 } });
    const result = await gardener.runNow();
    expect(result.ok).toBe(true);
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      mode: 'single',
      goal: GOAL,
      repoPath: REPO,
      orchestrator: { agent: 'codex', account: 'codex-team' },
      workers: ['codex'],
      checks: [],
      onLimit: 'switch-account',
    });
  });

  it('returns the job the jobs service created, so it arrives as a normal job', async () => {
    const { gardener } = setup();
    const result = await gardener.runNow();
    expect(result.ok && result.value?.id).toBe('j-1');
  });

  it('skips the week with no job when no agent has a usable primary account', async () => {
    const { gardener, started } = setup({ accounts: [account('claude-main', { state: 'signed_out' })] });
    expect(await gardener.runNow()).toEqual({ ok: true, value: null });
    expect(started).toHaveLength(0);
  });

  it('does nothing while off', async () => {
    const { gardener, started } = setup();
    gardener.setOn(false);
    expect(await gardener.runNow()).toEqual({ ok: true, value: null });
    expect(started).toHaveLength(0);
  });

  it('passes on an accounts error without starting a job', async () => {
    const { gardener, started } = setup({ accountsError: true });
    const result = await gardener.runNow();
    expect(result.ok).toBe(false);
    expect(started).toHaveLength(0);
  });

  it('passes on a jobs-service error', async () => {
    const error = { code: 'account_limited' as const, message: 'm', fix: 'f' };
    const { gardener } = setup({ startResult: { ok: false, error } });
    expect(await gardener.runNow()).toEqual({ ok: false, error });
  });
});

describe('GardenerService scheduler', () => {
  it('start arms one timer for the delay until the next Monday 09:00', () => {
    const { gardener, timers } = setup();
    gardener.start();
    expect(timers.set).toHaveBeenCalledTimes(1);
    expect(timers.pending?.delayMs).toBe(Date.parse(NEXT) - Date.parse(NOW));
  });

  it('when the timer fires on time it runs the job and arms the next week', async () => {
    const { gardener, timers, clock, started } = setup();
    gardener.start();
    clock.set(NEXT);
    timers.pending?.callback();
    await vi.waitFor(() => expect(started).toHaveLength(1));
    expect(timers.pending?.delayMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('a timer that fires early re-arms without running', () => {
    const { gardener, timers, clock, started } = setup();
    gardener.start();
    clock.set('2026-10-12T07:00:00Z');
    timers.pending?.callback();
    expect(started).toHaveLength(0);
    expect(timers.pending?.delayMs).toBe(Date.parse(NEXT) - Date.parse('2026-10-12T07:00:00Z'));
  });

  it('turning off clears the timer; turning on arms it again', () => {
    const { gardener, timers } = setup();
    gardener.start();
    gardener.setOn(false);
    expect(timers.pending).toBeNull();
    gardener.setOn(true);
    expect(timers.pending).not.toBeNull();
  });

  it('stop clears the timer', () => {
    const { gardener, timers } = setup();
    gardener.start();
    gardener.stop();
    expect(timers.pending).toBeNull();
  });
});
