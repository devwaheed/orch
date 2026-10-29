/**
 * Drizzle schema for orch's database (SEC-04: `~/.orch/orch.db`). Plain
 * TypeScript. The SQL that creates these tables lives in `migrations.ts` and
 * must match this file column for column (a test checks it).
 */
import { foreignKey, index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import {
  AccountState,
  AgentId,
  type Account,
  type CheckResult,
  type ChangedFile,
  type CorrectionLayer,
  CorrectionLayer as CorrectionLayerValues,
  type JobSpec,
  type JobStep,
  JobStatus,
  type ProviderLogin,
  type QuotaWindowKind,
  QuotaWindowKind as QuotaWindowKindValues,
  RunRole,
  RunStatus,
  Session,
  SessionStatus,
  Verdict,
  WorktreeState,
} from '@orchagents/contracts';

export const accountTable = sqliteTable('account', {
  id: text('id').primaryKey(),
  agent: text('agent', { enum: AgentId.options }).notNull(),
  name: text('name').notNull(),
  isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
  useEnabled: integer('use_enabled', { mode: 'boolean' }).notNull().default(true),
  state: text('state', { enum: AccountState.options }).notNull(),
  emailMasked: text('email_masked'),
  plan: text('plan'),
  profileDir: text('profile_dir').notNull(),
  skillsShared: integer('skills_shared', { mode: 'boolean' }).notNull().default(true),
  providers: text('providers', { mode: 'json' }).$type<ProviderLogin[]>(),
  lastIsolationCheck: text('last_isolation_check', { mode: 'json' }).$type<NonNullable<Account['lastIsolationCheck']>>(),
  /** Needed for ACC-05 (oldest remaining account becomes primary) and ACC-06 ties. */
  createdAt: text('created_at').notNull(),
});

export const quotaWindowTable = sqliteTable(
  'quota_window',
  {
    accountId: text('account_id').notNull().references(() => accountTable.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: QuotaWindowKindValues.options }).$type<QuotaWindowKind>().notNull(),
    usedPct: real('used_pct').notNull(),
    resetsAt: text('resets_at'),
    source: text('source', { enum: ['reported', 'estimated'] }).notNull(),
    seenAt: text('seen_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.kind] })],
);

export const jobTable = sqliteTable(
  'job',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    mode: text('mode', { enum: ['single', 'compare', 'council', 'autoloop'] }).notNull(),
    /** The whole JobSpec as JSON (contracts `JobSpec`). */
    spec: text('spec', { mode: 'json' }).$type<JobSpec>().notNull(),
    status: text('status', { enum: JobStatus.options }).notNull(),
    step: text('step', { mode: 'json' }).$type<JobStep>(),
    createdAt: text('created_at').notNull(),
    scheduledFor: text('scheduled_for'),
  },
  (t) => [index('job_status').on(t.status)],
);

export const runLinkTable = sqliteTable(
  'run_link',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id').notNull().references(() => jobTable.id, { onDelete: 'cascade' }),
    parentId: text('parent_id'),
    depth: integer('depth').notNull(),
    role: text('role', { enum: RunRole.options }).notNull(),
    task: text('task').notNull(),
    agent: text('agent', { enum: AgentId.options }).notNull(),
    accountId: text('account_id').notNull(),
    status: text('status', { enum: RunStatus.options }).notNull(),
    worktree: text('worktree'),
    readOnly: integer('read_only', { mode: 'boolean' }).notNull(),
    sessionId: text('session_id'),
    /** The agent CLI's own session id, kept apart from orch's (contracts ids.ts). */
    cliSessionId: text('cli_session_id'),
    startedAt: text('started_at'),
    resumesAt: text('resumes_at'),
    /** Auto-resume checkbox on a paused-by-limit run (QTA-04). */
    autoResume: integer('auto_resume', { mode: 'boolean' }).notNull().default(true),
    /** When a paused-by-limit run resumes by itself: reset time plus jitter (QTA-04). */
    resumeFireAt: text('resume_fire_at'),
  },
  (t) => [index('run_link_job').on(t.jobId)],
);

export const reviewTable = sqliteTable(
  'review',
  {
    repoPath: text('repo_path').notNull(),
    worktree: text('worktree').notNull(),
    jobId: text('job_id').notNull().references(() => jobTable.id, { onDelete: 'cascade' }),
    runId: text('run_id'),
    sessionId: text('session_id'),
    title: text('title').notNull(),
    state: text('state', { enum: WorktreeState.options }).notNull(),
    verdict: text('verdict', { enum: Verdict.options }).notNull(),
    checks: text('checks', { mode: 'json' }).$type<CheckResult[]>().notNull(),
    files: text('files', { mode: 'json' }).$type<ChangedFile[]>().notNull(),
    evidenceRef: text('evidence_ref'),
    note: text('note'),
  },
  (t) => [primaryKey({ columns: [t.repoPath, t.worktree] })],
);

export const correctionTable = sqliteTable(
  'correction',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    repoPath: text('repo_path').notNull(),
    worktree: text('worktree').notNull(),
    whatWentWrong: text('what_went_wrong').notNull(),
    layer: text('layer', { enum: CorrectionLayerValues.options }).$type<CorrectionLayer>().notNull(),
    action: text('action').notNull(),
    followUpJobId: text('follow_up_job_id').references(() => jobTable.id, { onDelete: 'set null' }),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('correction_worktree').on(t.repoPath, t.worktree),
    foreignKey({ columns: [t.repoPath, t.worktree], foreignColumns: [reviewTable.repoPath, reviewTable.worktree] }).onDelete('cascade'),
  ],
);

export const trustLevelTable = sqliteTable('trust_level', {
  agent: text('agent', { enum: AgentId.options }).primaryKey(),
  level: integer('level').notNull(),
  changedAt: text('changed_at').notNull(),
});

/** SES: one row per agent conversation orch knows about (sessions.ts Session, plus the engine handle and folder). */
export const sessionTable = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id').notNull().references(() => jobTable.id, { onDelete: 'cascade' }),
    runId: text('run_id'),
    title: text('title').notNull(),
    agent: text('agent', { enum: AgentId.options }).notNull(),
    accountId: text('account_id').notNull(),
    cliSessionId: text('cli_session_id').notNull(),
    status: text('status', { enum: SessionStatus.options }).notNull(),
    worktree: text('worktree'),
    startedAt: text('started_at').notNull(),
    lastActivityAt: text('last_activity_at').notNull(),
    tokens: integer('tokens').notNull().default(0),
    position: text('position', { mode: 'json' }).$type<Session['position']>().notNull(),
    handedOffTo: text('handed_off_to'),
    handedOffFrom: text('handed_off_from'),
    /** Claw's handle for the session (null when the engine never started it). */
    engineHandle: text('engine_handle'),
    /** The folder the session runs in. Claw hands off only within the same folder. */
    cwd: text('cwd'),
  },
  (t) => [index('session_engine_handle').on(t.engineHandle)],
);

/** QTA: the account's limit, when one is in force. A null resetsAt means the agent did not say when it resets. */
export const quotaLimitTable = sqliteTable('quota_limit', {
  accountId: text('account_id').primaryKey().references(() => accountTable.id, { onDelete: 'cascade' }),
  resetsAt: text('resets_at'),
});

/** QTA-02: the request count for an estimated window. */
export const quotaEstimateTable = sqliteTable('quota_estimate', {
  accountId: text('account_id').primaryKey().references(() => accountTable.id, { onDelete: 'cascade' }),
  window: text('window', { enum: QuotaWindowKindValues.options }).$type<QuotaWindowKind>(),
  requestsSinceReset: integer('requests_since_reset').notNull().default(0),
  learnedLimit: integer('learned_limit'),
  resetsAt: text('resets_at'),
});

export const storeSchema = {
  sessionTable,
  quotaLimitTable,
  quotaEstimateTable,
  accountTable,
  quotaWindowTable,
  jobTable,
  runLinkTable,
  reviewTable,
  correctionTable,
  trustLevelTable,
};
