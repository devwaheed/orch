/**
 * Track records and the promotion ladder (TRU-01, TRU-02). Pure: the service
 * hands it the run history of one agent and a clock, and it returns the
 * contracts `AgentTrack`.
 */
import { TRUST_THRESHOLDS, type AgentId, type AgentTrack, type Timestamp, type TrustLevel } from '@orch/contracts';
import { BELOW_THRESHOLD, NOT_ENOUGH_RUNS } from './copy.js';
import { BELOW_THRESHOLD_MARGIN, MIN_RUNS, TRUST_WINDOW_DAYS } from './constants.js';
import type { TrustRunRecord } from './ports.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The start of the window that ends at `now` and is `days` long. */
export function windowStart(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/**
 * True when `finishedAt` falls inside the `days`-long window that ends at
 * `now`. The window is inclusive on both ends.
 */
export function inWindow(finishedAt: Timestamp, now: Date, days: number): boolean {
  const at = Date.parse(finishedAt);
  return at >= windowStart(now, days).getTime() && at <= now.getTime();
}

/** TRU-01: verified on attempt 1 with no "request changes". */
export function isFirstTryVerified(run: TrustRunRecord): boolean {
  return run.verdict === 'verified' && run.attempt === 1 && !run.requestChanges;
}

/** A run the human had to fix before it was merged (design: "Needed a human fix"). */
export function neededHumanFix(run: TrustRunRecord): boolean {
  return run.requestChanges;
}

/** The percentage of `runs` matching `test`, as a whole percent. No runs is 0. */
export function percentOf(runs: readonly TrustRunRecord[], test: (run: TrustRunRecord) => boolean): number {
  if (runs.length === 0) {
    return 0;
  }
  return Math.round((runs.filter(test).length / runs.length) * 100);
}

export interface AgentTrackInput {
  readonly agent: AgentId;
  /** The agent's level on record; START_LEVEL for an agent that has never been promoted. */
  readonly level: TrustLevel;
  /** The run history. Only this agent's runs count, and only inside the window. */
  readonly runs: readonly TrustRunRecord[];
  readonly now: Date;
}

/** The agent's track record over the last TRUST_WINDOW_DAYS days. */
export function computeAgentTrack(input: AgentTrackInput): AgentTrack {
  const windowed = input.runs.filter(
    (run) => run.agent === input.agent && inWindow(run.finishedAt, input.now, TRUST_WINDOW_DAYS),
  );
  const track: AgentTrack = {
    agent: input.agent,
    runs: windowed.length,
    firstTryVerifiedPct: percentOf(windowed, isFirstTryVerified),
    humanFixPct: percentOf(windowed, neededHumanFix),
    level: input.level,
    eligibleFor: null,
  };
  return { ...track, eligibleFor: eligibleFor(track) };
}

/** The level above this track's level that it qualifies for, or null (TRU-01, TRU-02). */
export function eligibleFor(track: AgentTrack): TrustLevel | null {
  const next = nextLevel(track.level);
  if (next === null || !qualifiesForLevel(track, next)) {
    return null;
  }
  return next;
}

/** The level above `level`, or null at the top of the ladder. */
export function nextLevel(level: TrustLevel): 2 | 3 | null {
  if (level === 1) {
    return 2;
  }
  if (level === 2) {
    return 3;
  }
  return null;
}

/** TRU-01 + TRU-02: enough runs in the window, and a rate at or above the level's threshold. */
export function qualifiesForLevel(track: AgentTrack, level: 2 | 3): boolean {
  return track.runs >= MIN_RUNS && track.firstTryVerifiedPct >= TRUST_THRESHOLDS[level];
}

/** TRU-01: fewer than MIN_RUNS runs in the window. */
export function hasTooFewRuns(track: AgentTrack): boolean {
  return track.runs < MIN_RUNS;
}

/** TRU-02: the rate has dropped BELOW_THRESHOLD_MARGIN or more points below the level's threshold. */
export function isBelowThreshold(track: AgentTrack): boolean {
  if (track.level === 1) {
    return false;
  }
  return track.firstTryVerifiedPct <= TRUST_THRESHOLDS[track.level] - BELOW_THRESHOLD_MARGIN;
}

/** What the ladder shows beside an agent's rate, or null when there is nothing to say. */
export function trackNotice(track: AgentTrack): string | null {
  if (hasTooFewRuns(track)) {
    return NOT_ENOUGH_RUNS;
  }
  if (isBelowThreshold(track)) {
    return BELOW_THRESHOLD;
  }
  return null;
}
