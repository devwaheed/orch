import { describe, expect, it } from 'vitest';
import type { AgentTrack, AgentId, CorrectionLayer, TrustSummary } from '@orchagents/contracts';
import { TrustSummary as TrustSummarySchema } from '@orchagents/contracts';
import {
  findingDay,
  gardenerView,
  layerRows,
  ladderRows,
  promotionTarget,
  statCards,
  trackNotice,
} from '../src/browser/contrib/trust/trustView.js';
import { account, agent as agentInfo } from './accounts/fixtures.js';

function track(overrides: Partial<AgentTrack> & { agent: AgentId }): AgentTrack {
  return { runs: 30, firstTryVerifiedPct: 90, humanFixPct: 5, level: 1, eligibleFor: null, ...overrides };
}

function summary(agents: AgentTrack[], extra: Partial<TrustSummary> = {}): TrustSummary {
  return {
    periodDays: 30,
    firstTryVerifiedPct: 72,
    humanFixPct: 18,
    refutedCount: 9,
    correctionsMovedUp: { moved: 11, total: 14 },
    correctionsByLayer: { codebase: 3, lint: 8, agent_rule: 1, review_note: 2 },
    agents,
    gardener: { on: true, nextRunAt: '2026-10-12T09:00:00Z', findings: [] },
    ...extra,
  };
}

describe('trust view-model: stat cards', () => {
  it('shows the four stat cards with the summary numbers and the prototype copy', () => {
    const cards = statCards(summary([]));
    expect(cards.map((card) => [card.label, card.value, card.note])).toEqual([
      ['Verified on the first try', '72%', 'checks passed without a repair round'],
      ['Needed a human fix', '18%', 'you requested changes before merging'],
      ['Refuted by checks', '9', 'agent said done, checks said no'],
      ['Corrections moved up a layer', '11 of 14', 'turned into code or lint, not just notes'],
    ]);
  });
});

describe('trust view-model: ladder states (TRU-01, TRU-02)', () => {
  it('says "Not enough runs yet" below 20 runs and never offers promotion', () => {
    const row = trackNotice(track({ agent: 'claude', runs: 19, firstTryVerifiedPct: 95 }));
    expect(row).toBe('Not enough runs yet');
    expect(promotionTarget(track({ agent: 'claude', runs: 19, eligibleFor: 2 }))).toBeNull();
  });

  it('counts exactly 20 runs as enough', () => {
    expect(trackNotice(track({ agent: 'claude', runs: 20, firstTryVerifiedPct: 75, level: 1 }))).toBeNull();
  });

  it('says "Below threshold" when a level-2 agent drops 10 points under 70 %', () => {
    expect(trackNotice(track({ agent: 'codex', level: 2, firstTryVerifiedPct: 60 }))).toBe('Below threshold');
    expect(trackNotice(track({ agent: 'codex', level: 2, firstTryVerifiedPct: 61 }))).toBeNull();
  });

  it('says "Below threshold" when a level-3 agent drops 10 points under 85 %', () => {
    expect(trackNotice(track({ agent: 'claude', level: 3, firstTryVerifiedPct: 75 }))).toBe('Below threshold');
    expect(trackNotice(track({ agent: 'claude', level: 3, firstTryVerifiedPct: 76 }))).toBeNull();
  });

  it('never says "Below threshold" for a level-1 agent', () => {
    expect(trackNotice(track({ agent: 'agy', level: 1, firstTryVerifiedPct: 0 }))).toBeNull();
  });

  it('marks the current step, the passed steps, the promote step and the locked steps', () => {
    const [row] = ladderRows(
      summary([track({ agent: 'claude', level: 2, firstTryVerifiedPct: 88, eligibleFor: 3 })]),
    );
    expect(row?.steps).toEqual([
      { kind: 'done' },
      { kind: 'current' },
      { kind: 'promote', level: 3 },
    ]);
    expect(row?.notice).toBeNull();
  });

  it('shows locked steps with the threshold they need', () => {
    const [row] = ladderRows(summary([track({ agent: 'opencode', level: 1, firstTryVerifiedPct: 66, eligibleFor: null })]));
    expect(row?.steps).toEqual([
      { kind: 'current' },
      { kind: 'locked', need: 'needs 70%' },
      { kind: 'locked', need: 'needs 85%' },
    ]);
    expect(row?.rateTone).toBe('warn');
  });

  it('lists the agents in the order the summary gives, with names and badges', () => {
    const rows = ladderRows(summary([track({ agent: 'claude' }), track({ agent: 'agy', level: 1 })]));
    expect(rows.map((row) => [row.name, row.mono])).toEqual([
      ['Claude Code', 'CC'],
      ['Antigravity', 'AG'],
    ]);
  });
});

describe('trust view-model: promote availability (TRU-02, manual only)', () => {
  it('offers the next step only when the contract says the agent qualifies', () => {
    expect(promotionTarget(track({ agent: 'claude', level: 1, eligibleFor: 2 }))).toBe(2);
    expect(promotionTarget(track({ agent: 'claude', level: 1, eligibleFor: null }))).toBeNull();
  });

  it('never offers a step more than one above the current level', () => {
    expect(promotionTarget(track({ agent: 'claude', level: 1, eligibleFor: 3 }))).toBeNull();
  });

  it('never offers anything at the top of the ladder', () => {
    expect(promotionTarget(track({ agent: 'claude', level: 3, eligibleFor: null }))).toBeNull();
  });

  it('withholds promotion while the notice says "Below threshold"', () => {
    expect(promotionTarget(track({ agent: 'claude', level: 2, firstTryVerifiedPct: 60, eligibleFor: 3 }))).toBeNull();
  });
});

describe('trust view-model: corrections by layer', () => {
  it('keeps the four layers in order and scales bars to the largest', () => {
    const rows = layerRows(summary([]));
    expect(rows.map((row) => [row.label, row.count, row.width])).toEqual([
      ['1 · Codebase', 3, 38],
      ['2 · Lint or CI rule', 8, 100],
      ['3 · Agent rule', 1, 13],
      ['4 · Review note', 2, 25],
    ]);
  });

  it('shows empty bars when there are no corrections', () => {
    const rows = layerRows(summary([], { correctionsByLayer: { codebase: 0, lint: 0, agent_rule: 0, review_note: 0 } }));
    expect(rows.every((row) => row.width === 0)).toBe(true);
  });

  it('fills in a layer that the summary does not list', () => {
    const partial = { codebase: 1 } as Partial<Record<CorrectionLayer, number>> as Record<CorrectionLayer, number>;
    const rows = layerRows(summary([], { correctionsByLayer: partial }));
    expect(rows.map((row) => row.count)).toEqual([1, 0, 0, 0]);
  });
});

describe('trust view-model: gardener card', () => {
  it('shows the schedule on the highest-level agent primary, and "Off" while off', () => {
    const accounts = [
      account('claude-personal', 'claude', { name: 'Personal', primary: true }),
      account('codex-team', 'codex', { name: 'Team', primary: true }),
    ];
    const agents = [agentInfo('claude', 'parallel'), agentInfo('codex', 'parallel')];
    const tracks = [track({ agent: 'claude', level: 2 }), track({ agent: 'codex', level: 3 })];
    expect(gardenerView(summary(tracks), accounts, agents).when).toBe('Runs every Monday at 09:00 on Codex · Team');
    expect(gardenerView(summary([], { gardener: { on: false, nextRunAt: null, findings: [] } })).when).toBe('Off');
  });

  it('lists recent findings with their day', () => {
    const view = gardenerView(
      summary([], {
        gardener: { on: true, nextRunAt: null, findings: [{ text: 'A workaround was copied.', at: '2026-10-06T09:00:00Z' }] },
      }),
    );
    expect(view.findings).toEqual([{ text: 'A workaround was copied.', when: 'Oct 6' }]);
  });

  it('formats a finding day in UTC by default', () => {
    expect(findingDay('2026-10-06T23:30:00Z')).toBe('Oct 6');
  });
});

describe('trust view-model: the summary the view-model reads is a valid contract', () => {
  it('accepts the sample shape', () => {
    expect(TrustSummarySchema.safeParse(summary([track({ agent: 'claude' })])).success).toBe(true);
  });
});
