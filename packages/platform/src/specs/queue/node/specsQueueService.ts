/**
 * SpecsQueueService: implements ISpecsService (docs/specs/spec-queue.md §4–§10).
 * State machine, scheduler with waves/overlap, retries, audits, gates, merge order, pause/resume/cancel.
 */
import { Emitter, err, ok, type Event } from '@orchagents/base';
import {
  AgentId as AgentIdSchema,
  type AccountId,
  type Account,
  type AgentAdapter,
  type AgentId,
  type FactoryStatus,
  type FactoryAnswers,
  type FactoryPipeline,
  type TrailResult,
  type PipelineRunState,
  type ISpecsService,
  type JobId,
  type OrchEvent,
  type QueueId,
  type Result,
  type Run,
  type RunId,
  type RunLine,
  type Session,
  type SessionId,
  type ShellId,
  type Os,
  type SpecId,
  type SpecLoadResult,
  type SpecQueue,
  type SpecQueueSettings,
  type SpecRun,
  type SpecState,
  type SpecUsageHour,
  type Timestamp,
} from '@orchagents/contracts';
import type { IGitService } from '../../../git/common/git.js';
import type { EngineClient } from '../../../engine/common/engineClient.js';
import type { IProfilesService } from '../../../profiles/common/profiles.js';
import type { Job, JobSpec } from '@orchagents/contracts';
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
import { readFactoryStatus } from '../../factory/node/factoryStatus.js';
import { answerFactoryGate as runFactoryGate, initFactoryProduct as runFactoryInit, listProductFiles, readProductFile as readProductFileFromRepo, readFactoryPipeline, readFactoryTrail, resolveFactoryPipelineScript } from '../../factory/node/factoryPipeline.js';
import { readRepoCheckPresets } from '../../checks/node/readCheckPresets.js';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { stringify } from 'yaml';
import { SpecDraft, SPEC_DEFAULT_AUDIT } from '@orchagents/contracts';
import type { SpecDraft as SpecDraftType } from '@orchagents/contracts';
import { readSpecFile } from '../../loader/node/specLoader.js';
import { loadSpecQueueSettings } from '../../loader/node/settings.js';
import { specDraftToCommand } from '../common/toCommand.js';
import { sameRepo } from '../../../paths/node/canonicalRepoPath.js';
import { watch, readdirSync, statSync, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { mkdir as makeDirectory, writeFile as writeTextFile } from 'node:fs/promises';
import { FactoryAnswers as FactoryAnswersSchema, PipelineRunState as PipelineRunStateSchema } from '@orchagents/contracts';

/** Keeps one readFactoryStatus run per repoPath; the UI polls it on every screen open. */
const FACTORY_STATUS_CACHE_TTL_MS = 10_000;

export interface SpecsQueueServiceDeps {
  git: IGitService;
  accounts?: { list(): Promise<Result<Account[]>>; markSignedOut?(accountId: AccountId): Promise<Result<void>> } | undefined;
  adapters?: readonly (AgentAdapter & { readonly signInErrorPattern?: RegExp })[] | undefined;
  quota?:
    | {
        pickAccount(agent: AgentId): Promise<Result<PickAccountResult>>;
      }
    | undefined;
  /** The runs of a job, so usage() can map a spec to its engine sessions. */
  runs?: { list(jobId: JobId): Promise<Result<Run[]>>; lines?(runId: RunId, afterSeq: number): Promise<Result<RunLine[]>>; send?(runId: RunId, text: string): Promise<Result<void>>; pause?(runId: RunId): Promise<Result<void>>; startNow?(runId: RunId): Promise<Result<void>> } | undefined;
  /** The engine ledger (ledger.query), like QuotaService spendsToday. */
  engine?: Pick<EngineClient, 'request'> & Partial<Pick<EngineClient, 'onEvent'>> | undefined;
  profiles?: IProfilesService | undefined;
  sessions?: { get(id: SessionId): Promise<Result<Session>> } | undefined;
  jobs?: {
    start(spec: JobSpec, options?: { worktreeRunId?: string; verifiedBy?: 'spec'; noWorktree?: boolean; noReview?: boolean }): Promise<Result<Job>>;
    get(jobId: JobId): Promise<Result<Job>>;
    cancel(jobId: JobId): Promise<Result<void>>;
    onEvent(listener: (event: OrchEvent) => void): { dispose(): void };
    recordSpecVerdict?(spec: SpecRun, jobId: JobId, criterionResults: readonly import('@orchagents/contracts').CriterionResult[], success: boolean, failureLines?: readonly string[]): Promise<void>;
    markSpecMerged?(repoPath: string, specId: string): Promise<void>;
    markSpecRefuted?(repoPath: string, specId: string, reason: string): Promise<void>;
  } | undefined;
  jobRunner?: ISpecJobRunner | undefined;
  commandRunner?: CommandRunner | undefined;
  /** The user's home, where the factory's plugin cache lives; defaults to os.homedir(). */
  homeDir?: string | undefined;
  terminal?: {
    openCommand(argv: readonly string[], env: Readonly<Record<string, string>>, cwd: string, cols: number, rows: number): Promise<Result<ShellId>>;
  } | undefined;
  os?: Os | undefined;
  onEvent?: ((event: OrchEvent) => void) | undefined;
  installedAgents?: readonly AgentId[] | undefined;
}

export class SpecsQueueService implements ISpecsService {
  private readonly emitter = new Emitter<OrchEvent>();
  readonly onEvent: Event<OrchEvent> = this.emitter.event;

  private readonly queues = new Map<QueueId, SpecQueue>();
  /** The single in-memory queue for each resolved repository path. */
  private readonly queueIdsByRepo = new Map<string, QueueId>();
  /** Coalesces simultaneous first loads so they cannot create competing queues. */
  private readonly loadsByRepo = new Map<string, Promise<Result<SpecLoadResult>>>();
  private readonly activeJobs = new Set<string>();
  /** Last readFactoryStatus result per repoPath, kept for 10 s so screen opens don't respawn the factory script. */
  private readonly factoryStatusCache = new Map<
    string,
    { at: number; value: Result<FactoryStatus | null> }
  >();
  private readonly productWatchers = new Map<string, FSWatcher[]>();
  private readonly productDebounce = new Map<string, NodeJS.Timeout>();
  private readonly productSnapshots = new Map<string, string>();
  private readonly productWatchFailures = new Set<string>();
  private readonly pipelineRuns = new Map<string, PipelineRunState>();
  private readonly jobEvents: { dispose(): void } | undefined;
  private intervalTimer: NodeJS.Timeout | null = null;
  private readonly runner: ISpecJobRunner;

  private async queueIdForRepo(repoPath: string): Promise<QueueId | undefined> {
    for (const [storedPath, queueId] of this.queueIdsByRepo) {
      if (await sameRepo(storedPath, repoPath)) return queueId;
    }
    return undefined;
  }

  constructor(private readonly deps: SpecsQueueServiceDeps) {
    if (deps.onEvent) {
      this.emitter.event(deps.onEvent);
    }
    this.jobEvents = deps.jobs?.onEvent((event) => this.onPipelineJobEvent(event));

    if (deps.jobRunner) {
      this.runner = deps.jobRunner;
    } else {
      const defaultQuota = {
        pickAccount: async (agent: AgentId): Promise<Result<PickAccountResult>> =>
          ok({ kind: 'account', accountId: `acct-${agent}` as AccountId }),
      };
      this.runner = new RealSpecJobRunner({
        git: deps.git,
        profiles: deps.profiles,
        engine: deps.engine,
        jobs: deps.jobs,
        runs: deps.runs,
        quota: deps.quota ?? defaultQuota,
        accounts: deps.accounts,
        adapters: deps.adapters,
        commandRunner: deps.commandRunner,
        installedAgents: deps.installedAgents,
        onJobStarted: async (spec, jobId) => this.recordJobStarted(spec, jobId),
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
    this.jobEvents?.dispose();
    for (const watchers of this.productWatchers.values()) for (const watcher of watchers) watcher.close();
    for (const timer of this.productDebounce.values()) clearTimeout(timer);
    this.productWatchers.clear();
    this.productDebounce.clear();
  }

  private onPipelineJobEvent(event: OrchEvent): void {
    if (event.type === 'run.line' && /\bGATE\b/i.test(event.line.text)) {
      void this.markRunWaitingForGate(event.line.runId);
    }
    if (event.type === 'job.changed' && ['done', 'failed', 'cancelled'].includes(event.job.status)) {
      const repoPath = event.job.spec.repoPath;
      const state = this.pipelineRuns.get(repoPath);
      if (state?.jobId !== event.job.id) return;
      void this.finishPipelineJob(repoPath, state, event.job.status);
    }
  }

  private async markRunWaitingForGate(runId: RunId): Promise<void> {
    for (const [repoPath, state] of this.pipelineRuns) {
      const runs = await this.deps.runs?.list(state.jobId);
      if (runs?.ok && runs.value.some((run) => run.id === runId)) {
        await this.savePipelineState(repoPath, { ...state, state: 'waiting_gate' });
        return;
      }
    }
  }

  private async finishPipelineJob(repoPath: string, state: PipelineRunState, status: Job['status']): Promise<void> {
    if (status === 'cancelled') return this.savePipelineState(repoPath, { ...state, state: 'stopped', reason: 'Stopped.' });
    if (status === 'failed') return this.savePipelineState(repoPath, { ...state, state: 'stopped', reason: 'The pipeline job failed.' });
    const pipeline = await this.readPipeline(repoPath);
    if (!pipeline.ok || !pipeline.value) return this.savePipelineState(repoPath, { ...state, state: 'stopped', reason: 'The pipeline status could not be read.' });
    if (pipeline.value.stages.some((stage) => stage.state === 'needs_you')) return this.savePipelineState(repoPath, { ...state, state: 'waiting_gate' });
    if (pipeline.value.stages.every((stage) => stage.state === 'done' || stage.state === 'have' || stage.state === 'skipped')) return this.savePipelineState(repoPath, { ...state, state: 'done', stage: null, reason: null });
    if (pipeline.value.now?.group === 'build') return this.savePipelineState(repoPath, { ...state, state: 'waiting_build', stage: pipeline.value.now.title });
    return this.savePipelineState(repoPath, { ...state, state: 'stopped', reason: 'The pipeline job ended before the stages were complete.' });
  }

  private emit(event: OrchEvent): void {
    if (event.type === 'spec.changed') {
      for (const repoPath of this.productWatchers.keys()) {
        void this.refreshProduct(repoPath);
        void this.resumeWaitingBuild(repoPath);
      }
    }
    this.emitter.fire(event);
  }

  private factoryOptions() {
    return { commandRunner: this.deps.commandRunner!, ...(this.deps.homeDir ? { home: this.deps.homeDir } : {}) };
  }

  private async readPipeline(repoPath: string): Promise<Result<FactoryPipeline | null>> {
    if (!this.deps.commandRunner) return err({ code: 'internal', message: 'The spec queue has no command runner, so the factory pipeline cannot run.', fix: 'Restart orch so the core host starts with all services.' });
    return readFactoryPipeline(repoPath, this.factoryOptions());
  }

  private pipelineFingerprint(pipeline: FactoryPipeline | null): string {
    if (!pipeline) return 'null';
    return JSON.stringify({ stages: pipeline.stages, counts: pipeline.counts, groups: pipeline.groups });
  }

  private watchProduct(repoPath: string): void {
    if (this.productWatchers.has(repoPath)) return;
    const watchers: FSWatcher[] = [];
    const roots = [repoPath, path.join(repoPath, '.factory'), path.join(repoPath, 'docs'), path.join(repoPath, 'design'), path.join(repoPath, 'specs', 'queue')];
    const watched = new Set<string>();
    const addTree = (root: string, deep: boolean): void => {
      if (watched.has(root)) return;
      watched.add(root);
      try {
        const watcher = watch(root, (eventType, filename) => {
          const name = String(filename ?? '');
          if (root === repoPath && name !== 'decisions.tsv') return;
          if (deep && eventType === 'rename' && name) {
            try { if (statSync(path.join(root, name)).isDirectory()) addTree(path.join(root, name), true); } catch { /* Removed paths need no watcher. */ }
          }
          this.scheduleProductRefresh(repoPath);
        });
        watcher.on('error', () => { this.productWatchFailures.add(repoPath); watcher.close(); });
        watchers.push(watcher);
      } catch { /* Directories may not exist yet; the next explicit read still works. */ }
      if (deep) {
        try {
          for (const entry of readdirSync(root, { withFileTypes: true })) if (entry.isDirectory()) addTree(path.join(root, entry.name), true);
        } catch { /* A directory can disappear while watches are being installed. */ }
      }
    };
    for (const root of roots) addTree(root, root !== repoPath && root !== path.join(repoPath, '.factory'));
    this.productWatchers.set(repoPath, watchers);
  }

  private scheduleProductRefresh(repoPath: string): void {
    const old = this.productDebounce.get(repoPath);
    if (old) clearTimeout(old);
    const timer = setTimeout(() => {
      this.productDebounce.delete(repoPath);
      void this.refreshProduct(repoPath);
    }, 500);
    this.productDebounce.set(repoPath, timer);
  }

  private async refreshProduct(repoPath: string): Promise<void> {
    const result = await this.readPipeline(repoPath);
    if (!result.ok) return;
    const fingerprint = this.pipelineFingerprint(result.value);
    if (this.productSnapshots.get(repoPath) === fingerprint) return;
    this.productSnapshots.set(repoPath, fingerprint);
    const run = this.pipelineRuns.get(repoPath);
    if (run?.state === 'waiting_gate') {
      const gate = result.value?.stages.find((stage) => stage.gate && stage.answer);
      if (gate) await this.resumePipelineAfterGate(repoPath, gate.id);
    }
    this.emitter.fire({ type: 'product.changed', repoPath });
  }

  private async productChanged(repoPath: string): Promise<void> {
    const state = await this.readPipeline(repoPath);
    if (state.ok) this.productSnapshots.set(repoPath, this.pipelineFingerprint(state.value));
    this.emitter.fire({ type: 'product.changed', repoPath });
  }

  private async getPipelineScript(repoPath: string): Promise<string | null> {
    if (!this.deps.commandRunner) return null;
    return resolveFactoryPipelineScript(repoPath, this.factoryOptions());
  }

  private async persistPipelineRun(repoPath: string, state: PipelineRunState): Promise<void> {
    try {
      await makeDirectory(path.join(repoPath, '.orch'), { recursive: true });
      await writeTextFile(path.join(repoPath, '.orch', 'product-run.json'), JSON.stringify(state, null, 2), 'utf8');
    } catch { /* The in-memory state remains available; read errors are surfaced on next start. */ }
  }

  private async loadPipelineRun(repoPath: string): Promise<PipelineRunState | null> {
    try {
      const checked = PipelineRunStateSchema.safeParse(JSON.parse(await readFile(path.join(repoPath, '.orch', 'product-run.json'), 'utf8')));
      if (!checked.success) return null;
      this.pipelineRuns.set(repoPath, checked.data);
      return checked.data;
    } catch { return null; }
  }

  private async savePipelineState(repoPath: string, state: PipelineRunState): Promise<void> {
    this.pipelineRuns.set(repoPath, state);
    await this.persistPipelineRun(repoPath, state);
    await this.productChanged(repoPath);
  }

  private async resumePipelineAfterGate(repoPath: string, gateId: string): Promise<void> {
    const state = this.pipelineRuns.get(repoPath);
    if (!state || state.state !== 'waiting_gate') return;
    const runService = this.deps.runs;
    const runs = await runService?.list(state.jobId);
    if (runs?.ok && runService?.send && runService.startNow) {
      const run = [...runs.value].reverse().find((candidate) => candidate.sessionId);
      if (run?.sessionId) {
        await runService.send(run.id, `The operator answered ${gateId}. Run factory next and continue.`);
        if (run.status !== 'running') await runService.startNow(run.id);
      }
    }
    await this.savePipelineState(repoPath, { ...state, state: 'working', reason: null });
  }

  private async resumePipelineBuild(repoPath: string): Promise<void> {
    const state = this.pipelineRuns.get(repoPath);
    if (!state || state.state !== 'waiting_build') return;
    const runService = this.deps.runs;
    const runs = await runService?.list(state.jobId);
    const run = runs?.ok ? [...runs.value].reverse().find((candidate) => candidate.sessionId) : undefined;
    if (run?.sessionId && runService?.send && runService.startNow) {
      await runService.send(run.id, 'The spec queue finished the build stage. Run factory next and continue.');
      if (run.status !== 'running') await runService.startNow(run.id);
      await this.savePipelineState(repoPath, { ...state, state: 'working', reason: null });
    }
  }

  private async resumeWaitingBuild(repoPath: string): Promise<void> {
    const state = this.pipelineRuns.get(repoPath);
    if (!state || state.state !== 'waiting_build') return;
    const queueId = await this.queueIdForRepo(repoPath);
    const queue = queueId ? this.queues.get(queueId) : undefined;
    const hasWork = queue?.specs.some((spec) => ['queued', 'running', 'verifying', 'auditing', 'waiting_quota', 'needs_you', 'approved'].includes(spec.state)) ?? false;
    if (!hasWork) await this.resumePipelineBuild(repoPath);
  }

  private async persist(queue: SpecQueue): Promise<void> {
    await saveQueueState(queue);
  }

  private async recordJobStarted(spec: SpecRun, jobId: JobId): Promise<void> {
    let queue = this.queues.get(spec.queueId);
    if (!queue) {
      queue = Array.from(this.queues.values()).find((q) => q.specs.some((candidate) => candidate.id === spec.id));
    }
    const index = queue?.specs.findIndex((candidate) => candidate.id === spec.id) ?? -1;
    if (!queue || index < 0) return;
    // The run starts only after the platform job has been created. Re-assert
    // the live state alongside the job link so clients always receive a single
    // authoritative update they can use to open the run immediately.
    const updated = { ...queue.specs[index]!, queueId: queue.id, state: 'running' as const, jobId };
    queue.specs[index] = updated;
    this.emit({ type: 'spec.changed', spec: updated });
    await this.persist(queue);
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

  async toCommand(draft: SpecDraftType): Promise<Result<string>> {
    const parsed = SpecDraft.safeParse(draft);
    if (!parsed.success) return err({ code: 'validation_failed', message: parsed.error.message, fix: 'Correct the new spec fields and try again.' });
    return ok(specDraftToCommand(parsed.data));
  }

  async create(repoPath: string, input: SpecDraftType): Promise<Result<SpecRun>> {
    const parsed = SpecDraft.safeParse(input);
    if (!parsed.success) return err({ code: 'validation_failed', message: parsed.error.message, fix: 'Correct the new spec fields and try again.' });
    const draft = parsed.data;
    const settings = await loadSpecQueueSettings(repoPath);
    if (!settings.ok) return settings;
    const folder = path.resolve(repoPath, settings.value.source);
    let names: string[];
    try {
      await mkdir(folder, { recursive: true });
      names = (await readdir(folder)).filter((name) => name.endsWith('.md'));
    } catch (error) {
      return err({ code: 'internal', message: `Failed to read specs folder: ${(error as Error).message}`, fix: 'Check write permissions for the specs folder.' });
    }
    const ids = names.map((n) => n.match(/^(\d+)-/)?.[1]).filter((v): v is string => !!v).map(Number);
    const id = String(Math.max(0, ...ids) + 1);
    const dependsOn = Array.from(new Set(draft.depends_on));
    if (dependsOn.length > 0) {
      const existing = await loadSpecQueue(repoPath);
      if (!existing.ok) return existing;
      const queue = existing.value.queue;
      if (!queue) {
        return err({
          code: 'validation_failed',
          message: existing.value.problems[0]?.message ?? 'The spec queue could not be loaded, so dependencies cannot be checked.',
          fix: 'Fix the spec load problems with orch specs check, then try again.',
        });
      }
      const known = new Set(queue.specs.map((spec) => String(spec.id)));
      const unknown = dependsOn.find((dep) => !known.has(dep));
      if (unknown !== undefined) {
        return err({
          code: 'validation_failed',
          message: `Spec ${id} depends on ${unknown}, which doesn't exist.`,
          fix: 'Choose a spec that already exists, then try again.',
        });
      }
    }
    const slug = draft.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '') || 'spec';
    const fileName = `${id.padStart(3, '0')}-${slug}.md`;
    const fullPath = path.join(folder, fileName);
    const relativeFile = path.relative(repoPath, fullPath).replaceAll('\\', '/');
    if (names.includes(fileName)) return err({ code: 'conflict', message: `Spec file ${relativeFile} already exists.`, fix: 'Rename the existing file or change the spec title, then try again.' });
    const doneWhen = draft.done_when.length ? draft.done_when : [{ by: 'audit' as const, text: SPEC_DEFAULT_AUDIT }];
    const frontMatter = { id, title: draft.title, depends_on: dependsOn, scope: draft.scope, done_when: doneWhen, agent: draft.agent,
      ...(draft.mode !== 'single' ? { mode: draft.mode } : {}), ...(draft.agents.length ? { agents: draft.agents } : {}) };
    try {
      await writeFile(fullPath, `---\n${stringify(frontMatter)}---\n\n${draft.body}\n`, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return err({ code: 'conflict', message: `Spec file ${relativeFile} already exists.`, fix: 'Rename the existing file or change the spec title, then try again.' });
      }
      return err({ code: 'internal', message: `Failed to write spec file ${relativeFile}: ${(error as Error).message}`, fix: 'Check write permissions for the specs folder.' });
    }
    const loadedSpec = await readSpecFile(repoPath, relativeFile);
    if (!loadedSpec.ok) return err({ code: 'internal', message: `Created spec could not be loaded: ${loadedSpec.error.message}`, fix: 'Check the spec fields and try again.' });
    const repoKey = repoPath;
    const previousId = await this.queueIdForRepo(repoPath);
    const previous = previousId ? this.queues.get(previousId) : undefined;
    let queue: SpecQueue;
    if (previous) {
      const refreshed = await loadSpecQueue(repoPath);
      if (!refreshed.ok) return refreshed;
      if (!refreshed.value.queue) return err({ code: 'validation_failed', message: refreshed.value.problems[0]?.message ?? 'The new spec could not be added to the queue.', fix: 'Fix the spec load problems and try again.' });
      const byId = new Map(previous.specs.map((s) => [s.id, s]));
      queue = {
        ...refreshed.value.queue,
        ...previous,
        specs: refreshed.value.queue.specs.map((s) => {
          const old = byId.get(s.id);
          return old ? { ...s, ...old, spec: s.spec, file: s.file, queueId: previous.id } : { ...s, queueId: previous.id };
        }),
      };
    } else {
      const loaded = await this.load(repoPath);
      if (!loaded.ok) return loaded;
      if (!loaded.value.queue) return err({ code: 'validation_failed', message: loaded.value.problems[0]?.message ?? 'The new spec could not be added to the queue.', fix: 'Fix the spec load problems and try again.' });
      queue = loaded.value.queue;
    }
    const newRun = queue.specs.find((s) => s.id === id);
    if (!newRun) return err({ code: 'internal', message: 'The new spec was not found after loading.', fix: 'Reload the spec queue and try again.' });
    if (draft.runNext) {
      const ordered = [...queue.specs];
      const item = ordered.find((s) => s.id === id)!;
      const queued = ordered.filter((s) => s.id !== id && s.state === 'queued');
      item.position = 1;
      queued.forEach((s, i) => { s.position = i + 2; });
      queue.specs = ordered.sort((a, b) => a.position - b.position);
    }
    this.queues.set(queue.id, queue);
    this.queueIdsByRepo.set(repoKey, queue.id);
    await this.persist(queue);
    const result = queue.specs.find((s) => s.id === id)!;
    this.emit({ type: 'spec.changed', spec: result });
    this.emit({ type: 'queue.changed', queue });
    if (!queue.paused) await this.scheduleAndRun(queue.id);
    return ok(result);
  }

  /**
   * SaaS Factory status of the project (services.ts ISpecsService.factoryStatus).
   * The factory's own script answers; results are cached per repoPath for 10 s,
   * so opening screens doesn't spawn a process every time.
   */
  async factoryStatus(repoPath: string): Promise<Result<FactoryStatus | null>> {
    const cached = this.factoryStatusCache.get(repoPath);
    if (cached && Date.now() - cached.at < FACTORY_STATUS_CACHE_TTL_MS) {
      return cached.value;
    }

    const commandRunner = this.deps.commandRunner;
    if (!commandRunner) {
      return err({
        code: 'internal',
        message: 'The spec queue has no command runner, so the factory status cannot run.',
        fix: 'Restart orch so the core host starts with all services.',
      });
    }

    const value = await readFactoryStatus(repoPath, {
      commandRunner,
      ...(this.deps.homeDir !== undefined ? { home: this.deps.homeDir } : {}),
    });
    this.factoryStatusCache.set(repoPath, { at: Date.now(), value });
    return value;
  }

  async factoryPipeline(repoPath: string): Promise<Result<FactoryPipeline | null>> {
    this.watchProduct(repoPath);
    const res = await this.readPipeline(repoPath);
    if (res.ok) this.productSnapshots.set(repoPath, this.pipelineFingerprint(res.value));
    return res;
  }

  async answerFactoryGate(repoPath: string, gateId: string, words: string): Promise<Result<FactoryPipeline>> {
    const res = await runFactoryGate(repoPath, gateId, words, this.factoryOptions());
    if (res.ok) {
      const state = this.pipelineRuns.get(repoPath);
      if (state?.state === 'waiting_gate') await this.resumePipelineAfterGate(repoPath, gateId);
      await this.productChanged(repoPath);
    }
    return res;
  }

  async initFactoryProduct(repoPath: string, answers: FactoryAnswers): Promise<Result<FactoryPipeline>> {
    const parsed = FactoryAnswersSchema.safeParse(answers);
    if (!parsed.success) return err({ code: 'validation_failed', message: 'The product setup answers are invalid.', fix: 'Review the wizard answers and try again.' });
    const res = await runFactoryInit(repoPath, parsed.data, this.factoryOptions());
    if (res.ok) await this.productChanged(repoPath);
    return res;
  }

  async factoryTrail(repoPath: string): Promise<Result<TrailResult>> {
    return readFactoryTrail(repoPath);
  }

  async productFiles(repoPath: string) {
    return listProductFiles(repoPath);
  }

  async readProductFile(repoPath: string, relPath: string) {
    return readProductFileFromRepo(repoPath, relPath);
  }

  async startPipelineRun(repoPath: string): Promise<Result<JobId>> {
    const current = this.pipelineRuns.get(repoPath) ?? await this.loadPipelineRun(repoPath);
    if (current && current.state === 'paused') {
      const runs = await this.deps.runs?.list(current.jobId);
      if (runs?.ok) for (const run of runs.value) if (run.status !== 'running' && run.sessionId) await this.deps.runs?.startNow?.(run.id);
      await this.savePipelineState(repoPath, { ...current, state: 'working', reason: null });
      return ok(current.jobId);
    }
    if (current && ['working', 'waiting_gate', 'waiting_build'].includes(current.state)) return ok(current.jobId);
    const pipeline = await this.factoryPipeline(repoPath);
    if (!pipeline.ok) return pipeline;
    if (!pipeline.value) return err({ code: 'not_found', message: 'This project has not been set up as a product.', fix: 'Set up the pipeline first.' });
    let configuredAgent: AgentId | undefined;
    try {
      const plan = JSON.parse(await readFile(path.join(repoPath, '.factory', 'plan.json'), 'utf8')) as { answers?: { agent?: unknown } };
      const parsedAgent = AgentIdSchema.safeParse(plan.answers?.agent);
      if (parsedAgent.success) configuredAgent = parsedAgent.data;
    } catch { /* An auto answer or older plan uses the installed agent fallback. */ }
    const agent = configuredAgent ?? this.deps.installedAgents?.[0];
    if (!agent) return err({ code: 'not_found', message: 'No signed-in agent is available to build this product.', fix: 'Sign in to an agent, then start the pipeline again.' });
    const scriptPath = await this.getPipelineScript(repoPath);
    if (!scriptPath) return err({ code: 'not_found', ...({ message: 'This SaaS Factory doesn’t have the pipeline yet.', fix: 'Update it with npx github:devwaheed/saas-factory.' }) });
    const goal = `Run the SaaS Factory pipeline in ${repoPath}. Use node ${scriptPath} next ${repoPath} to get exactly one task. Do exactly that one task with the skill it names. Verify its OUTPUT exists. Log with node ${scriptPath} log ${repoPath} <stage> decision "<what and why>" --evidence <file>, then run next again. STOP and end your turn when next prints a GATE; never answer a gate. When the factory build stage is next and the spec queue has work, stop and let the queue run; orch will resume you when the build stage is done. Stop when every stage is done.`;
    const spec: JobSpec = { mode: 'single', goal, repoPath, orchestrator: { agent, account: 'auto' }, workers: [agent], checks: [], onLimit: 'switch-account' };
    const job = await this.deps.jobs?.start(spec, { noWorktree: true, noReview: true });
    if (!job) return err({ code: 'internal', message: 'The job service is unavailable.', fix: 'Restart orch and try again.' });
    if (!job.ok) return job;
    const state = PipelineRunStateSchema.parse({ jobId: job.value.id, state: 'working', stage: pipeline.value.now?.title ?? null, reason: null });
    await this.savePipelineState(repoPath, state);
    return ok(job.value.id);
  }

  async pausePipelineRun(repoPath: string): Promise<Result<void>> {
    const state = this.pipelineRuns.get(repoPath) ?? await this.loadPipelineRun(repoPath);
    if (!state) return err({ code: 'not_found', message: 'There is no pipeline run to pause.', fix: 'Start the pipeline first.' });
    const runService = this.deps.runs;
    const runs = await runService?.list(state.jobId);
    if (runs?.ok && runService?.pause) for (const run of runs.value) if (run.status === 'running') await runService.pause(run.id);
    const next = { ...state, state: 'paused' as const };
    await this.savePipelineState(repoPath, next);
    return ok(undefined);
  }

  async stopPipelineRun(repoPath: string): Promise<Result<void>> {
    const state = this.pipelineRuns.get(repoPath) ?? await this.loadPipelineRun(repoPath);
    if (!state) return err({ code: 'not_found', message: 'There is no pipeline run to stop.', fix: 'Start the pipeline first.' });
    const cancelled = await this.deps.jobs?.cancel(state.jobId);
    if (cancelled && !cancelled.ok) return cancelled;
    await this.savePipelineState(repoPath, { ...state, state: 'stopped', reason: 'Stopped by you.' });
    return ok(undefined);
  }

  async pipelineRun(repoPath: string): Promise<Result<PipelineRunState | null>> {
    this.watchProduct(repoPath);
    return ok(this.pipelineRuns.get(repoPath) ?? await this.loadPipelineRun(repoPath));
  }

  async load(repoPath: string): Promise<Result<SpecLoadResult>> {
    const currentQueueId = await this.queueIdForRepo(repoPath);
    if (currentQueueId) {
      const queue = this.queues.get(currentQueueId);
      if (queue) {
        const checkPresets = await readRepoCheckPresets(repoPath);
        return ok({ queue, problems: [], checkPresets });
      }
      for (const [storedPath, queueId] of this.queueIdsByRepo) {
        if (queueId === currentQueueId && await sameRepo(storedPath, repoPath)) this.queueIdsByRepo.delete(storedPath);
      }
    }

    for (const [storedPath, loading] of this.loadsByRepo) {
      if (await sameRepo(storedPath, repoPath)) return loading;
    }
    const resolvedRepoPath = repoPath;

    const loading = this.loadRepo(resolvedRepoPath);
    this.loadsByRepo.set(resolvedRepoPath, loading);
    try {
      return await loading;
    } finally {
      if (this.loadsByRepo.get(resolvedRepoPath) === loading) {
        this.loadsByRepo.delete(resolvedRepoPath);
      }
    }
  }

  private async loadRepo(repoPath: string): Promise<Result<SpecLoadResult>> {
    const [loadedRes, checkPresets] = await Promise.all([loadSpecQueue(repoPath), readRepoCheckPresets(repoPath)]);
    if (!loadedRes.ok) {
      return loadedRes;
    }

    const { queue: freshQueue, problems } = loadedRes.value;
    if (problems.length > 0 || !freshQueue) {
      return ok({ queue: null, problems: [...problems], checkPresets });
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
            note: saved.note,
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
        specs: recoveredSpecs.map((s) => ({ ...s, queueId: persisted.id })),
      };
    }

    this.queues.set(finalQueue.id, finalQueue);
    this.queueIdsByRepo.set(repoPath, finalQueue.id);
    await this.persist(finalQueue);

    return ok({ queue: finalQueue, problems: [], checkPresets });
  }

  initQueue(queue: SpecQueue): void {
    const repoPath = queue.repoPath;
    const existingId = this.queueIdsByRepo.get(repoPath);
    if (existingId && existingId !== queue.id && this.queues.has(existingId)) return;
    this.queues.set(queue.id, queue);
    this.queueIdsByRepo.set(repoPath, queue.id);
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
      return err({ code: 'not_found', message: `Spec ${specId} not found in queue ${queueId} while skipping.` });
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
      return err({ code: 'not_found', message: `Spec ${specId} not found in queue ${queueId} while retrying.` });
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

  /**
   * Re-runs verify checks + audit on the worktree as it is now, without starting a new implementation turn (§6).
   * Counted as a manual check; does not use up tries.
   * If everything is met, the spec becomes verified and appears in Review as usual (§7).
   */
  async recheck(queueId: QueueId, specId: SpecId): Promise<Result<SpecRun>> {
    const qRes = await this.get(queueId);
    if (!qRes.ok) return qRes;
    const queue = qRes.value;

    const specIdx = queue.specs.findIndex((s) => s.id === specId);
    if (specIdx === -1) {
      return err({ code: 'not_found', message: `Spec ${specId} not found in queue ${queueId} while rechecking.` });
    }

    const spec = queue.specs[specIdx]!;
    const runner = this.runner;
    const recheckResult = runner.recheck
      ? await runner.recheck(spec, queue.repoPath, queue.settings)
      : await runner.runTry(spec, queue.repoPath, queue.settings);

    const updatedCriteria = [...recheckResult.criterionResults];
    queue.specs[specIdx] = {
      ...queue.specs[specIdx]!,
      criteria: updatedCriteria,
    };

    if (recheckResult.success) {
      const verifiedRes = transitionSpecState(queue.specs[specIdx]!, 'verified');
      const finalSpec = verifiedRes.ok ? verifiedRes.value : queue.specs[specIdx]!;
      const finishedSpec: SpecRun = {
        ...finalSpec,
        state: 'verified',
        criteria: updatedCriteria,
        finishedAt: new Date().toISOString() as Timestamp,
        history: [
          ...finalSpec.history,
          { state: 'verified' as SpecState, at: new Date().toISOString() as Timestamp, attempt: finalSpec.attempt },
        ],
      };
      queue.specs[specIdx] = finishedSpec;
      if (this.deps.jobs?.recordSpecVerdict && finishedSpec.jobId) {
        await this.deps.jobs.recordSpecVerdict(finishedSpec, finishedSpec.jobId, updatedCriteria, true);
      }
      this.emit({ type: 'spec.changed', spec: finishedSpec });
      await this.persist(queue);
      await this.scheduleAndRun(queueId);
      return ok(finishedSpec);
    } else {
      const current = queue.specs[specIdx]!;
      if (this.deps.jobs?.recordSpecVerdict && current.jobId) {
        await this.deps.jobs.recordSpecVerdict(current, current.jobId, updatedCriteria, false, recheckResult.failedChecks ?? []);
      }
      this.emit({ type: 'spec.changed', spec: current });
      await this.persist(queue);
      return ok(current);
    }
  }

  /**
   * Opens an interactive terminal running the spec's implementer agent CLI in its worktree,
   * with the implementer's sessionEnv, resuming the last session when supported.
   */
  async openTerminal(queueId: QueueId, specId: SpecId, cols: number, rows: number): Promise<Result<ShellId>> {
    const qRes = await this.get(queueId);
    if (!qRes.ok) return qRes;
    const queue = qRes.value;

    const spec = queue.specs.find((s) => s.id === specId);
    if (!spec) {
      return err({ code: 'not_found', message: `Spec ${specId} not found in queue ${queueId}.` });
    }

    if (!this.deps.terminal) {
      return err({ code: 'internal', message: 'Terminal service is not available.', fix: 'Restart orch.' });
    }

    const worktreePath = path.join(queue.repoPath, '.orch', 'wt', `spec-${spec.id}`);
    if (!fs.existsSync(worktreePath)) {
      await mkdir(worktreePath, { recursive: true });
    }

    let implAgent: AgentId = spec.implementer?.agent ?? (spec.spec.agent !== 'auto' ? (spec.spec.agent as AgentId) : 'claude');
    let implAccountId: AccountId = spec.implementer?.accountId ?? ('default' as AccountId);

    let resumeSessionId: string | null = null;
    if (spec.jobId && this.deps.runs) {
      const runsList = await this.deps.runs.list(spec.jobId);
      if (runsList.ok) {
        const lastRun = runsList.value.slice().reverse().find((r) => r.sessionId);
        if (lastRun) {
          if (lastRun.accountId && implAccountId === 'default') {
            implAccountId = lastRun.accountId;
          }
          if (lastRun.agent) {
            implAgent = lastRun.agent;
          }
          if (lastRun.sessionId) {
            if (this.deps.sessions) {
              const sessionRes = await this.deps.sessions.get(lastRun.sessionId);
              if (sessionRes.ok) {
                if (sessionRes.value.cliSessionId) {
                  resumeSessionId = sessionRes.value.cliSessionId;
                }
                if (sessionRes.value.accountId && implAccountId === 'default') {
                  implAccountId = sessionRes.value.accountId;
                }
                if (sessionRes.value.agent) {
                  implAgent = sessionRes.value.agent;
                }
              }
            } else {
              resumeSessionId = lastRun.sessionId;
            }
          }
        }
      }
    }

    const accountsList = await this.deps.accounts?.list();
    if (!spec.implementer && implAccountId === 'default' && accountsList?.ok) {
      const acct = accountsList.value.find((a) => a.agent === implAgent && a.use);
      if (acct) implAccountId = acct.id;
    }

    const os = this.deps.os ?? (process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux');
    const adapter = this.deps.adapters?.find((a) => a.id === implAgent);
    if (!adapter) {
      return err({ code: 'internal', message: `No adapter available for ${implAgent}.`, fix: 'Install and configure the agent in Accounts.' });
    }

    let profileDir = '';
    const matchedAcct = accountsList?.ok ? accountsList.value.find((a) => a.id === implAccountId) : undefined;
    if (matchedAcct?.profileDir) {
      profileDir = matchedAcct.profileDir;
    }

    const cmdSpec = adapter.resumeCommand
      ? adapter.resumeCommand(profileDir, os, resumeSessionId)
      : { argv: [adapter.command], env: adapter.accountEnv(profileDir, os) };

    let sessionEnv: Record<string, string> = {};
    if (this.deps.profiles && implAccountId !== 'default') {
      const envRes = await this.deps.profiles.sessionEnv(implAccountId);
      if (envRes.ok) {
        sessionEnv = { ...envRes.value };
      }
    }

    const env: Record<string, string> = {
      ...cmdSpec.env,
      ...sessionEnv,
    };
    const argv = os === 'windows' && cmdSpec.argv[0]?.endsWith('.mjs')
      ? [process.execPath, ...cmdSpec.argv]
      : cmdSpec.argv;

    return this.deps.terminal.openCommand(argv, env, worktreePath, cols, rows);
  }

  /** Tokens and cost of the spec's runs per clock hour, oldest first (services.ts ISpecsService.usage). */
  async usage(queueId: QueueId, specId: SpecId): Promise<Result<SpecUsageHour[]>> {
    const queue = this.queues.get(queueId);
    const spec = queue?.specs.find((s) => s.id === specId);
    if (!queue) {
      return err({
        code: 'not_found',
        message: `Spec queue ${queueId} is not loaded for usage of spec ${specId}.`,
        fix: 'Reload the spec queue, then try again.',
      });
    }
    if (!spec) {
      return err({
        code: 'not_found',
        message: `Spec ${specId} not found in queue ${queueId} while loading usage.`,
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

      if (s.state === 'running' || s.state === 'verifying' || s.state === 'auditing' || s.state === 'waiting_quota') {
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
      return err({ code: 'not_found', message: `Spec ${specId} not found in queue ${queueId} while approving.` });
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

  /** Review routes spec work through the queue so §7 ordering and re-verification always apply. */
  async approveByWorktree(repoPath: string, specId: SpecId): Promise<Result<void>> {
    const existingId = await this.queueIdForRepo(repoPath);
    let queue = existingId ? this.queues.get(existingId) : undefined;
    if (!queue) {
      // Review can be opened before Specs after a core-host restart. Restore the
      // repo's persisted state before routing approval, preserving verified state.
      const loaded = await this.load(repoPath);
      if (!loaded.ok) return loaded;
      queue = loaded.value.queue ?? undefined;
      if (!queue) {
        return err({ code: 'not_found', message: `No spec queue found in ${repoPath} while approving spec ${specId}.` });
      }
    }
    return this.approve(queue.id, specId);
  }

  async requestChanges(queueId: QueueId, specId: SpecId, feedback: string): Promise<Result<void>> {
    const qRes = await this.get(queueId);
    if (!qRes.ok) return qRes;
    const queue = qRes.value;

    const specIdx = queue.specs.findIndex((s) => s.id === specId);
    if (specIdx === -1) {
      return err({ code: 'not_found', message: `Spec ${specId} not found in queue ${queueId} while requesting changes.` });
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

        if (spec.note != null) {
          spec = { ...spec, note: null };
          queue.specs[specIdx] = spec;
          this.emit({ type: 'spec.changed', spec });
          await this.persist(queue);
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

        const specJobId = spec.jobId;
        if (specJobId && !tryResult.limited) {
          const failureLines = [
            ...(tryResult.failedChecks ?? []),
            ...(tryResult.failedAudits ?? []),
            ...(tryResult.failedGate ? [`gate '${tryResult.failedGate}' failed`] : []),
          ];
          await this.deps.jobs?.recordSpecVerdict?.(spec, specJobId, tryResult.criterionResults, tryResult.success, failureLines);
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
          const conciseFailures = failureItems.map((failure) => {
            const firstLine = failure.split(/\r?\n/, 1)[0]?.trim() ?? '';
            // A failed engine job can echo the entire goal, including an earlier
            // retry prompt. Keep only the latest, useful one-line diagnostic.
            const summary = firstLine.replace(/^Job failed:\s*/i, '').trim();
            const usefulSummary = /^The previous try did not meet these criteria:/i.test(summary) ? 'Job failed' : summary;
            return (usefulSummary || 'Job failed').slice(0, 200);
          });
          retryMsg =
            'The previous try did not meet these criteria:\n' +
            conciseFailures.map((f) => `- ${f}`).join('\n');
          continue;
        } else {
          // Last try failed (§4, §8, SQ-08, SQ-09)
          const targetState: SpecState =
            queue.settings.on_fail === 'retry-stop' ? 'needs_you' : 'skipped';

          // Walk the allowed state path before needs_you/skipped (§4). A failed
          // audit follows running -> verifying -> auditing -> needs_you/skipped.
          let interSpec = spec;
          if (failedChecks.length > 0 || failedAudits.length > 0 || failedGate) {
            const verifying = transitionSpecState(interSpec, 'verifying');
            if (verifying.ok) interSpec = verifying.value;
          }
          if (failedChecks.length === 0) {
            const auditing = transitionSpecState(interSpec, 'auditing');
            if (auditing.ok) interSpec = auditing.value;
          }

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
        await this.deps.jobs?.markSpecRefuted?.(queue.repoPath, nextToMerge.id, mergeRes.ok ? (mergeRes.value?.failureMessage ?? 'Reverification failed after rebase') : mergeRes.error.message);
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
        await this.deps.jobs?.markSpecMerged?.(queue.repoPath, nextToMerge.id);
      }
    }
  }
}
