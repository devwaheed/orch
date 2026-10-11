import { describe, expect, it } from 'vitest';
import type { AgentId, AgentTrack, TrustLevel } from '@orch/contracts';
import { BELOW_THRESHOLD_MARGIN, MIN_RUNS, START_LEVEL, TRUST_WINDOW_DAYS } from '../common/constants.js';
import { BELOW_THRESHOLD, NOT_ENOUGH_RUNS } from '../common/copy.js';
import {
  computeAgentTrack,
  hasTooFewRuns,
  inWindow,
  isBelowThreshold,
  isFirstTryVerified,
  nextLevel,
  percentOf,
  qualifiesForLevel,
  trackNotice,
} from '../common/track.js';
import {
  claudeAtThreshold,
  claudeAtBelowMargin,
  claudeBelowThreshold,
  claudeJustUnder,
  claudeTooFewRuns,
  codexLevelThreeReady,
  geminiOneRunTooOld,
  history,
  NOW,
  run,
  type Outcome,
} from './fixtures.js';
import { daysAgo } from './clock.js';

/** The agent is the first run's agent unless the caller names one, so fixtures need no repeating. */
function track(runs: ReturnType<typeof history>, level: TrustLevel = START_LEVEL, agent?: AgentId): AgentTrack {
  return computeAgentTrack({ agent: agent ?? runs[0]?.agent ?? 'claude', level, runs, now: NOW });
}

describe('TRU-01 first-try verified', () => {
  it.each<{ name: string; outcome: Outcome; want: boolean }>([
    { name: 'verified on attempt 1 with no request changes', outcome: 'first', want: true },
    { name: 'verified on attempt 1 but a human asked for changes', outcome: 'human', want: false },
    { name: 'verified on attempt 2', outcome: 'retry', want: false },
    { name: 'refuted', outcome: 'refuted', want: false },
    { name: 'not verified yet', outcome: 'open', want: false },
  ])('$name', ({ outcome, want }) => {
    const [record] = history('claude', [outcome]);
    if (record === undefined) {
      throw new Error('fixture made no run');
    }
    expect(isFirstTryVerified(record)).toBe(want);
  });
});

describe('the 30-day window (TRU-01)', () => {
  it('a run 30 days old counts, a run 31 days old does not', () => {
    expect(inWindow(daysAgo(30, NOW), NOW, TRUST_WINDOW_DAYS)).toBe(true);
    expect(inWindow(daysAgo(31, NOW), NOW, TRUST_WINDOW_DAYS)).toBe(false);
  });

  it('a run finished in the future is outside the window', () => {
    expect(inWindow(daysAgo(-1, NOW), NOW, TRUST_WINDOW_DAYS)).toBe(false);
  });

  it('counts only the 20 runs inside the window', () => {
    const result = track(geminiOneRunTooOld());
    expect(result.runs).toBe(20);
    expect(result.firstTryVerifiedPct).toBe(80);
  });
});

describe('track numbers from fixture histories', () => {
  it.each<{ name: string; runs: ReturnType<typeof history>; want: Pick<AgentTrack, 'runs' | 'firstTryVerifiedPct' | 'humanFixPct'> }>([
    {
      name: '20 runs with 14 first-try verified: 70% first-try, 5% human fix',
      runs: claudeAtThreshold(),
      want: { runs: 20, firstTryVerifiedPct: 70, humanFixPct: 5 },
    },
    {
      name: '19 runs with 18 first-try verified: 95% first-try',
      runs: claudeTooFewRuns(),
      want: { runs: 19, firstTryVerifiedPct: 95, humanFixPct: 0 },
    },
    {
      name: '20 runs with 13 first-try verified: 65%',
      runs: claudeJustUnder(),
      want: { runs: 20, firstTryVerifiedPct: 65, humanFixPct: 0 },
    },
    {
      name: '20 runs with 17 first-try verified: 85%',
      runs: codexLevelThreeReady(),
      want: { runs: 20, firstTryVerifiedPct: 85, humanFixPct: 0 },
    },
    {
      name: 'an agent with no history has no runs and no rate',
      runs: [],
      want: { runs: 0, firstTryVerifiedPct: 0, humanFixPct: 0 },
    },
  ])('$name', ({ runs, want }) => {
    expect(track(runs)).toMatchObject(want);
  });

  it('rounds the rate to a whole percent', () => {
    // 2 of 3 runs verified on the first try is 66.66%.
    expect(percentOf(history('claude', ['first', 'first', 'retry']), isFirstTryVerified)).toBe(67);
  });

  it('a run from another agent is not counted', () => {
    const records = [...history('claude', ['first']), run('codex', 'first', daysAgo(1, NOW))];
    expect(track(records).runs).toBe(1);
  });
});

describe('eligibleFor (TRU-02)', () => {
  it.each<{ name: string; runs: ReturnType<typeof history>; level: TrustLevel; want: TrustLevel | null }>([
    { name: 'level 1 at exactly 70% is eligible for level 2', runs: claudeAtThreshold(), level: 1, want: 2 },
    { name: 'level 1 at 65% is not eligible', runs: claudeJustUnder(), level: 1, want: null },
    { name: 'level 1 at 95% but with 19 runs is not eligible', runs: claudeTooFewRuns(), level: 1, want: null },
    { name: 'level 2 at exactly 85% is eligible for level 3', runs: codexLevelThreeReady(), level: 2, want: 3 },
    { name: 'level 3 has nothing above it', runs: codexLevelThreeReady(), level: 3, want: null },
  ])('$name', ({ runs, level, want }) => {
    expect(track(runs, level).eligibleFor).toBe(want);
  });

  it('the ladder steps one level at a time', () => {
    expect(nextLevel(1)).toBe(2);
    expect(nextLevel(2)).toBe(3);
    expect(nextLevel(3)).toBeNull();
  });

  it('qualifying needs both the run count and the rate', () => {
    expect(qualifiesForLevel(track(claudeAtThreshold()), 2)).toBe(true);
    expect(qualifiesForLevel(track(claudeTooFewRuns()), 2)).toBe(false);
    expect(qualifiesForLevel(track(claudeJustUnder()), 2)).toBe(false);
  });

  it('the track record carries the agent, its level and its rates', () => {
    expect(track(claudeAtThreshold(), 2)).toEqual({
      agent: 'claude',
      runs: 20,
      firstTryVerifiedPct: 70,
      humanFixPct: 5,
      level: 2,
      eligibleFor: null,
    });
  });
});

describe('"Not enough runs yet" (TRU-01)', () => {
  it.each<{ runs: number; want: boolean }>([
    { runs: 19, want: true },
    { runs: 20, want: false },
    { runs: 0, want: true },
  ])('$runs runs in the window', ({ runs, want }) => {
    expect(hasTooFewRuns(track(history('claude', Array<Outcome>(runs).fill('first'))))).toBe(want);
  });

  it('the notice uses the locked words', () => {
    expect(trackNotice(track(claudeTooFewRuns()))).toBe('Not enough runs yet');
    expect(trackNotice(track(claudeTooFewRuns()))).toBe(NOT_ENOUGH_RUNS);
  });

  it('the minimum is 20 runs over 30 days', () => {
    expect(MIN_RUNS).toBe(20);
    expect(TRUST_WINDOW_DAYS).toBe(30);
    expect(START_LEVEL).toBe(1);
  });
});

describe('"Below threshold" (TRU-02)', () => {
  it.each<{ name: string; runs: ReturnType<typeof history>; level: TrustLevel; want: boolean }>([
    { name: 'level 2 at 55% is below threshold (70 - 10)', runs: claudeBelowThreshold(), level: 2, want: true },
    { name: 'level 2 at exactly 60% is below threshold (70 - 10)', runs: claudeAtBelowMargin(), level: 2, want: true },
    { name: 'level 2 at 65% is not below threshold', runs: claudeJustUnder(), level: 2, want: false },
    { name: 'level 1 is never below threshold', runs: claudeBelowThreshold(), level: 1, want: false },
    { name: 'level 3 at 65% is below threshold (85 - 10)', runs: claudeJustUnder(), level: 3, want: true },
    { name: 'level 3 at 55% is below threshold, but the level itself never moves', runs: claudeBelowThreshold(), level: 3, want: true },
  ])('$name', ({ runs, level, want }) => {
    expect(isBelowThreshold(track(runs, level))).toBe(want);
  });

  it('the margin is 10 points', () => {
    expect(BELOW_THRESHOLD_MARGIN).toBe(10);
  });

  it('the notice uses the locked words', () => {
    expect(trackNotice(track(claudeBelowThreshold(), 2))).toBe('Below threshold');
    expect(trackNotice(track(claudeBelowThreshold(), 2))).toBe(BELOW_THRESHOLD);
  });
});

describe('trackNotice precedence', () => {
  it('an agent below both limits reports "Not enough runs yet" first', () => {
    expect(trackNotice(track(history('claude', Array<Outcome>(5).fill('retry')), 2))).toBe('Not enough runs yet');
  });

  it('an agent with nothing to say reports null', () => {
    expect(trackNotice(track(claudeAtThreshold()))).toBeNull();
  });
});
