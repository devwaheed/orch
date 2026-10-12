/** Fixture run histories for the trust numbers (spike report: fixtures are synthetic). */
import type { AgentId, JobMode } from '@orchagents/contracts';
import type { TrustRunRecord } from '../common/ports.js';
import { daysAgo } from './clock.js';

/**
 * One run's outcome, in the alphabet the track rules name:
 * - `first`   verified on attempt 1, no request changes  → first-try verified
 * - `human`   verified on attempt 1, but a human asked for changes → human fix
 * - `retry`   verified on a later attempt
 * - `refuted` the checks refuted it
 * - `open`    not verified yet
 */
export type Outcome = 'first' | 'human' | 'retry' | 'refuted' | 'open';

/** The moment every fixture is measured from. */
export const NOW = new Date('2026-10-11T12:00:00.000Z');

export interface HistoryOptions {
  /** Days back from `now` that the newest run finished. Default 0 (today). */
  readonly newestDaysAgo?: number;
  /** Days between runs. Default 1. */
  readonly everyDays?: number;
  readonly mode?: JobMode;
  readonly specQueue?: boolean;
}

function outcomeOf(outcome: Outcome): Pick<TrustRunRecord, 'verdict' | 'attempt' | 'requestChanges'> {
  switch (outcome) {
    case 'first':
      return { verdict: 'verified', attempt: 1, requestChanges: false };
    case 'human':
      return { verdict: 'verified', attempt: 1, requestChanges: true };
    case 'retry':
      return { verdict: 'verified', attempt: 2, requestChanges: false };
    case 'refuted':
      return { verdict: 'refuted', attempt: 1, requestChanges: false };
    case 'open':
      return { verdict: 'unverified', attempt: 1, requestChanges: false };
  }
}

/** Builds a run history for one agent: one run per outcome, oldest first, newest last. */
export function history(
  agent: AgentId,
  outcomes: readonly Outcome[],
  now: Date = NOW,
  options: HistoryOptions = {},
): TrustRunRecord[] {
  const everyDays = options.everyDays ?? 1;
  const newestDaysAgo = options.newestDaysAgo ?? 0;
  return outcomes.map((outcome, index) => ({
    agent,
    finishedAt: daysAgo(newestDaysAgo + (outcomes.length - 1 - index) * everyDays, now),
    mode: options.mode ?? 'single',
    specQueue: options.specQueue ?? false,
    ...outcomeOf(outcome),
  }));
}

/** Builds one run with every field spelled out, for the edge cases a spread cannot say. */
export function run(agent: AgentId, outcome: Outcome, finishedAt: string, over: Partial<TrustRunRecord> = {}): TrustRunRecord {
  return {
    agent,
    finishedAt,
    mode: 'single',
    specQueue: false,
    ...outcomeOf(outcome),
    ...over,
  };
}

/** 20 runs, 14 first-try verified (70%): exactly TRU-02's level-2 threshold. */
export function claudeAtThreshold(now: Date = NOW): TrustRunRecord[] {
  return history('claude', [
    ...Array<Outcome>(14).fill('first'),
    'human',
    ...Array<Outcome>(3).fill('retry'),
    ...Array<Outcome>(2).fill('refuted'),
  ], now);
}

/** 19 runs, 18 first-try verified (95%): the rate is there, the run count is not. */
export function claudeTooFewRuns(now: Date = NOW): TrustRunRecord[] {
  return history('claude', [...Array<Outcome>(18).fill('first'), 'refuted'], now);
}

/** 20 runs, 13 first-try verified (65%): under TRU-02's level-2 threshold. */
export function claudeJustUnder(now: Date = NOW): TrustRunRecord[] {
  return history('claude', [...Array<Outcome>(13).fill('first'), ...Array<Outcome>(7).fill('retry')], now);
}

/** 20 runs, 12 first-try verified (60%): exactly 10 points under level 2's 70% threshold. */
export function claudeAtBelowMargin(now: Date = NOW): TrustRunRecord[] {
  return history('claude', [...Array<Outcome>(12).fill('first'), ...Array<Outcome>(8).fill('retry')], now);
}

/** 20 runs, 11 first-try verified (55%): 10 points below level 2's 70% threshold. */
export function claudeBelowThreshold(now: Date = NOW): TrustRunRecord[] {
  return history('claude', [...Array<Outcome>(11).fill('first'), ...Array<Outcome>(9).fill('retry')], now);
}

/** 20 runs, 17 first-try verified (85%): exactly TRU-02's level-3 threshold. */
export function codexLevelThreeReady(now: Date = NOW): TrustRunRecord[] {
  return history('codex', [...Array<Outcome>(17).fill('first'), ...Array<Outcome>(3).fill('retry')], now);
}

/** 21 runs whose oldest finished 31 days ago, so only 20 count (TRU-01's window). */
export function geminiOneRunTooOld(now: Date = NOW): TrustRunRecord[] {
  return [
    run('gemini', 'first', daysAgo(31, now)),
    ...history('gemini', [...Array<Outcome>(16).fill('first'), ...Array<Outcome>(4).fill('retry')], now),
  ];
}

/** Every agent's runs, for the summary numbers. */
export function allAgents(now: Date = NOW): TrustRunRecord[] {
  return [
    ...claudeAtThreshold(now),
    ...codexLevelThreeReady(now),
    ...geminiOneRunTooOld(now),
    ...history('agy', [...Array<Outcome>(4).fill('first'), ...Array<Outcome>(6).fill('retry')], now),
    ...history('opencode', ['first'], now),
  ];
}
