import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentId, OrchError, Result, TrustLevel, TrustSummary } from '@orch/contracts';
import {
  loadSummary,
  promoteAgent,
  selectPeriod,
  setGardenerOn,
  type TrustPort,
} from '../src/browser/contrib/trust/actions.js';
import { useTrustUiStore, type TrustPeriod } from '../src/browser/contrib/trust/stores/trustUi.js';

function sampleSummary(periodDays: 7 | 30): TrustSummary {
  return {
    periodDays,
    firstTryVerifiedPct: 0,
    humanFixPct: 0,
    refutedCount: 0,
    correctionsMovedUp: { moved: 0, total: 0 },
    correctionsByLayer: { codebase: 0, lint: 0, agent_rule: 0, review_note: 0 },
    agents: [],
    gardener: { on: true, nextRunAt: '2026-10-12T09:00:00Z', findings: [] },
  };
}

const NOT_ENOUGH: OrchError = {
  code: 'conflict',
  message: 'Not enough runs yet: Claude Code has 3 runs in the last 30 days, and 20 runs are needed.',
  fix: 'Run more jobs with Claude Code, then promote it again.',
};

interface FakePort extends TrustPort {
  readonly summaryCalls: TrustPeriod[];
  readonly promoteCalls: [AgentId, TrustLevel][];
  readonly gardenerCalls: boolean[];
  promoteResult: Result<void>;
}

function fakePort(): FakePort {
  const port: FakePort = {
    summaryCalls: [],
    promoteCalls: [],
    gardenerCalls: [],
    promoteResult: { ok: true, value: undefined },
    async summary(periodDays) {
      port.summaryCalls.push(periodDays);
      return { ok: true, value: sampleSummary(periodDays) };
    },
    async promote(agent, level) {
      port.promoteCalls.push([agent, level]);
      return port.promoteResult;
    },
    async setGardener(on) {
      port.gardenerCalls.push(on);
      return { ok: true, value: undefined };
    },
  };
  return port;
}

beforeEach(() => {
  useTrustUiStore.setState({ period: 30, summary: null, loadError: null, promoteError: null, promotingAgent: null });
});

describe('trust actions: period switching', () => {
  it('starts on 30 days', () => {
    expect(useTrustUiStore.getState().period).toBe(30);
  });

  it('switches to 7 days and loads that period', async () => {
    const port = fakePort();
    await selectPeriod(port, 7);
    expect(useTrustUiStore.getState().period).toBe(7);
    expect(port.summaryCalls).toEqual([7]);
    expect(useTrustUiStore.getState().summary?.periodDays).toBe(7);
  });

  it('drops a late reply for a period the user has since left', async () => {
    const port = fakePort();
    let release30!: (result: Result<TrustSummary>) => void;
    port.summary = (periodDays) =>
      periodDays === 30
        ? new Promise<Result<TrustSummary>>((resolve) => {
            release30 = resolve;
          })
        : Promise.resolve({ ok: true, value: sampleSummary(periodDays) });

    const pending = loadSummary(port, 30);
    await selectPeriod(port, 7);
    release30({ ok: true, value: sampleSummary(30) });
    await pending;

    expect(useTrustUiStore.getState().period).toBe(7);
    expect(useTrustUiStore.getState().summary?.periodDays).toBe(7);
  });

  it('keeps the error when the summary cannot be loaded', async () => {
    const port = fakePort();
    port.summary = async () => ({ ok: false, error: { code: 'internal', message: 'orch could not add up the trust numbers.', fix: 'Try again.' } });
    await loadSummary(port, 30);
    expect(useTrustUiStore.getState().loadError?.message).toBe('orch could not add up the trust numbers.');
    expect(useTrustUiStore.getState().summary).toBeNull();
  });
});

describe('trust actions: promotion is manual (TRU-02)', () => {
  it('calls promote with the agent and the next level, then reloads', async () => {
    const port = fakePort();
    await promoteAgent(port, 'claude', 2);
    expect(port.promoteCalls).toEqual([['claude', 2]]);
    expect(port.summaryCalls).toEqual([30]);
    expect(useTrustUiStore.getState().promotingAgent).toBeNull();
    expect(useTrustUiStore.getState().promoteError).toBeNull();
  });

  it('shows the core refusal word for word and does not change the level', async () => {
    const port = fakePort();
    port.promoteResult = { ok: false, error: NOT_ENOUGH };
    await promoteAgent(port, 'claude', 2);
    expect(useTrustUiStore.getState().promoteError).toEqual(NOT_ENOUGH);
    expect(useTrustUiStore.getState().promotingAgent).toBeNull();
  });

  it('clears an earlier refusal on the next attempt', async () => {
    const port = fakePort();
    useTrustUiStore.setState({ promoteError: NOT_ENOUGH });
    await promoteAgent(port, 'codex', 2);
    expect(useTrustUiStore.getState().promoteError).toBeNull();
  });
});

describe('trust actions: gardener switch (TRU-04)', () => {
  it('sends the new state to the core and reloads the card', async () => {
    const port = fakePort();
    await setGardenerOn(port, false);
    expect(port.gardenerCalls).toEqual([false]);
    expect(port.summaryCalls).toEqual([30]);
  });
});
