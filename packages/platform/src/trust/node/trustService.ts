/**
 * The trust service: the Trust screen's numbers, the promotion ladder and the
 * level-3 auto-merge gate (TRU-01..TRU-03). Levels live in the `trust_level`
 * table; the run history, corrections, gardener state and agent list arrive
 * through ports, so the runs, review and gardener services can back them later.
 */
import { ok } from '@orch/base';
import {
  AgentId as AgentIdSchema,
  TrustLevel as TrustLevelSchema,
  TrustSummary as TrustSummarySchema,
  type AgentId,
  type AgentTrack,
  type ITrustService,
  type OrchError,
  type Result,
  type TrustLevel,
  type TrustSummary,
} from '@orch/contracts';
import { AGENT_OR_LEVEL_INVALID, TRUST_COPY } from '../common/copy.js';
import { START_LEVEL } from '../common/constants.js';
import type {
  ITrustAgentsSource,
  ITrustCorrectionsSource,
  ITrustGardenerSource,
  ITrustLevelStore,
  ITrustRunHistory,
} from '../common/ports.js';
import { computeTrustSummary } from '../common/summary.js';
import { computeAgentTrack, hasTooFewRuns, nextLevel, qualifiesForLevel } from '../common/track.js';

export interface TrustServiceDeps {
  readonly agents: ITrustAgentsSource;
  readonly runs: ITrustRunHistory;
  readonly corrections: ITrustCorrectionsSource;
  readonly levels: ITrustLevelStore;
  readonly gardener: ITrustGardenerSource;
  /** Injected so the window tests can move time. */
  readonly now?: () => Date;
}

type TrustErrorCode = Extract<OrchError['code'], 'validation_failed' | 'conflict' | 'internal'>;

function fail(code: TrustErrorCode, copy: { readonly message: string; readonly fix: string }): Result<never> {
  return { ok: false, error: { code, message: copy.message, fix: copy.fix } };
}

export class TrustService implements ITrustService {
  private readonly now: () => Date;

  constructor(private readonly deps: TrustServiceDeps) {
    this.now = deps.now ?? ((): Date => new Date());
  }

  async summary(periodDays: 7 | 30): Promise<Result<TrustSummary>> {
    const summary = computeTrustSummary({
      periodDays,
      now: this.now(),
      agents: this.deps.agents.list(),
      levels: this.levelsOnRecord(),
      runs: this.deps.runs.runs(),
      corrections: this.deps.corrections.corrections(),
      gardener: this.deps.gardener.state(),
    });

    // The summary crosses a process boundary, so it is checked against the contract.
    const parsed = TrustSummarySchema.safeParse(summary);
    if (!parsed.success) {
      return fail('internal', TRUST_COPY.summaryFailed);
    }
    return ok(parsed.data);
  }

  /** Manual only. Fails when the agent does not qualify for the level (TRU-01, TRU-02). */
  async promote(agent: AgentId, level: TrustLevel): Promise<Result<void>> {
    const parsedAgent = AgentIdSchema.safeParse(agent);
    const parsedLevel = TrustLevelSchema.safeParse(level);
    if (!parsedAgent.success || !parsedLevel.success) {
      return fail('validation_failed', AGENT_OR_LEVEL_INVALID);
    }
    const target = parsedLevel.data;
    const agentName = this.agentName(parsedAgent.data);

    // The ladder moves one step at a time, and level 1 is where every agent starts (TRU-02).
    if (target === 1 || target !== nextLevel(this.levelOf(parsedAgent.data))) {
      return fail('conflict', TRUST_COPY.notTheNextLevel(agentName, this.levelOf(parsedAgent.data), target));
    }

    const track = this.trackOf(parsedAgent.data);
    if (hasTooFewRuns(track)) {
      return fail('conflict', TRUST_COPY.notEnoughRuns(agentName, track.runs));
    }
    if (!qualifiesForLevel(track, target)) {
      return fail('conflict', TRUST_COPY.belowThreshold(agentName, track.firstTryVerifiedPct, target));
    }

    try {
      this.deps.levels.putLevel(parsedAgent.data, target, this.now().toISOString());
    } catch {
      return fail('internal', TRUST_COPY.saveFailed);
    }
    return ok(undefined);
  }

  async setGardener(on: boolean): Promise<Result<void>> {
    this.deps.gardener.setOn(on);
    return ok(undefined);
  }

  /** The agent's level on record; TRU-02's start level for an agent with no row. */
  private levelOf(agent: AgentId): TrustLevel {
    return this.deps.levels.levelOf(agent) ?? START_LEVEL;
  }

  /** The agent's track record over TRU-01's window, from this agent's runs only. */
  private trackOf(agent: AgentId): AgentTrack {
    return computeAgentTrack({
      agent,
      level: this.levelOf(agent),
      runs: this.deps.runs.runs().filter((run) => run.agent === agent),
      now: this.now(),
    });
  }

  private levelsOnRecord(): ReadonlyMap<AgentId, TrustLevel> {
    const levels = new Map<AgentId, TrustLevel>();
    for (const agent of this.deps.agents.list()) {
      const level = this.deps.levels.levelOf(agent.agent);
      if (level !== undefined) {
        levels.set(agent.agent, level);
      }
    }
    return levels;
  }

  private agentName(agent: AgentId): string {
    const listed = this.deps.agents.list().find((entry) => entry.agent === agent);
    return listed?.displayName ?? agent;
  }
}
