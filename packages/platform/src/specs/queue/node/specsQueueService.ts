/**
 * SpecsQueueService: implements ISpecsService (docs/specs/spec-queue.md §4–§10).
 * State machine, scheduler with waves/overlap, retries, audits, gates, merge order, pause/resume/cancel.
 */
import { Emitter, err, ok, type Event } from '@orchagents/base';
import {
  type AccountId,
  type AgentId,
  type ISpecsService,
  type JobId,
  type OrchEvent,
  type QueueId,
  type Result,
  type Run,
  type SessionId,
  type SpecId,
  type SpecLoadProblem,
  type SpecQueue,
  type SpecQueueSettings,
  type SpecRun,
  type SpecState,
  type SpecUsageHour,
  type Timestamp,
} from '@orchagents/contracts';
import type { IGitService } from '../../../git/common/git.js';
import type { EngineClient } from '../../../engine/common/engineClient.js';
import { loadSpecQueue } from '../../loader/node/specLoader.js';
import { scheduleQueue } from '../common/scheduler.js';
import { reorderSpec } from '../common/reorder.js';
import { transitionSpecState, validateTransition } from '../common/stateMachine.js';
import {
  loadPersistedQueueState,
  recoverActiveSpecs,
  saveQueueState,
} from './persistence.js';
import type {
  ISpecJobRunner,
} from './specJobRunner.js';
import {
  RealSpecJobRunner,
} from './specJobRunner.js';
import type { CommandRunner } from './specMerge.js';
import { getNextSpecToMerge, mergeApprovedSpec } from './specMerge.js';
import type { PickAccountResult, SpecInitReport } from '@orchagents/contracts';
import { initBmadStories } from '../../loader/node/bmadInit.js';

export interface SpecsQueueServiceDeps {
  git: IGitService;
  quota?:
    | {
        pickAccount(agent: AgentId): Promise<Result<PickAccountResult>>;
      }
    | undefined;
  /** The runs of a job, so usage() can map a spec to its engine sessions. */
  runs?: { list(jobId: JobId): Promise<Result<Run[]>> } | undefined;
  /** The engine ledger (ledger.query), like QuotaService spendsToday. */
  engine?: Pick<EngineClient, 'request'> | undefined;
  jobRunner?: ISpecJobRunner | undefined;
  commandRunner?: CommandRunner | undefined;
  onEvent?: ((event: OrchEvent) => void) | undefined;
  installedAgents?: readonly AgentId[] | undefined;
}

export class SpecsQueueService implements ISpecsService {
  private readonly emitter = new Emitter<OrchEvent>();
  readonly onEvent: Event<OrchEvent> = this.emitter.event;

  private readonly queues = new Map<QueueId, SpecQueue>();
  private readonly activeJobs = new Set<string>();
  private intervalTimer: NodeJS.Timeout | null = null;
  private readonly runner: ISpecJobRunner;

  constructor(private readonly deps: SpecsQueueServiceDeps) {
    if (deps.onEvent) {
      this.emitter.event(deps.onEvent);
    }

    if (deps.jobRunner) {
      this.runner = deps.jobRunner;
    } else {
      const defaultQuota = {
        pickAccount: async (agent: AgentId): Promise<Result<PickAccountResult>> =>
          ok({ kind: 'account', accountId: `acct-${agent}` as AccountId }),
      };
      this.runner = new RealSpecJobRunner({
        git: deps.git,
        quota: deps.quota ?? defaultQuota,
        commandRunner: deps.commandRunner,
        installedAgents: deps.installedAgents,
      });
    }

    // Every 30 seconds run scheduler (§5)
    this.intervalTimer = setInterval(() => {
      for (const queueId of this.queues.keys()) {
        void this.scheduleAndRun(queueId);
      }
    }, 30_000);
    if (this.intervalTimer.unref) {
      this.intervalTimer.unref();
    }
  }

  dispose(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    this.emitter.dispose();
  }

  private emit(event: OrchEvent): void {
    this.emitter.fire(event);
  }

  private async persist(queue: SpecQueue): Promise<void> {
    await saveQueueState(queue);
  }

  /** `orch specs init`: adds front matter to BMAD stories that lack it (spec-queue.md §2, §13). */
  async init(repoPath: string): Promise<Result<SpecInitReport>> {
    const res = await initBmadStories({ repoPath });
    if (!res.ok) {
      return res;
    }
    return ok({
      added: res.value.added.map((item) => ({ ...item })),
      skipped: [...res.value.skipped],
    });
  }

  async load(repoPath: string): Promise<Result<{ queue: SpecQueue | null; problems: SpecLoadProblem[] }>> {
    const loadedRes = await loadSpecQueue(repoPath);
    if (!loadedRes.ok) {
      return loadedRes;
    }

    const { queue: freshQueue, problems } = loadedRes.value;
    if (problems.length > 0 || !freshQueue) {
      return ok({ queue: null, problems: [...problems] });
    }

    // Check if persisted state exists under .orch/queue-state.json
    const persistedRes = await loadPersistedQueueState(repoPath);
    let finalQueue = freshQueue;

    if (persistedRes.ok && persistedRes.value) {
      const persisted = persistedRes.value;
      const persistedMap = new Map<SpecId, SpecRun>(persisted.specs.map((s) => [s.id, s]));

      // Merge persisted runtime state into the freshly loaded specs
      const mergedSpecs: SpecRun[] = freshQueue.specs.map((freshSpec) => {
        const saved = persistedMap.get(freshSpec.id);
        if (saved) {
          return {
            ...freshSpec,
            position: saved.position,
            state: saved.state,
            attempt: saved.attempt,
            jobId: saved.jobId,
            worktree: saved.worktree,
            implementer: saved.implementer,
            criteria: saved.criteria,
            blockedBy: saved.blockedBy,
            startedAt: saved.startedAt,
            finishedAt: saved.finishedAt,
            tokens: saved.tokens,
            history: saved.history,
          };
        }
        return freshSpec;
      });

      // Sort by position
      mergedSpecs.sort((a, b) => a.position - b.position);

      // Restart recovery (§9): active specs that lost workflow return to queued with attempt kept
      const { recoveredSpecs } = recoverActiveSpecs(mergedSpecs, () => false);

      finalQueue = {
        ...freshQueue,
        id: persisted.id,
        paused: persisted.paused,
        settings: persisted.settings,
        specs: recoveredSpecs,
      };
    }

    this.queues.set(finalQueue.id, finalQueue);
    await this.persist(finalQueue);

    return ok({ queue: finalQueue, problems: [] });
  }

  initQueue(queue: SpecQueue): void {
    this.queues.set(queue.id, queue);
  }

  getQueue(queueId: QueueId): SpecQueue | undefined {
    return this.queues.get(queueId);
  }

  async get(queueId: QueueId): Promise<Result<SpecQueue>> {
    const q = this.queues.get(queueId);
    if (!q) {
      return err({
        code: 'not_found',
        message: `Spec queue ${queueId} not found.`,
        fix: 'Call load() first to initialize the spec queue.',
      });
    }
    return ok(q);
  }

  async start(queueId: QueueId): Promise<Result<void>> {
    const qRes = await this.get(queueId);
    if (!qRes.ok) return qRes;
    const queue = qRes.value;

    queue.paused = false;
    this.emit({ type: 'queue.changed', queue });
    await this.persist(queue);

    await this.scheduleAndRun(queueId);
    return ok(undefined);
  }

  async pause(queueId: QueueId): Promise<Result<void>> {
    const qRes = await this.get(queueId);
    if (!qRes.ok) return qRes;
    const queue = qRes.value;

    queue.paused = true;
    this.emit({ type: 'queue.changed', queue });
    await this.persist(queue);

    return ok(undefined);
  }

  async resume(queueId: QueueId): Promise<Result<void>> {
    const qRes = await this.get(queueId);
    if (!qRes.ok) return qRes;
    const queue = qRes.value;

    queue.paused = false;
    this.emit({ type: 'queue.changed', queue });
    await this.persist(queue);

    await this.scheduleAndRun(queueId);
    return ok(undefined);
  }

  async updateSettings(
    queueId: QueueId,
    settings: Partial<SpecQueueSettings>,
  ): Promise<Result<SpecQueueSettings>> {
    const qRes = await this.get(queueId);
    if (!qRes.ok) return qRes;
    const queue = qRes.value;

    queue.settings = {
      ...queue.settings,
      ...settings,
    };

    this.emit({ type: 'queue.changed', queue });
    await this.persist(queue);

    await this.scheduleAndRun(queueId);
    return ok(queue.settings);
  }

  async move(queueId: QueueId, specId: SpecId, toPosition: number): Promise<Result<void>> {
    const qRes = await this.get(queueId);
    if (!qRes.ok) return qRes;
    const queue = qRes.value;

    const moveRes = reorderSpec(queue.specs, specId, toPosition);
    if (!moveRes.ok) {
      return moveRes;
    }

    queue.specs = moveRes.value;
    const movedSpec = queue.specs.find((s) => s.id === specId);
    if (movedSpec) {
      this.emit({ type: 'spec.changed', spec: movedSpec });
    }
    this.emit({ type: 'queue.changed', queue });
    await this.persist(queue);

    await this.scheduleAndRun(queueId);
    return ok(undefined);
  }

  async skip(queueId: QueueId, specId: SpecId): Promise<Result<void>> {
    const qRes = await this.get(queueId);
    if (!qRes.ok) return qRes;
    const queue = qRes.value;

    const specIdx = queue.specs.findIndex((s) => s.id === specId);
    if (specIdx === -1) {
      return err({ code: 'not_found', message: `Spec ${specId} not found.` });
    }

    const spec = queue.specs[specIdx]!;
    // Allowed from queued, blocked, waiting_quota, needs_you (§4)
    const valid = validateTransition(spec.state, 'skipped');
    if (!valid.ok) {
      return valid;
    }

    const skippedRes = transitionSpecState(spec, 'skipped');
    if (!skippedRes.ok) return skippedRes;

    queue.specs[specIdx] = skippedRes.value;
    this.emit({ type: 'spec.changed', spec: skippedRes.value });
    await this.persist(queue);

    await this.scheduleAndRun(queueId);
    return ok(undefined);
  }

  async retry(queueId: QueueId, specId: SpecId): Promise<Result<void>> {
    const qRes = await this.get(queueId);
    if (!qRes.ok) return qRes;
    const queue = qRes.value;

    const specIdx = queue.specs.findIndex((s) => s.id === specId);
    if (specIdx === -1) {
      return err({ code: 'not_found', message: `Spec ${specId} not found.` });
    }

    const spec = queue.specs[specIdx]!;
    // Allowed only from needs_you or skipped (§4, §8)
    const valid = validateTransition(spec.state, 'queued');
    if (!valid.ok) {
      return valid;
    }

    const retriedRes = transitionSpecState(spec, 'queued');
    if (!retriedRes.ok) return retriedRes;

    queue.specs[specIdx] = retriedRes.value;
    this.emit({ type: 'spec.changed', spec: retriedRes.value });

    // Unblock any dependents blocked by this spec (§8)
    for (let i = 0; i < queue.specs.length; i++) {
      const other = queue.specs[i]!;
      if (other.state === 'blocked' && other.blockedBy.includes(specId)) {
        const nextBlocked = other.blockedBy.filter((b) => b !== specId);
        if (nextBlocked.length === 0) {
          const unblockedRes = transitionSpecState(other, 'queued');
          if (unblockedRes.ok) {
            queue.specs[i] = unblockedRes.value;
            this.emit({ type: 'spec.changed', spec: unblockedRes.value });
          }
        } else {
          queue.specs[i] = { ...other, blockedBy: nextBlocked };
          this.emit({ type: 'spec.changed', spec: queue.specs[i]! });
        }
      }
    }

    await this.persist(queue);
    await this.scheduleAndRun(queueId);
    return ok(undefined);
  }

  /** Tokens and cost of the spec's runs per clock hour, oldest first (services.ts ISpecsService.usage). */
  async usage(queueId: QueueId, specId: SpecId): Promise<Result<SpecUsageHour[]>> {
    const queue = this.queues.get(queueId);
    const spec = queue?.specs.find((s) => s.id === specId);
    if (!queue || !spec) {
      return err({
        code: 'not_found',
        message: `Spec ${specId} not found.`,
        fix: 'Check the spec id on the Plan screen, then try again.',
      });
    }
    if (spec.jobId === null) {
      return ok([]);
    }

    const runs = this.deps.runs;
    const engine = this.deps.engine;
    if (!runs || !engine) {
      return err({
        code: 'internal',
        message: 'Usage needs the run history and the engine; they are not wired into the queue service.',
        fix: 'Restart orch so the core host starts with all services.',
      });
    }

    const runsRes = await runs.list(spec.jobId);
    if (!runsRes.ok) {
      return { ok: false, error: runsRes.error };
    }
    const sessionIds = new Set(
      runsRes.value.flatMap((r) => (r.sessionId !== null ? [r.sessionId] : [])),
    );

    const since = spec.startedAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const ledgerRes = await engine.request({ op: 'ledger.query', since });
    if (!ledgerRes.ok) {
      return { ok: false, error: ledgerRes.error };
    }

    const rows = (ledgerRes.value as { rows?: unknown } | null)?.rows;
    if (!Array.isArray(rows)) {
      return err({
        code: 'internal',
        message: 'The engine ledger answered without rows.',
        fix: 'Restart orch; if it keeps failing, report it via Help → Report a problem.',
      });
    }

    // Group the spec's sessions' turns by clock hour (UTC, floored to hh:00:00.000Z)
    const buckets = new Map<Timestamp, { tokens: number; usd: number }>();
    for (const row of rows) {
      const r = row as { ts?: unknown; session?: unknown; tokensIn?: unknown; tokensOut?: unknown; costUsd?: unknown };
      if (typeof r.ts !== 'string' || typeof r.session !== 'string') continue;
      if (!sessionIds.has(r.session as SessionId)) continue;
      const at = new Date(r.ts);
      if (Number.isNaN(at.getTime())) continue;
      const hourMs = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), at.getUTCHours());
      const hour = new Date(hourMs).toISOString() as Timestamp;
      const bucket = buckets.get(hour) ?? { tokens: 0, usd: 0 };
      bucket.tokens +=
        (typeof r.tokensIn === 'number' && Number.isFinite(r.tokensIn) ? r.tokensIn : 0) +
        (typeof r.tokensOut === 'number' && Number.isFinite(r.tokensOut) ? r.tokensOut : 0);
      bucket.usd += typeof r.costUsd === 'number' && Number.isFinite(r.costUsd) ? r.costUsd : 0;
      buckets.set(hour, bucket);
    }

    return ok(
      [...buckets.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([hour, b]) => ({ hour, tokens: b.tokens, usd: b.usd })),
    );
  }

  async cancel(queueId: QueueId): Promise<Result<void>> {
    const qRes = await this.get(queueId);
    if (!qRes.ok) return qRes;
    const queue = qRes.value;

    // Stop active jobs (§9): only specs with a try in progress have one to stop.
    const stopping: Promise<void>[] = [];

    // Set every non-merged spec to cancelled (§4, §9). Cancelled is reachable from any state except merged.
    for (let i = 0; i < queue.specs.length; i++) {
      const s = queue.specs[i]!;
      if (s.state === 'merged') continue;
      const cancelRes = transitionSpecState(s, 'cancelled');
      if (!cancelRes.ok) continue;

      if (s.state === 'running' || s.state === 'verifying' || s.state === 'auditing') {
        stopping.push(this.runner.cancel(s, queue.repoPath));
      }
      queue.specs[i] = cancelRes.value;
      this.emit({ type: 'spec.changed', spec: cancelRes.value });
    }

    // Worktrees are kept by the runner, so a failed stop does not undo the cancel.
    await Promise.allSettled(stopping);

    this.emit({ type: 'queue.changed', queue });
    await this.persist(queue);
    return ok(undefined);
  }

  async approve(queueId: QueueId, specId: SpecId): Promise<Result<void>> {
    const qRes = await this.get(queueId);
    if (!qRes.ok) return qRes;
    const queue = qRes.value;

    const specIdx = queue.specs.findIndex((s) => s.id === specId);
    if (specIdx === -1) {
      return err({ code: 'not_found', message: `Spec ${specId} not found.` });
    }

    const spec = queue.specs[specIdx]!;
    const approvedRes = transitionSpecState(spec, 'approved');
    if (!approvedRes.ok) {
      return approvedRes;
    }

    queue.specs[specIdx] = approvedRes.value;
    this.emit({ type: 'spec.changed', spec: approvedRes.value });
    await this.persist(queue);

    // Process any merges that are now ready (§7)
    await this.processMerges(queueId);
    await this.scheduleAndRun(queueId);
    return ok(undefined);
  }

  async requestChanges(queueId: QueueId, specId: SpecId, feedback: string): Promise<Result<void>> {
    const qRes = await this.get(queueId);
    if (!qRes.ok) return qRes;
    const queue = qRes.value;

    const specIdx = queue.specs.findIndex((s) => s.id === specId);
    if (specIdx === -1) {
      return err({ code: 'not_found', message: `Spec ${specId} not found.` });
    }

    const spec = queue.specs[specIdx]!;
    // verified -> running (attempt + 1, does not count against retries) (§4)
    const runRes = transitionSpecState(spec, 'running', { attemptAction: 'increment' });
    if (!runRes.ok) {
      return runRes;
    }

    queue.specs[specIdx] = runRes.value;
    this.emit({ type: 'spec.changed', spec: runRes.value });
    await this.persist(queue);

    void this.runSpecLifecycle(queueId, specId, feedback);
    return ok(undefined);
  }

  async onQuotaAvailable(_accountId?: AccountId): Promise<void> {
    void _accountId;
    for (const [queueId, queue] of this.queues.entries()) {
      // Check any specs in waiting_quota
      let changed = false;
      for (let i = 0; i < queue.specs.length; i++) {
        const s = queue.specs[i]!;
        if (s.state === 'waiting_quota') {
          const runRes = transitionSpecState(s, 'running');
          if (runRes.ok) {
            queue.specs[i] = runRes.value;
            this.emit({ type: 'spec.changed', spec: runRes.value });
            changed = true;
            void this.runSpecLifecycle(queueId, s.id);
          }
        }
      }
      if (changed) {
        await this.persist(queue);
      }
      void this.scheduleAndRun(queueId);
    }
  }

  async scheduleAndRun(queueId: QueueId): Promise<void> {
    const queue = this.queues.get(queueId);
    if (!queue || queue.paused) {
      return;
    }

    const hasRoom = (_agent: AgentId): boolean => {
      void _agent;
      // If quota service is available, assume true unless mocked otherwise
      return true;
    };

    const schedRes = scheduleQueue(queue, { hasRoom });
    const oldSpecs = queue.specs;
    queue.specs = schedRes.updatedSpecs;

    // Emit spec.changed for any specs whose state or blockedBy changed
    for (let i = 0; i < queue.specs.length; i++) {
      const cur = queue.specs[i]!;
      const old = oldSpecs[i];
      if (
        !old ||
        cur.state !== old.state ||
        cur.attempt !== old.attempt ||
        cur.blockedBy.length !== old.blockedBy.length
      ) {
        this.emit({ type: 'spec.changed', spec: cur });
      }
    }

    await this.persist(queue);

    // Launch execution for specsToStart
    for (const toStart of schedRes.specsToStart) {
      if (toStart.state === 'running') {
        void this.runSpecLifecycle(queueId, toStart.id);
      }
    }
  }

  private async runSpecLifecycle(
    queueId: QueueId,
    specId: SpecId,
    initialRetryMessage?: string,
  ): Promise<void> {
    const jobKey = `${queueId}:${specId}`;
    if (this.activeJobs.has(jobKey)) {
      return;
    }
    this.activeJobs.add(jobKey);

    try {
      let retryMsg: string | undefined = initialRetryMessage;

      while (true) {
        const queue = this.queues.get(queueId);
        if (!queue) break;

        const specIdx = queue.specs.findIndex((s) => s.id === specId);
        if (specIdx === -1) break;
        let spec = queue.specs[specIdx]!;

        if (spec.state !== 'running') {
          break;
        }

        const maxTries = 1 + queue.settings.retries; // Total tries = 1 + retries (§3)
        const currentAttempt = spec.attempt ?? 1;

        // Run try
        const tryResult = await this.runner.runTry(spec, queue.repoPath, queue.settings, retryMsg);

        // Refresh spec reference
        const currentQueue = this.queues.get(queueId);
        if (!currentQueue) break;
        const currentIdx = currentQueue.specs.findIndex((s) => s.id === specId);
        if (currentIdx === -1) break;
        spec = currentQueue.specs[currentIdx]!;

        // Cancelled (or otherwise moved) while the try ran: its result must not overwrite the state (§9).
        if (spec.state !== 'running') {
          break;
        }

        if (tryResult.limited) {
          // Account limited mid-run (§4, SQ-15)
          const waitRes = transitionSpecState(spec, 'waiting_quota');
          if (waitRes.ok) {
            currentQueue.specs[currentIdx] = {
              ...waitRes.value,
              implementer: tryResult.implementer ?? spec.implementer,
            };
            this.emit({ type: 'spec.changed', spec: currentQueue.specs[currentIdx]! });
            await this.persist(currentQueue);
          }
          break;
        }

        if (tryResult.success) {
          // Transition running -> verifying -> auditing -> verified (§4)
          const vRes = transitionSpecState(spec, 'verifying');
          const verifyingSpec = vRes.ok ? vRes.value : spec;
          currentQueue.specs[currentIdx] = {
            ...verifyingSpec,
            implementer: tryResult.implementer ?? spec.implementer,
            criteria: [...tryResult.criterionResults],
          };
          this.emit({ type: 'spec.changed', spec: currentQueue.specs[currentIdx]! });

          const aRes = transitionSpecState(currentQueue.specs[currentIdx]!, 'auditing');
          const auditingSpec = aRes.ok ? aRes.value : currentQueue.specs[currentIdx]!;
          currentQueue.specs[currentIdx] = auditingSpec;
          this.emit({ type: 'spec.changed', spec: auditingSpec });

          const verifiedRes = transitionSpecState(auditingSpec, 'verified');
          const finalSpec = verifiedRes.ok ? verifiedRes.value : auditingSpec;
          currentQueue.specs[currentIdx] = {
            ...finalSpec,
            finishedAt: new Date().toISOString() as Timestamp,
          };
          this.emit({ type: 'spec.changed', spec: currentQueue.specs[currentIdx]! });
          await this.persist(currentQueue);

          // With advance = verified, dependents start as soon as a spec is verified (§7, SQ-02)
          await this.scheduleAndRun(queueId);
          break;
        }

        // Try failed (checks, audit, or gate)
        const failedChecks = tryResult.failedChecks ?? [];
        const failedAudits = tryResult.failedAudits ?? [];
        const failedGate = tryResult.failedGate;

        // Update criteria
        currentQueue.specs[currentIdx] = {
          ...spec,
          criteria: [...tryResult.criterionResults],
          implementer: tryResult.implementer ?? spec.implementer,
        };
        spec = currentQueue.specs[currentIdx]!;

        const failureItems: string[] = [
          ...failedChecks,
          ...failedAudits,
          ...(failedGate ? [`gate '${failedGate}' failed`] : []),
        ];

        if (currentAttempt < maxTries) {
          // Extra tries remain (§3, §4, §6)
          const nextAttempt = currentAttempt + 1;
          const retryRes = transitionSpecState(spec, 'running', { attemptAction: 'increment' });
          const nextSpec = retryRes.ok ? retryRes.value : spec;

          currentQueue.specs[currentIdx] = {
            ...nextSpec,
            attempt: nextAttempt,
          };
          this.emit({ type: 'spec.changed', spec: currentQueue.specs[currentIdx]! });
          await this.persist(currentQueue);

          // Build retry message per §6
          retryMsg =
            'The previous try did not meet these criteria:\n' +
            failureItems.map((f) => `- ${f}`).join('\n');
          continue;
        } else {
          // Last try failed (§4, §8, SQ-08, SQ-09)
          const targetState: SpecState =
            queue.settings.on_fail === 'retry-stop' ? 'needs_you' : 'skipped';

          // First step through verifying/auditing before needs_you/skipped per §4 table
          const intermediateState: SpecState = failedChecks.length > 0 ? 'verifying' : 'auditing';
          const intermediateRes = transitionSpecState(spec, intermediateState);
          const interSpec = intermediateRes.ok ? intermediateRes.value : spec;

          const finalRes = transitionSpecState(interSpec, targetState);
          const finalSpec = finalRes.ok ? finalRes.value : interSpec;

          currentQueue.specs[currentIdx] = {
            ...finalSpec,
            attempt: currentAttempt,
          };
          this.emit({ type: 'spec.changed', spec: currentQueue.specs[currentIdx]! });
          await this.persist(currentQueue);

          // Dependents will become blocked (§8)
          await this.scheduleAndRun(queueId);
          break;
        }
      }
    } finally {
      this.activeJobs.delete(jobKey);
    }
  }

  private async processMerges(queueId: QueueId): Promise<void> {
    const queue = this.queues.get(queueId);
    if (!queue) return;

    while (true) {
      const nextToMerge = getNextSpecToMerge(queue.specs);
      if (!nextToMerge) {
        break;
      }

      const mergeRes = await mergeApprovedSpec(nextToMerge, {
        repoPath: queue.repoPath,
        git: this.deps.git,
        commandRunner: this.deps.commandRunner,
      });

      const currentIdx = queue.specs.findIndex((s) => s.id === nextToMerge.id);
      if (currentIdx === -1) break;

      if (!mergeRes.ok || (mergeRes.value && !mergeRes.value.success)) {
        // Rebase or checks failed: back to running (§4, §7, SQ-18)
        // attempt + 1, does not count against retries
        const runRes = transitionSpecState(queue.specs[currentIdx]!, 'running', {
          attemptAction: 'increment',
        });
        if (runRes.ok) {
          queue.specs[currentIdx] = runRes.value;
          this.emit({ type: 'spec.changed', spec: runRes.value });
          await this.persist(queue);
          void this.runSpecLifecycle(queueId, nextToMerge.id);
        }
        break;
      }

      // Merge succeeded: approved -> merged (§4, §7)
      const mergedRes = transitionSpecState(queue.specs[currentIdx]!, 'merged');
      if (mergedRes.ok) {
        queue.specs[currentIdx] = mergedRes.value;
        this.emit({ type: 'spec.changed', spec: mergedRes.value });
        await this.persist(queue);
      }
    }
  }
}
