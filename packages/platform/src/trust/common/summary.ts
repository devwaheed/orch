/**
 * The Trust screen's summary (contracts `TrustSummary`). Pure: the service
 * hands it the run history, the corrections, the levels on record and a clock.
 * The four stat cards answer to the period toggle; the agents' track records
 * always answer to TRU-01's 30-day window, so eligibility never moves when the
 * toggle does.
 */
import type { AgentId, CorrectionLayer, TrustLevel, TrustSummary } from '@orchagents/contracts';
import { START_LEVEL } from './constants.js';
import type { TrustAgentInfo, TrustCorrectionRecord, TrustGardenerState, TrustRunRecord } from './ports.js';
import { computeAgentTrack, inWindow, isFirstTryVerified, neededHumanFix, percentOf } from './track.js';

/** REV-06 + design/screens.md "Trust": codebase and lint fixes hold for every agent. */
export function movedUpLayer(layer: CorrectionLayer): boolean {
  return layer === 'codebase' || layer === 'lint';
}

/** Counts corrections per layer, with every layer present so the record is complete. */
export function correctionsByLayer(corrections: readonly TrustCorrectionRecord[]): Record<CorrectionLayer, number> {
  const counts: Record<CorrectionLayer, number> = { codebase: 0, lint: 0, agent_rule: 0, review_note: 0 };
  for (const correction of corrections) {
    counts[correction.layer] += 1;
  }
  return counts;
}

export interface TrustSummaryInput {
  readonly periodDays: 7 | 30;
  readonly now: Date;
  /** Every agent the screen lists, in the order it lists them. */
  readonly agents: readonly TrustAgentInfo[];
  /** The level on record for each agent; an agent with no row starts at START_LEVEL. */
  readonly levels: ReadonlyMap<AgentId, TrustLevel>;
  /** Every finished run. The windows are applied here. */
  readonly runs: readonly TrustRunRecord[];
  readonly corrections: readonly TrustCorrectionRecord[];
  readonly gardener: TrustGardenerState;
}

/** Builds the summary for one period. The agent tracks always use TRU-01's window. */
export function computeTrustSummary(input: TrustSummaryInput): TrustSummary {
  const periodRuns = input.runs.filter((run) => inWindow(run.finishedAt, input.now, input.periodDays));
  const periodCorrections = input.corrections.filter((correction) =>
    inWindow(correction.createdAt, input.now, input.periodDays),
  );

  return {
    periodDays: input.periodDays,
    firstTryVerifiedPct: percentOf(periodRuns, isFirstTryVerified),
    humanFixPct: percentOf(periodRuns, neededHumanFix),
    refutedCount: periodRuns.filter((run) => run.verdict === 'refuted').length,
    correctionsMovedUp: {
      moved: periodCorrections.filter((correction) => movedUpLayer(correction.layer)).length,
      total: periodCorrections.length,
    },
    correctionsByLayer: correctionsByLayer(periodCorrections),
    agents: input.agents.map((agent) =>
      computeAgentTrack({
        agent: agent.agent,
        level: input.levels.get(agent.agent) ?? START_LEVEL,
        runs: input.runs,
        now: input.now,
      }),
    ),
    gardener: {
      on: input.gardener.on,
      nextRunAt: input.gardener.nextRunAt,
      findings: input.gardener.findings.map((finding) => ({ text: finding.text, at: finding.at })),
    },
  };
}
