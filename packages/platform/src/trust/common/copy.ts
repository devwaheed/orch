/**
 * User-facing strings for the trust area (UI-07: one strings file per area).
 * Errors follow OrchError: `message` says what happened, `fix` says what to do.
 * The two labels the locked rules name are taken from them word for word; the
 * rest of the wording is proposed and marked for owner approval.
 */
import { TRUST_THRESHOLDS, type TrustLevel } from '@orchagents/contracts';
import { MIN_RUNS, TRUST_WINDOW_DAYS } from './constants.js';

/** TRU-01: shown for an agent with fewer than MIN_RUNS runs in the window. */
export const NOT_ENOUGH_RUNS = 'Not enough runs yet';

/** TRU-02: shown for an agent BELOW_THRESHOLD_MARGIN points below its level's threshold. */
export const BELOW_THRESHOLD = 'Below threshold';

/** Proposed copy: an agent or level that is not one orch knows. */
export const AGENT_OR_LEVEL_INVALID = {
  message: 'Choose one of the agents orch runs, and a level from 1 to 3.',
  fix: 'Pick the agent and the level again, then promote.',
};

export const TRUST_COPY = {
  /** TRU-01: fewer than 20 runs in the last 30 days. */
  notEnoughRuns: (agentName: string, runs: number) => ({
    message: `${NOT_ENOUGH_RUNS}: ${agentName} has ${runs} runs in the last ${TRUST_WINDOW_DAYS} days, and ${MIN_RUNS} runs are needed.`,
    fix: `Run more jobs with ${agentName}, then promote it again.`,
  }),

  /** TRU-02: the rate is under the level's threshold. */
  belowThreshold: (agentName: string, firstTryVerifiedPct: number, level: 2 | 3) => ({
    message: `${BELOW_THRESHOLD}: ${agentName} is verified on the first try ${firstTryVerifiedPct}% of the time, and ${TRUST_THRESHOLDS[level]}% is needed for level ${level}.`,
    fix: `Keep reviewing ${agentName}'s work, then promote it again.`,
  }),

  /** The ladder moves one step at a time (design/screens.md "Trust"). */
  notTheNextLevel: (agentName: string, from: TrustLevel, to: TrustLevel) => ({
    message: `${agentName} is at level ${from}, so it cannot be promoted to level ${to}.`,
    fix: 'Promotion moves one level at a time.',
  }),

  saveFailed: {
    message: 'orch could not save the trust level.',
    fix: 'Try again. If it keeps happening, restart orch.',
  },

  summaryFailed: {
    message: 'orch could not add up the trust numbers.',
    fix: 'Try again. If it keeps happening, report it with the log file.',
  },
} as const;
