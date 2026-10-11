/**
 * The trust service's dependencies (docs/architecture.md: dependencies arrive
 * through the constructor, never through imports of another service). The runs,
 * review and gardener services back these ports later; tests use the in-memory
 * fakes in ../test/fakes.ts.
 */
import type { AgentId, CorrectionLayer, JobMode, Timestamp, Verdict } from '@orch/contracts';
import type { TrustLevel } from '@orch/contracts';

/** One finished run, as the trust service measures it (TRU-01). */
export interface TrustRunRecord {
  readonly agent: AgentId;
  readonly verdict: Verdict;
  /** 1 on the agent's first try at the job. */
  readonly attempt: number;
  /** A human asked for changes on this run before it was merged (REV-05). */
  readonly requestChanges: boolean;
  readonly finishedAt: Timestamp;
  readonly mode: JobMode;
  /** True when the run came from the spec queue; auto-merge never applies there (TRU-03). */
  readonly specQueue: boolean;
}

/** The run history the trust service measures. */
export interface ITrustRunHistory {
  /** Every finished run, oldest first. The service picks the agents and the window. */
  runs(): readonly TrustRunRecord[];
}

/** One correction, as the trust service counts it (REV-06). */
export interface TrustCorrectionRecord {
  readonly layer: CorrectionLayer;
  readonly createdAt: Timestamp;
}

export interface ITrustCorrectionsSource {
  corrections(): readonly TrustCorrectionRecord[];
}

/** One gardener finding, shown on the Trust screen (TRU-04 findings). */
export interface TrustGardenerFinding {
  readonly text: string;
  readonly at: Timestamp;
}

export interface TrustGardenerState {
  readonly on: boolean;
  /** When the gardener next runs, or null when it is off. The schedule is TRU-04 / S4-05. */
  readonly nextRunAt: Timestamp | null;
  readonly findings: readonly TrustGardenerFinding[];
}

/**
 * The gardener's state. S4-05 owns the schedule, the account choice and the
 * proposals; this port is how the trust service reads and switches it.
 */
export interface ITrustGardenerSource {
  state(): TrustGardenerState;
  setOn(on: boolean): void;
}

/**
 * Levels on record. The store's `trust_level` table backs this
 * (store/common/schema.ts); `node/trustLevelStore.ts` is that adapter.
 */
export interface ITrustLevelStore {
  /** The level on record, or undefined for an agent that has never been promoted (TRU-02). */
  levelOf(agent: AgentId): TrustLevel | undefined;
  /** Records a level with the time it changed. */
  putLevel(agent: AgentId, level: TrustLevel, changedAt: Timestamp): void;
}

/** One agent as the Trust screen lists it. */
export interface TrustAgentInfo {
  readonly agent: AgentId;
  readonly displayName: string;
}

/**
 * The agents the trust service reports on, in the order the Trust screen lists
 * them. The accounts service backs this later.
 */
export interface ITrustAgentsSource {
  list(): readonly TrustAgentInfo[];
}
