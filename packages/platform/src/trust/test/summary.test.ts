import { describe, expect, it } from 'vitest';
import type { AgentId, CorrectionLayer, Timestamp, TrustLevel } from '@orch/contracts';
import { computeTrustSummary, correctionsByLayer, movedUpLayer, type TrustSummaryInput } from '../common/summary.js';
import { TrustSummary as TrustSummarySchema } from '@orch/contracts';
import { ListTrustAgents, MemoryGardener, correction } from './fakes.js';
import { allAgents, NOW } from './fixtures.js';
import { daysAgo } from './clock.js';

const levels = new Map<AgentId, TrustLevel>([['claude', 2], ['codex', 2]]);

function summary(over: Partial<TrustSummaryInput> = {}) {
  return computeTrustSummary({
    periodDays: 30,
    now: NOW,
    agents: new ListTrustAgents().list(),
    levels,
    runs: allAgents(),
    corrections: [],
    gardener: { on: true, nextRunAt: '2026-10-12T09:00:00.000Z', findings: [] },
    ...over,
  });
}

describe('the summary numbers over a fixture history', () => {
  it('the 30-day cards come from every agent in the window', () => {
    const result = summary();
    // 71 runs in 30 days, 52 of them verified on the first try, 1 of them a human fix, 2 refuted.
    expect(result.firstTryVerifiedPct).toBe(73);
    expect(result.humanFixPct).toBe(1);
    expect(result.refutedCount).toBe(2);
    expect(result.periodDays).toBe(30);
  });

  it('the 7-day cards only count the runs finished inside seven days', () => {
    const result = summary({ periodDays: 7 });
    // 33 runs finished in the 7 days up to now (a run exactly 7 days old counts, as at 30 days),
    // 14 of them verified on the first try, and 2 refuted (both of Claude Code's last two runs).
    expect(result.firstTryVerifiedPct).toBe(42);
    expect(result.refutedCount).toBe(2);
  });

  it('the summary validates against the contract', () => {
    expect(TrustSummarySchema.safeParse(summary()).success).toBe(true);
    expect(TrustSummarySchema.safeParse(summary({ periodDays: 7 })).success).toBe(true);
  });

  it('a period with no runs shows zeros, not a division by zero', () => {
    const result = summary({ periodDays: 7, runs: [] });
    expect(result.firstTryVerifiedPct).toBe(0);
    expect(result.humanFixPct).toBe(0);
    expect(result.refutedCount).toBe(0);
  });
});

describe('the agents in the summary', () => {
  it('lists every agent in the order the screen lists them', () => {
    expect(summary().agents.map((agent) => agent.agent)).toEqual(['claude', 'codex', 'agy', 'gemini', 'opencode']);
  });

  it('an agent with no row on record starts at level 1 (TRU-02)', () => {
    const byAgent = new Map(summary().agents.map((agent) => [agent.agent, agent]));
    expect(byAgent.get('claude')?.level).toBe(2);
    expect(byAgent.get('codex')?.level).toBe(2);
    expect(byAgent.get('gemini')?.level).toBe(1);
    expect(byAgent.get('opencode')?.level).toBe(1);
  });

  it('each track record keeps its own numbers, from the 30-day window (TRU-01)', () => {
    const byAgent = new Map(summary().agents.map((agent) => [agent.agent, agent]));
    expect(byAgent.get('claude')).toEqual({
      agent: 'claude',
      runs: 20,
      firstTryVerifiedPct: 70,
      humanFixPct: 5,
      level: 2,
      eligibleFor: null,
    });
    expect(byAgent.get('codex')).toEqual({
      agent: 'codex',
      runs: 20,
      firstTryVerifiedPct: 85,
      humanFixPct: 0,
      level: 2,
      eligibleFor: 3,
    });
    // The 31-day-old run is outside the window, so 20 runs and 80% remain.
    expect(byAgent.get('gemini')?.runs).toBe(20);
    expect(byAgent.get('gemini')?.firstTryVerifiedPct).toBe(80);
    // One run is not enough to be eligible, however good it was.
    expect(byAgent.get('opencode')?.eligibleFor).toBeNull();
  });

  it('the tracks do not move when the period toggle does', () => {
    const thirty = summary().agents;
    const seven = summary({ periodDays: 7 }).agents;
    expect(seven).toEqual(thirty);
  });
});

describe('corrections (REV-06)', () => {
  const corrections = [
    correction('codebase', daysAgo(2, NOW)),
    correction('codebase', daysAgo(3, NOW)),
    correction('lint', daysAgo(4, NOW)),
    correction('agent_rule', daysAgo(5, NOW)),
    correction('review_note', daysAgo(5, NOW)),
    correction('review_note', daysAgo(20, NOW)),
  ];

  it('counts every layer, with the layers that have none still present', () => {
    expect(correctionsByLayer(corrections)).toEqual({ codebase: 2, lint: 1, agent_rule: 1, review_note: 2 });
  });

  it('counts a correction that moved up a layer as codebase or lint', () => {
    expect(movedUpLayer('codebase')).toBe(true);
    expect(movedUpLayer('lint')).toBe(true);
    expect(movedUpLayer('agent_rule')).toBe(false);
    expect(movedUpLayer('review_note')).toBe(false);
  });

  it('reports the moved-up pair over the period', () => {
    const result = summary({ corrections });
    expect(result.correctionsMovedUp).toEqual({ moved: 3, total: 6 });
    expect(result.correctionsByLayer).toEqual({ codebase: 2, lint: 1, agent_rule: 1, review_note: 2 });
  });

  it('only counts corrections inside the period', () => {
    const result = summary({ periodDays: 7, corrections });
    // The 20-day-old review note is outside a 7-day window.
    expect(result.correctionsMovedUp).toEqual({ moved: 3, total: 5 });
    expect(result.correctionsByLayer).toEqual({ codebase: 2, lint: 1, agent_rule: 1, review_note: 1 });
  });
});

describe('the gardener card', () => {
  it('passes the gardener state through', () => {
    const gardener = { on: true, nextRunAt: '2026-10-12T09:00:00.000Z', findings: [{ text: 'A finding', at: daysAgo(1, NOW) }] };
    expect(summary({ gardener }).gardener).toEqual(gardener);
  });

  it('a gardener that is off has no next run', () => {
    const gardener = { on: false, nextRunAt: null, findings: [] };
    expect(summary({ gardener }).gardener).toEqual(gardener);
  });
});

describe('an empty summary', () => {
  it('works with no agents, no runs and no corrections', () => {
    const result = summary({ agents: [], runs: [], corrections: [] });
    expect(result).toEqual({
      periodDays: 30,
      firstTryVerifiedPct: 0,
      humanFixPct: 0,
      refutedCount: 0,
      correctionsMovedUp: { moved: 0, total: 0 },
      correctionsByLayer: { codebase: 0, lint: 0, agent_rule: 0, review_note: 0 },
      agents: [],
      gardener: { on: true, nextRunAt: '2026-10-12T09:00:00.000Z', findings: [] },
    });
  });
});

describe('the gardener port is not involved in the numbers', () => {
  it('a fake gardener with findings off does not change the percentages', () => {
    const withFindings = summary({ gardener: new MemoryGardener().state() });
    expect(withFindings.firstTryVerifiedPct).toBe(73);
    expect(withFindings.gardener.findings).toEqual([]);
  });
});

/** Every layer key the contract allows, so the record stays complete when a layer is added. */
const LAYERS: readonly CorrectionLayer[] = ['codebase', 'lint', 'agent_rule', 'review_note'];
const TIMESTAMP: Timestamp = '2026-10-11T12:00:00.000Z';

describe('correctionsByLayer', () => {
  it('returns every layer, even the ones with no corrections', () => {
    expect(Object.keys(correctionsByLayer([])).sort()).toEqual([...LAYERS].sort());
    expect(correctionsByLayer([{ layer: 'lint', createdAt: TIMESTAMP }])).toEqual({
      codebase: 0,
      lint: 1,
      agent_rule: 0,
      review_note: 0,
    });
  });
});
