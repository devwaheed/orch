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
  IAccountsService,
  IDoctorService,
  IJobsService,
  IQuotaService,
  IReviewService,
  IRunsService,
  ISessionsService,
  IShellService,
  ISpecsService,
  ITrustService,
  Job,
  JobId,
  JobSpec,
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
  SpecInitReport,
  SpecLoadProblem,
  SpecQueue,
  SpecQueueSettings,
  SpendToday,
  TrustLevel,
  TrustSummary,
  WorktreeId,
  WorktreeReview,
} from '@orch/contracts';
import type { ChannelServer } from '@orch/platform/channels/common';
import { CHANNEL_SCHEMAS } from '../channelSchemas.js';

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
  let accountsList: Account[] = DEMO_ACCOUNTS.map((a) => ({ ...a }));
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
  const specQueue: SpecQueue = {
    ...DEMO_SPEC_QUEUE,
    settings: { ...DEMO_SPEC_QUEUE.settings },
    specs: DEMO_SPEC_QUEUE.specs.map((s) => ({ ...s, criteria: [...s.criteria] })),
  };
  let accountsYamlText = DEMO_ACCOUNTS_YAML_TEXT;
  const accountsFile: AccountsFile = {
    ...DEMO_ACCOUNTS_FILE,
    accounts: JSON.parse(JSON.stringify(DEMO_ACCOUNTS_FILE.accounts)),
    limits: { ...DEMO_ACCOUNTS_FILE.limits },
  };

  let nextShellNum = 1;
  let nextJobNum = 9;

  // 1. Accounts service
  const emitInitialEvents = (): void => {
    // Live-update initial events
    events.fire({ type: 'engine.health', state: 'ready' });
    events.fire({ type: 'config.changed', source: 'app' });
    events.fire({
      type: 'quota.limited',
      accountId: 'codex-personal' as AccountId,
      resetsAt: '2026-10-11T15:00:00Z',
    });
  };

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
      emitInitialEvents();
      return ok(accountsList.map((a) => ({ ...a })));
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
        profileDir: `/Users/demo/.orch/profiles/${accountId}`,
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
      return ok({ usd: 0, fromApiKeysOnly: true });
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
      return ok(`orch run "${spec.goal}"`);
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
            ? 'Reopens session with full history. Account is limited; waits until 15:00.'
            : 'Reopens session with full history.',
          target: found?.accountId ?? null,
          waitsUntil: isLimited ? '2026-10-11T15:00:00Z' : null,
        },
        {
          mode: 'account',
          available: true,
          description: 'Hand off to another account in the same worktree.',
          target: 'codex-team' as AccountId,
          waitsUntil: null,
        },
        {
          mode: 'agent',
          available: true,
          description: 'Hand off to another agent with summary and job plan.',
          target: 'claude-personal' as AccountId,
          waitsUntil: null,
        },
        {
          mode: 'fork',
          available: true,
          description: 'Copy current state to a new branch.',
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

    async get(worktree: WorktreeId): Promise<Result<WorktreeReview>> {
      const found = reviewsList.find((r) => r.worktree === worktree);
      if (!found) {
        return err({ code: 'not_found', message: `Worktree ${worktree} not found`, fix: 'Check worktree id' });
      }
      return ok({ ...found, checks: [...found.checks], files: [...found.files] });
    },

    async diff(worktree: WorktreeId, path: string): Promise<Result<{ before: string; after: string }>> {
      void worktree;
      const found = diffsMap.get(path);
      if (!found) {
        return ok({ before: '', after: `// ${path} content` });
      }
      return ok({ ...found });
    },

    async approveAndMerge(worktree: WorktreeId): Promise<Result<void>> {
      const found = reviewsList.find((r) => r.worktree === worktree);
      if (found) {
        found.state = 'merged';
        found.verdict = 'verified';
        events.fire({ type: 'review.changed', review: { ...found } });
      }
      return ok(undefined);
    },

    async requestChanges(worktree: WorktreeId, feedback: string): Promise<Result<void>> {
      void feedback;
      const found = reviewsList.find((r) => r.worktree === worktree);
      if (found) {
        found.state = 'in_progress';
        events.fire({ type: 'review.changed', review: { ...found } });
      }
      return ok(undefined);
    },

    async discard(worktree: WorktreeId): Promise<Result<void>> {
      const found = reviewsList.find((r) => r.worktree === worktree);
      if (found) {
        found.state = 'discarded';
        events.fire({ type: 'review.changed', review: { ...found } });
      }
      return ok(undefined);
    },

    async correct(worktree: WorktreeId, layer: CorrectionLayer, action: string): Promise<Result<{ followUpJobId: JobId | null }>> {
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
      void cwd;
      void cols;
      void rows;
      const id = `sh-${nextShellNum++}` as ShellId;
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

    async load(repoPath: string): Promise<Result<{ queue: SpecQueue | null; problems: SpecLoadProblem[] }>> {
      void repoPath;
      return ok({
        queue: {
          ...specQueue,
          settings: { ...specQueue.settings },
          specs: specQueue.specs.map((s) => ({ ...s, criteria: [...s.criteria] })),
        },
        problems: [],
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
