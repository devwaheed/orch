/**
 * Service interfaces of the core host. These are the ONLY way clients (the
 * window, the CLI, orch-mcp, tests) talk to orch. Each service is reachable
 * through the same interface over three transports: in-process (tests),
 * MessagePort (desktop window), JSON-RPC on a local socket (CLI, MCP).
 *
 * Rules:
 * - Every method returns Promise<Result<T>>; nothing throws across a boundary.
 * - Arguments and results are plain data that pass the schemas in this package.
 * - Adding a method is a contract change: update docs/contracts.md and get it approved.
 */
import type { AddAccountRequest, Account, AgentInfo, SignInResult } from './accounts.js';
import type { AccountsFile } from './config.js';
import type { DoctorReport, DoctorRunRequest } from './doctor.js';
import type { Result } from './errors.js';
import type { OrchEvent } from './events.js';
import type { AccountId, AgentId, JobId, RunId, SessionId, ShellId, WorktreeId } from './ids.js';
import type { Job, JobSpec, Run, RunLine } from './jobs.js';
import type { PickAccountResult, QuotaWindow, SpendToday } from './quota.js';
import type { CorrectionLayer, WorktreeReview } from './review.js';
import type { ResumeOption, ResumeRequest, Session, SessionStatus } from './sessions.js';
import type { TrustLevel, TrustSummary } from './trust.js';
import type { RoutingRule } from './config.js';
import type { FactoryStatus } from './factory.js';
import type { QueueId, SpecDraft, SpecId, SpecInitReport, SpecLoadProblem, SpecQueue, SpecQueueSettings, SpecRun, SpecUsageHour } from './specs.js';
import type { BugReportSaveRequest, BugReportSaveResult } from './bugreport.js';

export interface IAccountsService {
  listAgents(): Promise<Result<AgentInfo[]>>;
  list(): Promise<Result<Account[]>>;
  /** Creates the profile folder; does not sign in yet. */
  add(req: AddAccountRequest): Promise<Result<Account>>;
  /** Opens the agent's own sign-in, then runs the three checks. */
  signIn(accountId: AccountId): Promise<Result<SignInResult>>;
  /** Starts the agent's own sign-in in a terminal (a shell the UI shows); checkSignIn runs the checks after it exits. */
  openSignIn(accountId: AccountId, cols: number, rows: number): Promise<Result<ShellId>>;
  /**
   * Runs the three checks without starting a sign-in (after openSignIn's terminal ends).
   * userConfirmed: the user chose "I’m signed in" and orch closed the terminal; for an agent
   * without a status command that is the evidence instead of the login's exit code.
   */
  checkSignIn(accountId: AccountId, userConfirmed: boolean): Promise<Result<SignInResult>>;
  setPrimary(accountId: AccountId): Promise<Result<void>>;
  setUse(accountId: AccountId, use: boolean): Promise<Result<void>>;
  setRouting(rule: RoutingRule): Promise<Result<void>>;
  setShareSkills(agent: AgentId, share: boolean): Promise<Result<void>>;
  remove(accountId: AccountId): Promise<Result<void>>;
  /** The accounts.yaml text as it should be on disk */
  getConfig(): Promise<Result<{ text: string; parsed: AccountsFile }>>;
  /** Validates and applies edited YAML; returns field errors in OrchError.details */
  setConfig(text: string): Promise<Result<AccountsFile>>;
}

export interface IQuotaService {
  windows(): Promise<Result<QuotaWindow[]>>;
  pickAccount(agent: AgentId): Promise<Result<PickAccountResult>>;
  spendToday(): Promise<Result<SpendToday>>;
}

export interface IJobsService {
  start(spec: JobSpec): Promise<Result<Job>>;
  list(): Promise<Result<Job[]>>;
  get(jobId: JobId): Promise<Result<Job>>;
  cancel(jobId: JobId): Promise<Result<void>>;
  /** The equivalent `orch run …` command for a spec (shown under New job) */
  toCommand(spec: JobSpec): Promise<Result<string>>;
  approvePlan(jobId: JobId): Promise<Result<void>>;
  rejectPlan(jobId: JobId, reason?: string): Promise<Result<void>>;
}

export interface IRunsService {
  list(jobId: JobId): Promise<Result<Run[]>>;
  /** Lines after `afterSeq`, for catch-up when a pane opens */
  lines(runId: RunId, afterSeq: number): Promise<Result<RunLine[]>>;
  send(runId: RunId, text: string): Promise<Result<void>>;
  pause(runId: RunId): Promise<Result<void>>;
  stop(runId: RunId): Promise<Result<void>>;
  startNow(runId: RunId): Promise<Result<void>>;
  /** Paused-by-limit card: move to another account now */
  resumeOn(runId: RunId, accountId: AccountId): Promise<Result<Run>>;
  setAutoResume(runId: RunId, on: boolean): Promise<Result<void>>;
}

export interface ISessionsService {
  list(filter: 'all' | 'resumable' | 'live'): Promise<Result<Session[]>>;
  get(sessionId: SessionId): Promise<Result<Session & { status: SessionStatus }>>;
  resumeOptions(sessionId: SessionId): Promise<Result<ResumeOption[]>>;
  resume(req: ResumeRequest): Promise<Result<Session>>;
}

export interface IReviewService {
  list(): Promise<Result<WorktreeReview[]>>;
  get(worktree: WorktreeId): Promise<Result<WorktreeReview>>;
  diff(worktree: WorktreeId, path: string): Promise<Result<{ before: string; after: string }>>;
  /** Fails with not_verified unless the verdict is verified */
  approveAndMerge(worktree: WorktreeId): Promise<Result<void>>;
  requestChanges(worktree: WorktreeId, feedback: string): Promise<Result<void>>;
  discard(worktree: WorktreeId): Promise<Result<void>>;
  /** "Stop this happening again": starts the follow-up for the chosen layer */
  correct(worktree: WorktreeId, layer: CorrectionLayer, action: string): Promise<Result<{ followUpJobId: JobId | null }>>;
}

export interface ITrustService {
  summary(periodDays: 7 | 30): Promise<Result<TrustSummary>>;
  /** Manual only; fails if the agent doesn't qualify */
  promote(agent: AgentId, level: TrustLevel): Promise<Result<void>>;
  setGardener(on: boolean): Promise<Result<void>>;
}

export interface IShellService {
  open(cwd: string, cols: number, rows: number): Promise<Result<ShellId>>;
  write(shellId: ShellId, data: string): Promise<Result<void>>;
  resize(shellId: ShellId, cols: number, rows: number): Promise<Result<void>>;
  close(shellId: ShellId): Promise<Result<void>>;
}

export interface IDoctorService {
  /** Without `signInTwice`, the isolation checks are not run at all. */
  run(req?: DoctorRunRequest): Promise<Result<DoctorReport>>;
}

export type SpecLoadResult = {
  queue: SpecQueue | null;
  problems: SpecLoadProblem[];
  /** Done-when commands detected from the repo (package.json scripts, pytest, cargo, go, make); empty when none. */
  checkPresets: string[];
};

export interface ISpecsService {
  /** Adds front matter to BMAD stories that lack it (spec-queue.md §2). */
  init(repoPath: string): Promise<Result<SpecInitReport>>;
  /** Reads spec files and settings; returns problems instead of starting if any exist. */
  load(repoPath: string): Promise<Result<SpecLoadResult>>;
  get(queueId: QueueId): Promise<Result<SpecQueue>>;
  start(queueId: QueueId): Promise<Result<void>>;
  pause(queueId: QueueId): Promise<Result<void>>;
  resume(queueId: QueueId): Promise<Result<void>>;
  /** Stops all active jobs, keeps their worktrees, and sets every non-merged spec to cancelled (spec-queue.md §9). */
  cancel(queueId: QueueId): Promise<Result<void>>;
  updateSettings(queueId: QueueId, settings: Partial<SpecQueueSettings>): Promise<Result<SpecQueueSettings>>;
  /** Only queued specs can move, and never before a spec they depend on. */
  move(queueId: QueueId, specId: SpecId, toPosition: number): Promise<Result<void>>;
  skip(queueId: QueueId, specId: SpecId): Promise<Result<void>>;
  /** Only from needs_you or skipped; resets the attempt count. */
  retry(queueId: QueueId, specId: SpecId): Promise<Result<void>>;
  /** Tokens and cost of the spec's runs per hour, oldest first; empty before it ran. */
  usage(queueId: QueueId, specId: SpecId): Promise<Result<SpecUsageHour[]>>;
  /** SaaS Factory status of the project; null when it isn't a factory product. not_found when the factory isn't installed. */
  factoryStatus(repoPath: string): Promise<Result<FactoryStatus | null>>;
  /** New spec: writes the spec file, loads it into the queue, returns it (ADR 0013). */
  create(repoPath: string, draft: SpecDraft): Promise<Result<SpecRun>>;
  /** The equivalent `orch specs add …` command (shown under New spec) */
  toCommand(draft: SpecDraft): Promise<Result<string>>;
}

export interface IBugReportService {
  /** The file list shown in the dialog: the entry names that would be written. */
  files(): Promise<Result<string[]>>;
  save(req: BugReportSaveRequest): Promise<Result<BugReportSaveResult>>;
}

/** Subscribe to live events. Returns an unsubscribe function. */
export interface IEventsService {
  subscribe(listener: (event: OrchEvent) => void): () => void;
}

/** Everything a client can reach, keyed by channel name. */
export interface OrchServices {
  accounts: IAccountsService;
  quota: IQuotaService;
  jobs: IJobsService;
  runs: IRunsService;
  sessions: ISessionsService;
  review: IReviewService;
  trust: ITrustService;
  shells: IShellService;
  doctor: IDoctorService;
  specs: ISpecsService;
  bugreport: IBugReportService;
  events: IEventsService;
}

export type ChannelName = keyof OrchServices;
export const CHANNELS = ['accounts', 'quota', 'jobs', 'runs', 'sessions', 'review', 'trust', 'shells', 'doctor', 'specs', 'bugreport', 'events'] as const satisfies readonly ChannelName[];
