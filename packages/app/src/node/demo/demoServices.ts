/**
 * Fake implementations of every service interface in contracts services.ts for demo mode (ORCH_DEMO=1).
 *
 * All services return the prototype's sample data converted into contract objects.
 * Mutating calls succeed without side effects (updating in-memory state so UI flows can be clicked through)
 * and emit corresponding OrchEvents.
 */
import type {
  Account,
  AccountId,
  AccountsFile,
  AddAccountRequest,
  AgentId,
  AgentInfo,
  CorrectionLayer,
  DoctorReport,
  FactoryStatus,
  FactoryPipeline,
  IAccountsService,
  IDoctorService,
  IJobsService,
  IQuotaService,
  IReviewService,
  IRunsService,
  ISessionsService,
  IShellService,
  ISpecsService,
  SpecLoadResult,
  ITrustService,
  Job,
  JobId,
  JobSpec,
  PipelineRunState,
  OrchError,
  OrchEvent,
  Os,
  PickAccountResult,
  QueueId,
  QuotaWindow,
  Result,
  ResumeOption,
  ResumeRequest,
  RoutingRule,
  Run,
  RunId,
  RunLine,
  Session,
  SessionId,
  SessionStatus,
  ShellId,
  SignInResult,
  SpecId,
  SpecRun,
  SpecInitReport,
  SpecQueue,
  SpecQueueSettings,
  SpecUsageHour,
  SpendToday,
  Timestamp,
  TrustLevel,
  TrustSummary,
  WorktreeId,
  WorktreeReview,
} from '@orchagents/contracts';
import { FactoryPipeline as FactoryPipelineSchema } from '@orchagents/contracts';
import factoryPipelineFixture from '../../../../contracts/src/test/fixtures/factory-pipeline-status.json' with { type: 'json' };
import type { ChannelServer } from '@orchagents/platform/channels/common';
import { jobSpecToCommand } from '@orchagents/platform';
import { CHANNEL_SCHEMAS } from '../channelSchemas.js';
import { SpecDraft } from '@orchagents/contracts';
import { specDraftToCommand } from '@orchagents/platform/src/specs/queue/common/toCommand.js';

export interface DemoEventsSink {
  fire(event: OrchEvent): void;
}
import {
  DEMO_ACCOUNTS,
  DEMO_ACCOUNTS_FILE,
  DEMO_ACCOUNTS_YAML_TEXT,
  DEMO_AGENTS,
  DEMO_DIFFS,
  DEMO_JOBS,
  DEMO_RESET_AT,
  DEMO_QUOTA_WINDOWS,
  DEMO_REVIEWS,
  DEMO_RUNS,
  DEMO_RUN_LINES,
  DEMO_SESSIONS,
  DEMO_SPEC_QUEUE,
  DEMO_TRUST_SUMMARY_30,
  DEMO_TRUST_SUMMARY_7,
  createDemoDoctorReport,
} from './sampleData.js';

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const err = <T = never>(error: OrchError): Result<T> => ({ ok: false, error });

function createDemoProductPipeline(): FactoryPipeline {
  const pipeline = FactoryPipelineSchema.parse(factoryPipelineFixture) as FactoryPipeline;
  pipeline.product = 'tidemark';
  pipeline.stages.forEach((stage, index) => {
    stage.state = index < 11 ? 'done' : 'queued';
    stage.answer = null;
  });
  const confirmBrief = pipeline.stages.find((stage) => stage.id === 'confirm-brief');
  if (confirmBrief) confirmBrief.answer = { words: 'Yes, that captures the booking flow.', by: 'operator', via: 'orch', at: '2026-10-29T10:12:00.000Z' };
  const pickReference = pipeline.stages.find((stage) => stage.id === 'pick-reference');
  if (pickReference) pickReference.answer = { words: 'Web 2 and console 1.', by: 'operator', via: 'chat', at: '2026-10-29T11:08:00.000Z' };
  const now = pipeline.stages.find((stage) => stage.id === 'extract');
  if (now) now.state = 'next';
  const openGate = pipeline.stages.find((stage) => stage.id === 'approve-prototype');
  if (openGate) openGate.state = 'needs_you';
  const counts = { total: 28, done: 11, next: 1, needs_you: 1, left: 16, gates_ahead: 3 };
  pipeline.counts = counts;
  pipeline.groups = {
    planning: { total: 7, done: 7, next: 0, needs_you: 0, left: 0, gates_ahead: 0 },
    design: { total: 12, done: 4, next: 1, needs_you: 1, left: 7, gates_ahead: 1 },
    build: { total: 9, done: 0, next: 0, needs_you: 0, left: 9, gates_ahead: 2 },
  };
  pipeline.now = now ?? null;
  return pipeline;
}

const DEMO_PRODUCT_TRAIL = [
  { time: '2026-10-29T11:08:00.000Z', stage: 'pick-reference', kind: 'gate', by: 'operator' as const, summary: 'Picked web reference 2 and console reference 1.', evidence: ['design/sheets/reference-web.jpg'] },
  { time: '2026-10-29T10:42:00.000Z', stage: 'teardown', kind: 'decision', by: 'agent' as const, summary: 'Recorded the visible layout, type and imagery from the selected references.', evidence: ['design/reference-web.md'] },
  { time: '2026-10-29T10:12:00.000Z', stage: 'confirm-brief', kind: 'gate', by: 'operator' as const, summary: 'Confirmed the restatement of the booking product brief.', evidence: ['docs/00-restated.md'] },
  { time: '2026-10-29T09:55:00.000Z', stage: 'architecture', kind: 'decision', by: 'agent' as const, summary: 'Kept the first release focused on booking and availability.', evidence: ['docs/04-architecture.md'] },
  { time: '2026-10-29T09:22:00.000Z', stage: 'prd', kind: 'amend', by: 'operator' as const, summary: 'Added calendar export to the first release.', evidence: ['docs/03-prd.md'] },
  { time: '2026-10-29T08:51:00.000Z', stage: 'value-map', kind: 'decision', by: 'agent' as const, summary: 'Mapped the booking flow from discovery through confirmation.', evidence: ['docs/02-value-map.md'] },
  { time: '2026-10-29T08:14:00.000Z', stage: 'research', kind: 'receipt', by: 'agent' as const, summary: 'Compared calendar and appointment products.', evidence: ['docs/01-research.md'] },
  { time: '2026-10-29T07:45:00.000Z', stage: 'brief', kind: 'init', by: 'operator' as const, summary: 'Started the tidemark product pipeline.', evidence: ['docs/00-brief.md'] },
];

const DEMO_PIPELINE_RUN: PipelineRunState = {
  jobId: 'j-07' as JobId,
  state: 'working',
  stage: 'Extract the look',
  reason: null,
};

export interface DemoServices {
  readonly accounts: IAccountsService;
  readonly quota: IQuotaService;
  readonly jobs: IJobsService;
  readonly runs: IRunsService;
  readonly sessions: ISessionsService;
  readonly review: IReviewService;
  readonly trust: ITrustService;
  readonly shells: IShellService;
  readonly doctor: IDoctorService;
  readonly specs: ISpecsService;
  emitInitialEvents(): void;
}

export function createDemoServices(events: DemoEventsSink, os: Os = 'macos'): DemoServices {
  // In-memory cloneable state for mutations
  let accountsList: Account[] = DEMO_ACCOUNTS
    .filter((account) => account.agent !== 'agy' || account.id === 'agy-main' || os === 'linux')
    .map((a) => ({ ...a }));
  const quotaWindows: QuotaWindow[] = DEMO_QUOTA_WINDOWS.map((w) => ({ ...w }));
  let jobsList: Job[] = DEMO_JOBS.map((j) => ({ ...j }));
  const runsList: Run[] = DEMO_RUNS.map((r) => ({ ...r }));
  const runLinesMap: Map<string, RunLine[]> = new Map(
    Object.entries(DEMO_RUN_LINES).map(([k, lines]) => [k, lines.map((l) => ({ ...l }))]),
  );
  const sessionsList: Session[] = DEMO_SESSIONS.map((s) => ({ ...s }));
  const reviewsList: WorktreeReview[] = DEMO_REVIEWS.map((r) => ({ ...r, checks: [...r.checks], files: [...r.files] }));
  const diffsMap: Map<string, { before: string; after: string }> = new Map(Object.entries(DEMO_DIFFS));
  const trustSummary7: TrustSummary = { ...DEMO_TRUST_SUMMARY_7, agents: DEMO_TRUST_SUMMARY_7.agents.map((a) => ({ ...a })) };
  const trustSummary30: TrustSummary = { ...DEMO_TRUST_SUMMARY_30, agents: DEMO_TRUST_SUMMARY_30.agents.map((a) => ({ ...a })) };
  const specNow = Date.now();
  const displayedDurations: Readonly<Record<string, number>> = { '39': 6, '40': 9, '41': 12, '42': 4, '43': 2, '45': 31 };
  const specQueue: SpecQueue = {
    ...DEMO_SPEC_QUEUE,
    settings: { ...DEMO_SPEC_QUEUE.settings },
    specs: DEMO_SPEC_QUEUE.specs.map((s) => {
      const duration = displayedDurations[s.id];
      if (duration === undefined) return { ...s, criteria: [...s.criteria] };
      const start = new Date(specNow - duration * 60_000).toISOString();
      const end = s.state === 'running' ? null : new Date(specNow).toISOString();
      return { ...s, startedAt: start, finishedAt: end, criteria: [...s.criteria] };
    }),
  };
  let accountsYamlText = os === 'linux'
    ? DEMO_ACCOUNTS_YAML_TEXT
    : DEMO_ACCOUNTS_YAML_TEXT.replace('    alt: {}   # not signed in yet\n', '');
  const accountsFileEntries = JSON.parse(JSON.stringify(DEMO_ACCOUNTS_FILE.accounts)) as AccountsFile['accounts'];
  if (os !== 'linux') delete accountsFileEntries.agy?.alt;
  const accountsFile: AccountsFile = {
    ...DEMO_ACCOUNTS_FILE,
    accounts: accountsFileEntries,
    limits: { ...DEMO_ACCOUNTS_FILE.limits },
  };

  let nextShellNum = 1;
  let nextJobNum = 9;
  let demoProductPipeline = createDemoProductPipeline();
  const cloneDemoProductPipeline = (): FactoryPipeline => FactoryPipelineSchema.parse(demoProductPipeline) as FactoryPipeline;

  // 1. Accounts service
  const emitInitialEvents = (): void => {
    // Live-update initial events
    events.fire({ type: 'engine.health', state: 'ready' });
    events.fire({ type: 'config.changed', source: 'app' });
    events.fire({
      type: 'quota.limited',
      accountId: 'codex-personal' as AccountId,
      resetsAt: DEMO_RESET_AT,
    });
  };

  let initialEventsEmitted = false;

  const accounts: IAccountsService = {
    async listAgents(): Promise<Result<AgentInfo[]>> {
      return ok(
        DEMO_AGENTS.map((agent) => ({
          ...agent,
          support: agent.supportByOs[os] ?? agent.support,
        })),
      );
    },

    async list(): Promise<Result<Account[]>> {
      if (!initialEventsEmitted) {
        initialEventsEmitted = true;
        emitInitialEvents();
      }
      const singleAccountAgents = new Set(
        DEMO_AGENTS.filter((agent) => agent.supportByOs[os] === 'single').map((agent) => agent.id),
      );
      return ok(accountsList
        .filter((account) => !singleAccountAgents.has(account.agent) || account.primary)
        .map((a) => ({ ...a })));
    },

    async add(req: AddAccountRequest): Promise<Result<Account>> {
      const slug = req.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const accountId = `${req.agent}-${slug}` as AccountId;
      const newAccount: Account = {
        id: accountId,
        agent: req.agent,
        name: req.name,
        primary: false,
        use: true,
        state: 'signed_out',
        emailMasked: 'n•••@client.com',
        plan: 'just added',
        profileDir: `~/.orch/profiles/${accountId}`,
        skillsShared: true,
      };
      accountsList = accountsList.concat(newAccount);
      events.fire({ type: 'account.changed', account: newAccount });
      return ok(newAccount);
    },

    async signIn(accountId: AccountId): Promise<Result<SignInResult>> {
      const existing = accountsList.find((a) => a.id === accountId);
      if (existing) {
        existing.state = 'available';
        existing.emailMasked = existing.emailMasked ?? 'n•••@client.com';
        events.fire({ type: 'account.changed', account: { ...existing } });
      }
      return ok({
        accountId,
        signedIn: true,
        emailMasked: existing?.emailMasked ?? 'n•••@client.com',
        keptSeparate: true,
        ready: true,
        identity: 'checked',
      });
    },

    async openSignIn(): Promise<Result<ShellId>> {
      // The demo has no PTY host: it plays a short sign-in and ends it.
      const id = `sh-${nextShellNum++}` as ShellId;
      setTimeout(() => events.fire({ type: 'shell.output', shellId: id, data: 'Opening your browser to sign in…\r\n' }), 300);
      setTimeout(() => events.fire({ type: 'shell.output', shellId: id, data: '\u001b[32m✓ Successfully logged in\u001b[0m\r\n' }), 1500);
      setTimeout(() => events.fire({ type: 'shell.exited', shellId: id, code: 0 }), 1800);
      return ok(id);
    },

    async checkSignIn(accountId: AccountId): Promise<Result<SignInResult>> {
      // The demo's sign-in always succeeds; userConfirmed changes nothing here.
      return this.signIn(accountId);
    },

    async setPrimary(accountId: AccountId): Promise<Result<void>> {
      const target = accountsList.find((a) => a.id === accountId);
      if (!target) return ok(undefined);
      for (const a of accountsList) {
        if (a.agent === target.agent) {
          a.primary = a.id === accountId;
          events.fire({ type: 'account.changed', account: { ...a } });
        }
      }
      return ok(undefined);
    },

    async setUse(accountId: AccountId, use: boolean): Promise<Result<void>> {
      const target = accountsList.find((a) => a.id === accountId);
      if (target) {
        target.use = use;
        events.fire({ type: 'account.changed', account: { ...target } });
      }
      return ok(undefined);
    },

    async setRouting(rule: RoutingRule): Promise<Result<void>> {
      accountsFile.routing = rule;
      events.fire({ type: 'config.changed', source: 'app' });
      return ok(undefined);
    },

    async setShareSkills(agent: AgentId, share: boolean): Promise<Result<void>> {
      for (const a of accountsList) {
        if (a.agent === agent) {
          a.skillsShared = share;
          events.fire({ type: 'account.changed', account: { ...a } });
        }
      }
      return ok(undefined);
    },

    async remove(accountId: AccountId): Promise<Result<void>> {
      accountsList = accountsList.filter((a) => a.id !== accountId);
      events.fire({ type: 'account.removed', accountId });
      return ok(undefined);
    },

    async getConfig(): Promise<Result<{ text: string; parsed: AccountsFile }>> {
      return ok({
        text: accountsYamlText,
        parsed: { ...accountsFile },
      });
    },

    async setConfig(text: string): Promise<Result<AccountsFile>> {
      accountsYamlText = text;
      events.fire({ type: 'config.changed', source: 'file' });
      return ok({ ...accountsFile });
    },
  };

  // 2. Quota service
  const quota: IQuotaService = {
    async windows(): Promise<Result<QuotaWindow[]>> {
      return ok(quotaWindows.map((w) => ({ ...w })));
    },

    async pickAccount(agent: AgentId): Promise<Result<PickAccountResult>> {
      const usable = accountsList.filter((a) => a.agent === agent && a.state !== 'signed_out' && a.state !== 'limited' && a.use);
      if (!usable.length) {
        return ok({ kind: 'none', agent, reason: 'No accounts usable' });
      }
      const primary = usable.find((a) => a.primary && a.state !== 'near_limit');
      if (primary) {
        return ok({ kind: 'account', accountId: primary.id });
      }
      const first = usable[0];
      if (!first) {
        return ok({ kind: 'none', agent, reason: 'No accounts usable' });
      }
      return ok({ kind: 'account', accountId: first.id });
    },

    async spendToday(): Promise<Result<SpendToday>> {
      return ok({ usd: 4.12, fromApiKeysOnly: true });
    },
  };

  // 3. Jobs service
  const jobs: IJobsService = {
    async start(spec: JobSpec): Promise<Result<Job>> {
      const jobId = `j-0${nextJobNum++}` as JobId;
      const newJob: Job = {
        id: jobId,
        title: spec.goal.slice(0, 40),
        spec,
        status: 'running',
        step: {
          name: 'Implement',
          index: 1,
          total: 3,
          attempt: 1,
          looping: false,
        },
        createdAt: new Date().toISOString(),
        scheduledFor: null,
      };
      jobsList = jobsList.concat(newJob);
      events.fire({ type: 'job.changed', job: newJob });
      return ok(newJob);
    },

    async list(): Promise<Result<Job[]>> {
      return ok(jobsList.map((j) => ({ ...j })));
    },

    async get(jobId: JobId): Promise<Result<Job>> {
      const found = jobsList.find((j) => j.id === jobId);
      if (!found) {
        return err({ code: 'not_found', message: `Job ${jobId} not found`, fix: 'Check job id' });
      }
      return ok({ ...found });
    },

    async cancel(jobId: JobId): Promise<Result<void>> {
      const target = jobsList.find((j) => j.id === jobId);
      if (target) {
        target.status = 'cancelled';
        events.fire({ type: 'job.changed', job: { ...target } });
      }
      return ok(undefined);
    },

    async approvePlan(jobId: JobId): Promise<Result<void>> {
      const target = jobsList.find((j) => j.id === jobId);
      if (target) {
        target.step = { name: 'Code', index: 2, total: 3, attempt: 1, looping: false };
        events.fire({ type: 'job.changed', job: { ...target } });
      }
      return ok(undefined);
    },

    async rejectPlan(): Promise<Result<void>> {
      return ok(undefined);
    },

    async toCommand(spec: JobSpec): Promise<Result<string>> {
      // The real builder, so the demo (and the help screenshots) show the true command.
      return ok(jobSpecToCommand(spec));
    },
  };

  // 4. Runs service
  const runs: IRunsService = {
    async list(jobId: JobId): Promise<Result<Run[]>> {
      return ok(runsList.filter((r) => r.jobId === jobId).map((r) => ({ ...r })));
    },

    async lines(runId: RunId, afterSeq: number): Promise<Result<RunLine[]>> {
      const lines = runLinesMap.get(runId) ?? [];
      return ok(lines.filter((l) => l.seq > afterSeq).map((l) => ({ ...l })));
    },

    async send(runId: RunId, text: string): Promise<Result<void>> {
      const lines = runLinesMap.get(runId) ?? [];
      const nextSeq = lines.length ? Math.max(...lines.map((l) => l.seq)) + 1 : 0;
      const newLine: RunLine = {
        runId,
        seq: nextSeq,
        at: new Date().toISOString(),
        kind: 'prompt',
        text,
      };
      lines.push(newLine);
      runLinesMap.set(runId, lines);
      events.fire({ type: 'run.line', line: newLine });
      return ok(undefined);
    },

    async pause(runId: RunId): Promise<Result<void>> {
      const target = runsList.find((r) => r.id === runId);
      if (target) {
        target.status = 'paused_limit';
        events.fire({ type: 'run.changed', run: { ...target } });
      }
      return ok(undefined);
    },

    async stop(runId: RunId): Promise<Result<void>> {
      const target = runsList.find((r) => r.id === runId);
      if (target) {
        target.status = 'stopped';
        events.fire({ type: 'run.changed', run: { ...target } });
      }
      return ok(undefined);
    },

    async startNow(runId: RunId): Promise<Result<void>> {
      const target = runsList.find((r) => r.id === runId);
      if (target) {
        target.status = 'running';
        events.fire({ type: 'run.changed', run: { ...target } });
      }
      return ok(undefined);
    },

    async resumeOn(runId: RunId, accountId: AccountId): Promise<Result<Run>> {
      const target = runsList.find((r) => r.id === runId);
      if (!target) {
        return err({ code: 'not_found', message: `Run ${runId} not found`, fix: 'Check run id' });
      }
      target.accountId = accountId;
      target.status = 'running';
      events.fire({ type: 'run.changed', run: { ...target } });
      return ok({ ...target });
    },

    async setAutoResume(runId: RunId, on: boolean): Promise<Result<void>> {
      void runId;
      void on;
      return ok(undefined);
    },
  };

  // 5. Sessions service
  const sessions: ISessionsService = {
    async list(filter: 'all' | 'resumable' | 'live'): Promise<Result<Session[]>> {
      let filtered = sessionsList;
      if (filter === 'live') {
        filtered = sessionsList.filter((s) => s.status === 'live');
      } else if (filter === 'resumable') {
        filtered = sessionsList.filter((s) => s.status !== 'live');
      }
      return ok(filtered.map((s) => ({ ...s })));
    },

    async get(sessionId: SessionId): Promise<Result<Session & { status: SessionStatus }>> {
      const found = sessionsList.find((s) => s.id === sessionId);
      if (!found) {
        return err({ code: 'not_found', message: `Session ${sessionId} not found`, fix: 'Check session id' });
      }
      return ok({ ...found });
    },

    async resumeOptions(sessionId: SessionId): Promise<Result<ResumeOption[]>> {
      const found = sessionsList.find((s) => s.id === sessionId);
      const isLimited = found?.accountId === 'codex-personal';
      const options: ResumeOption[] = [
        {
          mode: 'same',
          available: true,
          description: isLimited
            ? `Reopens ${found?.id ?? sessionId} with its full history. Personal is limited, so this waits until 15:00.`
            : `Reopens ${found?.id ?? sessionId} on Claude Code · Personal with its full history.`,
          target: found?.accountId ?? null,
          waitsUntil: isLimited ? DEMO_RESET_AT : null,
        },
        {
          mode: 'account',
          available: true,
          description: 'New Codex session on Team in the same worktree, primed with a summary of this one.',
          target: 'codex-team' as AccountId,
          waitsUntil: null,
        },
        {
          mode: 'agent',
          available: true,
          description: 'Continue on Claude Code · Personal with the summary and the job plan.',
          target: 'claude-personal' as AccountId,
          waitsUntil: null,
        },
        {
          mode: 'fork',
          available: true,
          description: 'Copy the current state to a new branch to try a different approach. The original stays as it is.',
          target: null,
          waitsUntil: null,
        },
      ];
      return ok(options);
    },

    async resume(req: ResumeRequest): Promise<Result<Session>> {
      const target = sessionsList.find((s) => s.id === req.sessionId);
      if (!target) {
        return err({ code: 'not_found', message: `Session ${req.sessionId} not found`, fix: 'Check session id' });
      }
      if (req.mode === 'account' && 'to' in req) {
        target.handedOffTo = 's-a3f2' as SessionId;
        const newSession = sessionsList.find((s) => s.id === 's-a3f2') ?? {
          ...target,
          id: 's-a3f2' as SessionId,
          accountId: req.to,
          handedOffFrom: req.sessionId,
          status: 'live' as const,
        };
        events.fire({ type: 'session.changed', session: newSession });
        return ok(newSession);
      }
      target.status = 'live';
      events.fire({ type: 'session.changed', session: { ...target } });
      return ok({ ...target });
    },
  };

  // 6. Review service
  const review: IReviewService = {
    async list(): Promise<Result<WorktreeReview[]>> {
      return ok(reviewsList.map((r) => ({ ...r, checks: [...r.checks], files: [...r.files] })));
    },

    async get(repoPath: string, worktree: WorktreeId): Promise<Result<WorktreeReview>> {
      const found = reviewsList.find((r) => r.repoPath === repoPath && r.worktree === worktree);
      if (!found) {
        return err({ code: 'not_found', message: `Worktree ${worktree} not found`, fix: 'Check worktree id' });
      }
      return ok({ ...found, checks: [...found.checks], files: [...found.files] });
    },

    async diff(repoPath: string, worktree: WorktreeId, path: string): Promise<Result<{ before: string; after: string }>> {
      void repoPath;
      void worktree;
      const found = diffsMap.get(path);
      if (!found) {
        return ok({ before: '', after: `// ${path} content` });
      }
      return ok({ ...found });
    },

    async approveAndMerge(repoPath: string, worktree: WorktreeId): Promise<Result<void>> {
      const found = reviewsList.find((r) => r.repoPath === repoPath && r.worktree === worktree);
      if (found) {
        found.state = 'merged';
        found.verdict = 'verified';
        events.fire({ type: 'review.changed', review: { ...found } });
      }
      return ok(undefined);
    },

    async requestChanges(repoPath: string, worktree: WorktreeId, feedback: string): Promise<Result<void>> {
      void feedback;
      const found = reviewsList.find((r) => r.repoPath === repoPath && r.worktree === worktree);
      if (found) {
        found.state = 'in_progress';
        events.fire({ type: 'review.changed', review: { ...found } });
      }
      return ok(undefined);
    },

    async discard(repoPath: string, worktree: WorktreeId): Promise<Result<void>> {
      const found = reviewsList.find((r) => r.repoPath === repoPath && r.worktree === worktree);
      if (found) {
        found.state = 'discarded';
        events.fire({ type: 'review.changed', review: { ...found } });
      }
      return ok(undefined);
    },

    async correct(repoPath: string, worktree: WorktreeId, layer: CorrectionLayer, action: string): Promise<Result<{ followUpJobId: JobId | null }>> {
      void repoPath;
      void worktree;
      void layer;
      void action;
      return ok({ followUpJobId: 'j-08' as JobId });
    },
  };

  // 7. Trust service
  const trust: ITrustService = {
    async summary(periodDays: 7 | 30): Promise<Result<TrustSummary>> {
      const summary = periodDays === 7 ? trustSummary7 : trustSummary30;
      return ok({
        ...summary,
        agents: summary.agents.map((a) => ({ ...a })),
        gardener: { ...summary.gardener, findings: [...summary.gardener.findings] },
      });
    },

    async promote(agent: AgentId, level: TrustLevel): Promise<Result<void>> {
      for (const summary of [trustSummary7, trustSummary30]) {
        const found = summary.agents.find((a) => a.agent === agent);
        if (found) {
          found.level = level;
          found.eligibleFor = null;
        }
      }
      return ok(undefined);
    },

    async setGardener(on: boolean): Promise<Result<void>> {
      trustSummary7.gardener.on = on;
      trustSummary30.gardener.on = on;
      return ok(undefined);
    },
  };

  // 8. Shell service
  const shells: IShellService = {
    async open(cwd: string, cols: number, rows: number): Promise<Result<ShellId>> {
      void cols;
      void rows;
      const id = `sh-${nextShellNum++}` as ShellId;
      const output = cwd === 'orch/r-02'
        ? '\u001b[32m…/wt/r-02 (orch/r-02) $ \u001b[0mgit status --short\u001b[0m\r\n M src/auth/callback.ts\r\n?? src/auth/pkce.ts\r\n\u001b[32m…/wt/r-02 (orch/r-02) $ \u001b[0mnpm test -- auth\u001b[0m\r\n\u001b[32m✓ 14 passed (1.9s)\u001b[0m\r\n\u001b[32m…/wt/r-02 (orch/r-02) $ \u001b[0m'
        : cwd === 'main'
          ? '\u001b[32m~/code/api-server (main) $ \u001b[0mgit log --oneline -3\u001b[0m\r\na91c2e4 Upgrade to Node 22 (#212)\r\n7f03b1d Add rate limiter to /login\r\n52d9e80 Bump dependencies\r\n\u001b[32m~/code/api-server (main) $ \u001b[0m'
          : '';
      if (output) events.fire({ type: 'shell.output', shellId: id, data: output });
      return ok(id);
    },

    async write(shellId: ShellId, data: string): Promise<Result<void>> {
      events.fire({ type: 'shell.output', shellId, data });
      return ok(undefined);
    },

    async resize(shellId: ShellId, cols: number, rows: number): Promise<Result<void>> {
      void shellId;
      void cols;
      void rows;
      return ok(undefined);
    },

    async close(shellId: ShellId): Promise<Result<void>> {
      events.fire({ type: 'shell.exited', shellId, code: 0 });
      return ok(undefined);
    },
  };

  // 9. Doctor service
  const doctor: IDoctorService = {
    async run(): Promise<Result<DoctorReport>> {
      return ok(createDemoDoctorReport(os));
    },
  };

  // 10. Specs service
  const specs: ISpecsService = {
    async toCommand(draft) { return ok(specDraftToCommand(SpecDraft.parse(draft))); },
    async create(repoPath, draft) {
      void repoPath;
      const parsed = SpecDraft.safeParse(draft);
      if (!parsed.success) return { ok: false, error: { code: 'validation_failed', message: parsed.error.message, fix: 'Correct the new spec fields and try again.' } };
      const nextId = String(Math.max(0, ...specQueue.specs.map((s) => Number(s.id))) + 1) as SpecId;
      const spec = { id: nextId, title: parsed.data.title, depends_on: parsed.data.depends_on, scope: parsed.data.scope, done_when: parsed.data.done_when.length ? parsed.data.done_when : [{ by: 'audit' as const, text: 'The goal is met' }], agent: parsed.data.agent, mode: parsed.data.mode, agents: parsed.data.agents };
      const run: SpecRun = { id: nextId, queueId: specQueue.id, position: specQueue.specs.length + 1, file: `docs/specs/${nextId.padStart(3, '0')}-${parsed.data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}.md`, spec, state: 'queued', attempt: null, jobId: null, worktree: null, implementer: null, criteria: spec.done_when.map((_, index) => ({ index, state: 'pending', summary: null, auditor: null })), blockedBy: [], startedAt: null, finishedAt: null, tokens: 0, history: [] };
      if (parsed.data.runNext) { specQueue.specs.forEach((s) => { if (s.state === 'queued') s.position += 1; }); run.position = 1; }
      specQueue.specs.push(run); specQueue.specs.sort((a, b) => a.position - b.position);
      events.fire({ type: 'spec.changed', spec: run }); events.fire({ type: 'queue.changed', queue: { ...specQueue } });
      return ok(run);
    },
    async init(repoPath: string): Promise<Result<SpecInitReport>> {
      void repoPath;
      return ok({
        added: [
          { file: 'docs/stories/001-login.md', id: '1', title: 'Login story', criteriaCount: 3 },
          { file: 'docs/stories/002-profile.md', id: '2', title: 'Profile story', criteriaCount: 2 },
        ],
        skipped: ['003-existing.md'],
      });
    },

    async load(repoPath: string): Promise<Result<SpecLoadResult>> {
      void repoPath;
      return ok({
        queue: {
          ...specQueue,
          settings: { ...specQueue.settings },
          specs: specQueue.specs.map((s) => ({ ...s, criteria: [...s.criteria] })),
        },
        problems: [],
        checkPresets: ['npm test', 'npm run lint', 'npm run build'],
      });
    },

    async get(queueId: QueueId): Promise<Result<SpecQueue>> {
      void queueId;
      return ok({
        ...specQueue,
        settings: { ...specQueue.settings },
        specs: specQueue.specs.map((s) => ({ ...s, criteria: [...s.criteria] })),
      });
    },

    async start(queueId: QueueId): Promise<Result<void>> {
      void queueId;
      specQueue.paused = false;
      events.fire({ type: 'queue.changed', queue: { ...specQueue } });
      return ok(undefined);
    },

    async pause(queueId: QueueId): Promise<Result<void>> {
      void queueId;
      specQueue.paused = true;
      events.fire({ type: 'queue.changed', queue: { ...specQueue } });
      return ok(undefined);
    },

    async resume(queueId: QueueId): Promise<Result<void>> {
      void queueId;
      specQueue.paused = false;
      events.fire({ type: 'queue.changed', queue: { ...specQueue } });
      return ok(undefined);
    },

    async cancel(queueId: QueueId): Promise<Result<void>> {
      void queueId;
      for (const spec of specQueue.specs) {
        if (spec.state !== 'merged') spec.state = 'cancelled';
      }
      events.fire({ type: 'queue.changed', queue: { ...specQueue } });
      return ok(undefined);
    },

    async updateSettings(queueId: QueueId, settings: Partial<SpecQueueSettings>): Promise<Result<SpecQueueSettings>> {
      void queueId;
      specQueue.settings = { ...specQueue.settings, ...settings };
      events.fire({ type: 'queue.changed', queue: { ...specQueue } });
      return ok({ ...specQueue.settings });
    },

    async move(queueId: QueueId, specId: SpecId, toPosition: number): Promise<Result<void>> {
      void queueId;
      const idx = specQueue.specs.findIndex((s) => s.id === specId);
      if (idx >= 0) {
        const item = specQueue.specs[idx];
        if (item) {
          specQueue.specs.splice(idx, 1);
          specQueue.specs.splice(toPosition - 1, 0, item);
          specQueue.specs.forEach((s, i) => {
            s.position = i + 1;
          });
          events.fire({ type: 'queue.changed', queue: { ...specQueue } });
        }
      }
      return ok(undefined);
    },

    async skip(queueId: QueueId, specId: SpecId): Promise<Result<void>> {
      void queueId;
      const found = specQueue.specs.find((s) => s.id === specId);
      if (found) {
        found.state = 'skipped';
        events.fire({ type: 'spec.changed', spec: { ...found } });
        events.fire({ type: 'queue.changed', queue: { ...specQueue } });
      }
      return ok(undefined);
    },

    async retry(queueId: QueueId, specId: SpecId): Promise<Result<void>> {
      void queueId;
      const found = specQueue.specs.find((s) => s.id === specId);
      if (found) {
        found.state = 'running';
        found.attempt = (found.attempt ?? 0) + 1;
        events.fire({ type: 'spec.changed', spec: { ...found } });
        events.fire({ type: 'queue.changed', queue: { ...specQueue } });
      }
      return ok(undefined);
    },

    async usage(queueId: QueueId, specId: SpecId): Promise<Result<SpecUsageHour[]>> {
      void queueId;
      const found = specQueue.specs.find((s) => s.id === specId);
      if (!found || (found.state !== 'running' && found.state !== 'merged')) {
        return ok([]);
      }
      // Deterministic 8-hour series derived from the spec id, ending at the current clock hour.
      const seed = Number(specId) || 1;
      const endHour = new Date();
      endHour.setUTCMinutes(0, 0, 0);
      const hours: SpecUsageHour[] = [];
      for (let i = 7; i >= 0; i--) {
        const at = new Date(endHour.getTime() - i * 60 * 60 * 1000);
        const hour = new Date(
          Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), at.getUTCHours()),
        ).toISOString() as Timestamp;
        // No Math.random: the shape varies per spec id and hour but stays stable.
        const jitter = ((seed * 37 + i * 53) % 97) / 97;
        const tokens = 48_000 + Math.round(jitter * 132_000);
        const usd = Math.round(tokens * 5.2e-6 * 10_000) / 10_000;
        hours.push({ hour, tokens, usd });
      }
      return ok(hours);
    },

    async factoryStatus(repoPath: string): Promise<Result<FactoryStatus | null>> {
      // The demo specs double as the factory's BMAD story files, so the status
      // points at them: one done, one in progress, one still ready for dev.
      const specFile = (specId: string): string =>
        specQueue.specs.find((s) => s.id === specId)?.file ?? `docs/specs/spec-${specId}.md`;
      const status: FactoryStatus = {
        product: 'api-server',
        path: repoPath,
        done: false,
        missing: ['docs/05-references.md', 'docs/06-plan.md', 'docs/07-build.md'],
        next: 'write 05-references.md (saas-design-reference) — run /factory',
        stages: [
          { stage: '00-brief', by: 'brief', done: true },
          { stage: '01-research', by: 'saas-idea-research', done: true },
          { stage: '02-value-map', by: 'saas-value-map', done: true },
          { stage: '03-prd', by: 'bmad-prd', done: true },
          { stage: '04-architecture', by: 'saas-architecture-fit', done: true },
          { stage: '05-references', by: 'saas-design-reference', done: false },
          { stage: '06-brand-guide', by: 'design order 1–5', done: false },
          { stage: '07-implementation', by: 'saas-implementation-direction', done: false },
        ],
        design: [
          { step: '1 shape', done: true },
          { step: '3 sources', done: false },
          { step: '3a reference', done: false },
          { step: '3b brief', done: false },
          { step: '4 tooling', done: false },
          { step: '5 system', done: false },
          { step: '6 frames', done: false },
        ],
        delivery: {
          file: '_bmad-output/implementation-artifacts/sprint-status.yaml',
          updated: '2026-10-26T17:40:00Z',
          epics: [
            {
              id: '1',
              status: 'in-progress',
              stories: [
                {
                  key: '1-1-rate-limiter-for-login',
                  status: 'done',
                  file: specFile('39'),
                  openTasks: 0,
                  spec: true,
                  specPath: '.kiro/specs/rate-limiter-for-login/tasks.md',
                  openSpecTasks: 0,
                  done: true,
                  drift: null,
                },
                {
                  key: '1-2-rotate-session-cookies-on-login',
                  status: 'in-progress',
                  file: specFile('40'),
                  openTasks: 2,
                  spec: true,
                  specPath: '.kiro/specs/rotate-session-cookies-on-login/tasks.md',
                  openSpecTasks: 3,
                  done: false,
                  drift: null,
                },
                {
                  key: '1-3-oauth-state-and-pkce-validation',
                  status: 'ready-for-dev',
                  file: specFile('41'),
                  openTasks: null,
                  spec: false,
                  specPath: null,
                  openSpecTasks: null,
                  done: false,
                  drift: null,
                },
              ],
              storiesDone: 1,
              done: false,
            },
          ],
        },
      };
      return ok(status);
    },

    async factoryPipeline(repoPath: string) {
      void repoPath;
      return ok(cloneDemoProductPipeline());
    },
    async answerFactoryGate(repoPath: string, gateId: string, words: string) {
      void repoPath;
      const stage = demoProductPipeline.stages.find((item) => item.id === gateId);
      if (!stage?.gate) return { ok: false, error: { code: 'validation_failed', message: `Gate ${gateId} is not open.`, fix: 'Refresh the product and choose an open gate.' } };
      stage.state = 'done';
      stage.answer = { words, by: 'operator', via: 'orch', at: new Date().toISOString() };
      demoProductPipeline.counts.needs_you = 0;
      demoProductPipeline.counts.done += 1;
      demoProductPipeline.counts.left -= 1;
      demoProductPipeline.counts.gates_ahead -= 1;
      const designCounts = demoProductPipeline.groups.design;
      if (designCounts) {
        designCounts.needs_you = 0;
        designCounts.done += 1;
        designCounts.left -= 1;
        designCounts.gates_ahead -= 1;
      }
      return ok(cloneDemoProductPipeline());
    },
    async initFactoryProduct() { demoProductPipeline = createDemoProductPipeline(); return ok(cloneDemoProductPipeline()); },
    async factoryTrail() { return ok({ rows: DEMO_PRODUCT_TRAIL, unreadable: 0 }); },
    async productFiles() { return { ok: true, value: [
      { path: 'docs/00-brief.md', kind: 'markdown', size: 174 },
      { path: 'docs/00-restated.md', kind: 'markdown', size: 188 },
      { path: 'docs/01-research.md', kind: 'markdown', size: 240 },
      { path: 'docs/02-value-map.md', kind: 'markdown', size: 176 },
      { path: 'docs/03-prd.md', kind: 'markdown', size: 230 },
      { path: 'docs/04-architecture.md', kind: 'markdown', size: 212 },
      { path: 'design/palette.json', kind: 'json', size: 84 },
      { path: 'design/assets/manifest.json', kind: 'json', size: 72 },
      { path: 'design/contract.json', kind: 'json', size: 48 },
      { path: 'design/sheets/prototypes.jpg', kind: 'image', size: 24000 },
      { path: 'refs/your-pick-web.jpg', kind: 'image', size: 18500 },
      { path: 'refs/your-pick-console.jpg', kind: 'image', size: 17200 },
      { path: 'design/approved-web.jpg', kind: 'image', size: 21200 },
      { path: 'design/approved-console.jpg', kind: 'image', size: 19600 },
      { path: 'design/review/parity-web/cmp-pair.jpg', kind: 'image', size: 25800 },
      { path: 'design/review/parity-console/cmp-pair.jpg', kind: 'image', size: 23600 },
      { path: 'design/approved-web.html', kind: 'html', size: 320 },
      { path: 'specs/001-booking-calendar.md', kind: 'markdown', size: 194 },
    ] }; },
    async readProductFile(_repoPath, relPath) {
      if (relPath.endsWith('.jpg')) {
        const label = relPath.includes('console') ? 'Tidemark · Console' : 'Tidemark · Booking calendar';
        return { ok: true, value: `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600"><rect width="960" height="600" fill="currentColor" fill-opacity=".08"/><rect x="48" y="48" width="864" height="504" rx="24" fill="currentColor" fill-opacity=".02"/><rect x="48" y="48" width="864" height="70" rx="24" fill="currentColor"/><circle cx="92" cy="83" r="9" fill="currentColor" fill-opacity=".6"/><text x="120" y="90" font-family="sans-serif" font-size="24" fill="currentColor">tidemark</text><text x="90" y="184" font-family="sans-serif" font-size="34" font-weight="700" fill="currentColor">${label}</text><rect x="90" y="220" width="780" height="250" rx="18" fill="currentColor" fill-opacity=".12"/><rect x="120" y="250" width="450" height="28" rx="14" fill="currentColor" fill-opacity=".2"/><rect x="120" y="300" width="350" height="22" rx="11" fill="currentColor" fill-opacity=".15"/><rect x="120" y="354" width="200" height="76" rx="14" fill="currentColor" fill-opacity=".7"/><text x="146" y="402" font-family="sans-serif" font-size="20" fill="currentColor">Choose a time</text><rect x="610" y="248" width="220" height="188" rx="16" fill="currentColor" fill-opacity=".02" stroke="currentColor" stroke-opacity=".25"/><text x="640" y="290" font-family="sans-serif" font-size="18" fill="currentColor">October 2026</text><text x="640" y="334" font-family="sans-serif" font-size="16" fill="currentColor">09:00  ·  10:30</text></svg>` };
      }
      const content: Record<string, string> = {
        'design/palette.json': JSON.stringify({ colors: [{ name: 'Ink', color: 'var(--text)', role: 'Text' }, { name: 'Accent', color: 'var(--accent-solid)', role: 'Actions' }] }, null, 2),
        'design/assets/manifest.json': JSON.stringify({ assets: [{ path: 'refs/your-pick-web.png', credit: 'Demo artist', licence: 'CC BY 4.0' }] }, null, 2),
        'design/contract.json': JSON.stringify({ state: 'locked' }, null, 2),
        'docs/00-brief.md': '# tidemark\n\nA calm booking calendar for independent studios. Customers can find an open time, book a service, and receive a clear confirmation.',
        'docs/00-restated.md': '# Restatement\n\nBuild a simple booking calendar for independent studios so customers can book without calling or exchanging messages.',
        'docs/01-research.md': '# Research\n\nCustomers value clear availability, short booking forms, and reminders they can trust.',
        'docs/02-value-map.md': '# Value map\n\nDiscover a studio → choose a service → find a time → confirm the booking.',
        'docs/03-prd.md': '# Product requirements\n\nThe first release supports service listings, availability, booking confirmation, and calendar export.',
        'docs/04-architecture.md': '# Architecture\n\nA web booking surface backed by a small scheduling service.',
        'specs/001-booking-calendar.md': '# Booking calendar\n\nShow available times and let a customer confirm a booking.',
      };
      const text = content[relPath];
      return text === undefined ? { ok: false, error: { code: 'not_found', message: 'That product file could not be read.', fix: 'Choose a file from the Files list.' } } : { ok: true, value: text };
    },
    async startPipelineRun() { return { ok: true, value: 'j-91' as JobId }; },
    async pausePipelineRun() { return { ok: true, value: undefined }; },
    async stopPipelineRun() { return { ok: true, value: undefined }; },
    async pipelineRun() { return ok(DEMO_PIPELINE_RUN); },

    async recheck(queueId: QueueId, specId: SpecId): Promise<Result<SpecRun>> {
      void queueId;
      const found = specQueue.specs.find((s) => s.id === specId);
      if (!found) return { ok: false, error: { code: 'not_found', message: 'Spec not found', fix: 'Refresh the specs view.' } };
      found.criteria = found.criteria.map((c) => ({ ...c, state: 'met', summary: 'Passed' }));
      found.state = 'verified';
      events.fire({ type: 'spec.changed', spec: { ...found } });
      events.fire({ type: 'queue.changed', queue: { ...specQueue } });
      return ok({ ...found });
    },

    async openTerminal(queueId: QueueId, specId: SpecId, cols: number, rows: number): Promise<Result<ShellId>> {
      void queueId;
      void specId;
      void cols;
      void rows;
      return shells.open('/demo/repo', cols, rows);
    },
  };

  return {
    accounts,
    quota,
    jobs,
    runs,
    sessions,
    review,
    trust,
    shells,
    doctor,
    specs,
    emitInitialEvents,
  };
}

export function serveDemoServices(channel: ChannelServer, demo: DemoServices): void {
  channel.registerService('accounts', demo.accounts, CHANNEL_SCHEMAS.accounts);
  channel.registerService('quota', demo.quota, CHANNEL_SCHEMAS.quota);
  channel.registerService('doctor', demo.doctor, CHANNEL_SCHEMAS.doctor);
  channel.registerService('jobs', demo.jobs);
  channel.registerService('runs', demo.runs);
  channel.registerService('sessions', demo.sessions);
  channel.registerService('review', demo.review);
  channel.registerService('trust', demo.trust);
  channel.registerService('shells', demo.shells);
  channel.registerService('specs', demo.specs);
}
