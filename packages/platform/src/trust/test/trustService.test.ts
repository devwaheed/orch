import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentId, OrchError, Result, TrustLevel } from '@orch/contracts';
import { StoreService } from '../../store/node/storeService.js';
import { trustLevelTable } from '../../store/common/schema.js';
import { StoreTrustLevelStore } from '../node/trustLevelStore.js';
import { TrustService } from '../node/trustService.js';
import {
  ListTrustAgents,
  MemoryCorrections,
  MemoryGardener,
  MemoryRunHistory,
  MemoryTrustLevelStore,
} from './fakes.js';
import { allAgents, claudeAtThreshold, claudeJustUnder, claudeTooFewRuns, NOW } from './fixtures.js';
import { FakeClock } from './clock.js';

const T0 = NOW.toISOString();

interface Harness {
  readonly service: TrustService;
  readonly runs: MemoryRunHistory;
  readonly levels: MemoryTrustLevelStore;
  readonly gardener: MemoryGardener;
  readonly clock: FakeClock;
}

function setup(runs: ReturnType<typeof allAgents> = allAgents()): Harness {
  const clock = new FakeClock(NOW);
  const history = new MemoryRunHistory(runs);
  const levels = new MemoryTrustLevelStore();
  const gardener = new MemoryGardener();
  const service = new TrustService({
    agents: new ListTrustAgents(),
    runs: history,
    corrections: new MemoryCorrections(),
    levels,
    gardener,
    now: clock.now,
  });
  return { service, runs: history, levels, gardener, clock };
}

async function must<T>(result: Promise<Result<T>>): Promise<T> {
  const settled = await result;
  if (!settled.ok) {
    throw new Error(`expected success, got ${JSON.stringify(settled.error)}`);
  }
  return settled.value;
}

function failure(result: Result<unknown>): OrchError {
  if (result.ok) {
    throw new Error('expected a failure');
  }
  return result.error;
}

describe('summary', () => {
  it('returns the numbers computed from the run history', async () => {
    const { service } = setup();
    const summary = await must(service.summary(30));
    expect(summary.periodDays).toBe(30);
    expect(summary.firstTryVerifiedPct).toBe(73);
    expect(summary.humanFixPct).toBe(1);
    expect(summary.refutedCount).toBe(2);
    expect(summary.agents).toHaveLength(5);
  });

  it('answers the 7-day period too', async () => {
    const { service } = setup();
    const summary = await must(service.summary(7));
    expect(summary.periodDays).toBe(7);
    expect(summary.firstTryVerifiedPct).toBe(42);
  });

  it('reports the level on record, and level 1 for an agent with no row', async () => {
    const { service, levels } = setup();
    levels.putLevel('claude', 2, T0);
    const summary = await must(service.summary(30));
    const claude = summary.agents.find((agent) => agent.agent === 'claude');
    expect(claude?.level).toBe(2);
    expect(summary.agents.find((agent) => agent.agent === 'gemini')?.level).toBe(1);
  });

  it('passes the gardener state through', async () => {
    const { service, gardener } = setup();
    gardener.set({ on: false, nextRunAt: null, findings: [{ text: 'A finding', at: T0 }] });
    const summary = await must(service.summary(30));
    expect(summary.gardener).toEqual({ on: false, nextRunAt: null, findings: [{ text: 'A finding', at: T0 }] });
  });
});

describe('promote (TRU-01, TRU-02)', () => {
  it('promotes an agent that meets the next threshold and records the level', async () => {
    const { service, levels } = setup(claudeAtThreshold());
    const result = await service.promote('claude', 2);
    expect(result).toEqual({ ok: true, value: undefined });
    expect(levels.levelOf('claude')).toBe(2);
    expect(levels.changedAtOf('claude')).toBe(T0);
  });

  it('promotes to level 3 when the agent meets 85%', async () => {
    const { service, levels } = setup();
    levels.putLevel('codex', 2, T0);
    expect(await service.promote('codex', 3)).toEqual({ ok: true, value: undefined });
    expect(levels.levelOf('codex')).toBe(3);
  });

  it('refuses an agent with fewer than 20 runs, however good the rate', async () => {
    const { service, levels } = setup(claudeTooFewRuns());
    const error = failure(await service.promote('claude', 2));
    expect(error.code).toBe('conflict');
    expect(error.message).toContain('Not enough runs yet');
    expect(error.fix).toBeTruthy();
    expect(levels.levelOf('claude')).toBeUndefined();
  });

  it('refuses an agent whose rate is under the threshold', async () => {
    const { service, levels } = setup(claudeJustUnder());
    const error = failure(await service.promote('claude', 2));
    expect(error.code).toBe('conflict');
    expect(error.message).toContain('Below threshold');
    expect(error.message).toContain('65%');
    expect(error.message).toContain('70%');
    expect(levels.levelOf('claude')).toBeUndefined();
  });

  it('refuses to skip a level', async () => {
    const { service, levels } = setup();
    const error = failure(await service.promote('claude', 3));
    expect(error.code).toBe('conflict');
    expect(error.message).toContain('is at level 1');
    expect(levels.levelOf('claude')).toBeUndefined();
  });

  it('refuses to promote an agent to the level it is already at', async () => {
    const { service, levels } = setup(claudeAtThreshold());
    levels.putLevel('claude', 2, T0);
    const error = failure(await service.promote('claude', 2));
    expect(error.code).toBe('conflict');
    expect(levels.levelOf('claude')).toBe(2);
  });

  it('never demotes: there is no way to write a lower level', async () => {
    const { service, levels } = setup();
    levels.putLevel('claude', 3, T0);
    expect((await service.promote('claude', 2)).ok).toBe(false);
    expect((await service.promote('claude', 1)).ok).toBe(false);
    expect(levels.levelOf('claude')).toBe(3);
  });

  it('rejects an agent or a level orch does not know', async () => {
    const { service } = setup();
    const bad = await service.promote('notanagent' as AgentId, 2 as TrustLevel);
    expect(failure(bad).code).toBe('validation_failed');
    expect(failure(await service.promote('claude', 9 as TrustLevel)).code).toBe('validation_failed');
  });

  it('names the agent in the error', async () => {
    const { service } = setup(claudeJustUnder());
    expect(failure(await service.promote('claude', 2)).message).toContain('Claude Code');
  });

  it('moves the clock with the injected time', async () => {
    const { service, levels, clock } = setup(claudeAtThreshold());
    clock.set('2026-11-11T12:00:00.000Z');
    // Every fixture run is now outside the 30-day window.
    const error = failure(await service.promote('claude', 2));
    expect(error.message).toContain('Not enough runs yet');
    expect(levels.levelOf('claude')).toBeUndefined();
  });
});

describe('setGardener', () => {
  it('switches the gardener on and off', async () => {
    const { service, gardener } = setup();
    expect(await service.setGardener(false)).toEqual({ ok: true, value: undefined });
    expect(gardener.state().on).toBe(false);
    expect(await service.setGardener(true)).toEqual({ ok: true, value: undefined });
    expect(gardener.state().on).toBe(true);
  });
});

describe('the trust_level table', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'orch-trust-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stores a level, reads it back, and keeps one row per agent', async () => {
    const store = new StoreService();
    try {
      const opened = await store.open({ dbPath: join(root, 'orch.db'), backupDir: join(root, 'backups') });
      expect(opened.ok).toBe(true);
      const levels = new StoreTrustLevelStore(store);

      expect(levels.levelOf('claude')).toBeUndefined();
      levels.putLevel('claude', 1, '2026-10-01T09:00:00.000Z');
      levels.putLevel('claude', 2, '2026-10-11T09:00:00.000Z');
      levels.putLevel('codex', 3, '2026-10-11T09:00:00.000Z');

      expect(levels.levelOf('claude')).toBe(2);
      expect(levels.levelOf('codex')).toBe(3);
      expect(levels.levelOf('gemini')).toBeUndefined();

      const rows = await store.db.select().from(trustLevelTable);
      expect(rows).toHaveLength(2);
    } finally {
      store.close();
    }
  });
});
