/**
 * Adapters that connect the trust service's ports to the store, the adapter list
 * and the clock. Only the core host uses these.
 *
 * Gaps (see the S4-04 report): the store does not record when a run finished, its
 * attempt number, or whether a human asked for changes (REV-05). Until the runs and
 * review services record them, the run history below uses the proxies named on
 * each field, so the first-try and human-fix rates are estimates, not measurements.
 */
import type { AgentAdapter, AgentId, CorrectionLayer, JobMode, Timestamp, Verdict } from '@orchagents/contracts';
import { nextGardenerRun } from '@orchagents/platform/src/trust/gardener/common/schedule.js';
import type {
  ITrustAgentsSource,
  ITrustCorrectionsSource,
  ITrustGardenerSource,
  ITrustRunHistory,
  TrustGardenerState,
  TrustRunRecord,
} from '@orchagents/platform/src/trust/common/ports.js';
import { correctionTable, jobTable, reviewTable, runLinkTable } from '@orchagents/platform/src/store/common/schema.js';
import type { IStoreService } from '@orchagents/platform/src/store/common/store.js';

/** The agents the Trust screen lists, in adapter order (the order the core host registers them). */
export class AdapterTrustAgents implements ITrustAgentsSource {
  constructor(private readonly adapters: readonly AgentAdapter[]) {}

  list() {
    return this.adapters.map((adapter) => ({ agent: adapter.id, displayName: adapter.displayName }));
  }
}

/** Corrections by layer and time (REV-06), from the correction table. */
export class StoreTrustCorrections implements ITrustCorrectionsSource {
  constructor(private readonly store: IStoreService) {}

  corrections() {
    return this.store.db
      .select()
      .from(correctionTable)
      .all()
      .map((row) => ({ layer: row.layer as CorrectionLayer, createdAt: row.createdAt as Timestamp }));
  }
}

const TERMINAL_RUN_STATUSES: readonly string[] = ['done', 'failed', 'stopped'];

/**
 * Finished runs, oldest first, from run_link joined to its job and its review.
 * Proxies, because the store lacks the data:
 * - finishedAt: the run's startedAt (no finish time is stored); runs without one are skipped.
 * - attempt: 1 (attempts are not stored per run).
 * - requestChanges: false (change requests are not stored).
 * - verdict: the review's verdict for the run, or 'unverified' when there is no review.
 * - specQueue: false (spec-queue links are not stored on the run).
 */
export class StoreTrustRunHistory implements ITrustRunHistory {
  constructor(private readonly store: IStoreService) {}

  runs(): readonly TrustRunRecord[] {
    const db = this.store.db;
    const jobs = new Map(db.select().from(jobTable).all().map((job) => [job.id, job]));
    const verdicts = new Map<string, Verdict>();
    for (const review of db.select().from(reviewTable).all()) {
      if (review.runId) verdicts.set(review.runId, review.verdict);
    }

    const runs: TrustRunRecord[] = [];
    for (const run of db.select().from(runLinkTable).all()) {
      if (!TERMINAL_RUN_STATUSES.includes(run.status) || !run.startedAt) continue;
      const job = jobs.get(run.jobId);
      runs.push({
        agent: run.agent as AgentId,
        verdict: verdicts.get(run.id) ?? 'unverified',
        attempt: 1,
        requestChanges: false,
        finishedAt: run.startedAt as Timestamp,
        mode: (job?.mode ?? 'single') as JobMode,
        specQueue: false,
      });
    }
    return runs.sort((a, b) => (a.finishedAt < b.finishedAt ? -1 : a.finishedAt > b.finishedAt ? 1 : 0));
  }
}

/**
 * The gardener's state until S4-05 lands. On by default (TRU-04). The on/off switch
 * is kept in memory only: whether it persists across launches is not decided yet.
 * No findings are produced until the gardener service exists.
 */
export class MemoryTrustGardener implements ITrustGardenerSource {
  private on = true;

  constructor(
    private readonly clock: () => Date,
    private readonly timeZone: () => string,
  ) {}

  state(): TrustGardenerState {
    const nextRunAt = this.on ? (nextGardenerRun(this.clock(), this.timeZone()).toISOString() as Timestamp) : null;
    return { on: this.on, nextRunAt, findings: [] };
  }

  setOn(on: boolean): void {
    this.on = on;
  }
}
