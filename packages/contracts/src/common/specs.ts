/**
 * Spec queue: an ordered list of specs (stories) that orch runs one after
 * another, moving on by itself. Behaviour is defined in docs/specs/spec-queue.md;
 * every value here is a locked decision (docs/decisions/LOCKED.md, section L-SQ).
 */
import { z } from 'zod';
import { AccountId, AgentId, JobId, Timestamp, WorktreeId } from './ids.js';
import { Check, JobMode } from './jobs.js';

export const SpecId = z.string().regex(/^[0-9]{1,4}$/).brand<'SpecId'>();
export type SpecId = z.infer<typeof SpecId>;

export const QueueId = z.string().regex(/^q-[0-9a-z]+$/).brand<'QueueId'>();
export type QueueId = z.infer<typeof QueueId>;

/** One "done when" line: either a check orch runs, or an audit by a different agent. */
export const DoneWhen = z.discriminatedUnion('by', [
  z.object({ by: z.literal('check'), text: z.string().min(1), check: Check }),
  z.object({ by: z.literal('audit'), text: z.string().min(1) }),
]);
export type DoneWhen = z.infer<typeof DoneWhen>;

/** Front matter of a spec file (docs/specs/templates/spec.md). */
export const SpecFile = z
  .object({
    id: z.string().regex(/^[0-9]{1,4}$/),
    title: z.string().min(1).max(120),
    depends_on: z.array(z.string().regex(/^[0-9]{1,4}$/)).default([]),
    /** Repo-relative globs this spec may change. Empty = runs alone (never in parallel). */
    scope: z.array(z.string().min(1)).default([]),
    done_when: z.array(DoneWhen).min(1),
    /** Optional preferred implementer; the router still picks the account. */
    agent: z.union([z.literal('auto'), AgentId]).default('auto'),
    /** How agents work on it, as in New spec (ADR 0013). */
    mode: JobMode.default('single'),
    /** compare/council: the agents (2+); autoloop: planner, coder, reviewer. Empty = orch picks. */
    agents: z.array(AgentId).default([]),
  })
  .strict();
export type SpecFile = z.infer<typeof SpecFile>;

/** What New spec sends; orch writes `<source>/<NNN>-<slug>.md` with the next free id (ADR 0013). */
export const SpecDraft = z
  .object({
    title: z.string().trim().min(1).max(120),
    /** The goal given to the agents, below the front matter */
    body: z.string().max(20_000).default(''),
    /** Ids of specs this one waits for. A new spec always gets the highest id, so these are earlier. */
    depends_on: z.array(z.string().regex(/^[0-9]{1,4}$/)).default([]),
    mode: JobMode.default('single'),
    agent: z.union([z.literal('auto'), AgentId]).default('auto'),
    agents: z.array(AgentId).default([]),
    scope: z.array(z.string().min(1)).default([]),
    /** Empty = one audit line, SPEC_DEFAULT_AUDIT */
    done_when: z.array(DoneWhen).default([]),
    /** true = moves it ahead of every other queued spec */
    runNext: z.boolean().default(false),
  })
  .strict();
export type SpecDraft = z.infer<typeof SpecDraft>;

/** The audit line a new spec gets when it has no done-when lines (ADR 0013). */
export const SPEC_DEFAULT_AUDIT = 'The goal is met';

export const SpecOrder = z.enum(['strict', 'waves']);
export type SpecOrder = z.infer<typeof SpecOrder>;

export const SpecAdvance = z.enum(['verified', 'approved', 'merged']);
export type SpecAdvance = z.infer<typeof SpecAdvance>;

export const SpecOnFail = z.enum(['retry-stop', 'retry-skip']);
export type SpecOnFail = z.infer<typeof SpecOnFail>;

/** Locked defaults. Changing any of these is a decision change (new ADR). */
export const SPEC_QUEUE_DEFAULTS = {
  order: 'waves',
  advance: 'verified',
  onFail: 'retry-stop',
  maxParallel: 2,
  /** Total tries per spec = 1 + retries */
  retries: 2,
} as const satisfies { order: SpecOrder; advance: SpecAdvance; onFail: SpecOnFail; maxParallel: number; retries: number };

/** Repo settings file `.orch/specs.yaml`. */
export const SpecQueueSettings = z
  .object({
    source: z.string().default('docs/specs'),
    order: SpecOrder.default(SPEC_QUEUE_DEFAULTS.order),
    advance: SpecAdvance.default(SPEC_QUEUE_DEFAULTS.advance),
    on_fail: SpecOnFail.default(SPEC_QUEUE_DEFAULTS.onFail),
    max_parallel: z.number().int().min(1).max(4).default(SPEC_QUEUE_DEFAULTS.maxParallel),
    retries: z.number().int().min(0).max(5).default(SPEC_QUEUE_DEFAULTS.retries),
    /** Shell gates run after every verified spec, e.g. timed e2e and smoke */
    after_each: z.array(z.object({ name: z.string(), run: z.string(), timeout_s: z.number().int().min(1).max(3600) })).default([]),
  })
  .strict();
export type SpecQueueSettings = z.infer<typeof SpecQueueSettings>;

/**
 * Spec states. Transitions are listed in docs/specs/spec-queue.md §4 and are the
 * ONLY allowed ones; the queue service rejects anything else.
 */
export const SpecState = z.enum([
  'queued',         // waiting for its turn; dependencies may already be satisfied
  'blocked',        // a dependency is skipped or needs_you
  'waiting_quota',  // ready, but no account has room
  'running',        // implement step
  'verifying',      // orch runs checks and guardrails
  'auditing',       // a different agent audits the audit criteria
  'verified',       // all done-when met; awaiting your review (advance=verified lets the queue move on)
  'approved',       // you approved; merge pending (merges happen in queue order)
  'merged',
  'needs_you',      // failed every try with on_fail=retry-stop
  'skipped',        // failed every try with on_fail=retry-skip, or skipped by you
  'cancelled',
]);
export type SpecState = z.infer<typeof SpecState>;

export const CriterionResult = z.object({
  index: z.number().int().min(0),
  state: z.enum(['pending', 'running', 'met', 'not_met']),
  /** e.g. "14 passed" or the auditor's one-line reason */
  summary: z.string().nullable(),
  auditor: z.object({ agent: AgentId, accountId: AccountId, sameAgent: z.boolean() }).nullable(),
});
export type CriterionResult = z.infer<typeof CriterionResult>;

/** One state change of a spec, appended by the queue service. The Plan view's stage times and events strip read it. */
export const SpecStateChange = z.object({
  state: SpecState,
  at: Timestamp,
  attempt: z.number().int().min(1).nullable(),
});
export type SpecStateChange = z.infer<typeof SpecStateChange>;

/** Tokens and cost of a spec's runs in one clock hour, from the engine ledger. */
export const SpecUsageHour = z.object({
  /** Start of the hour */
  hour: Timestamp,
  tokens: z.number().int().nonnegative(),
  usd: z.number().nonnegative(),
});
export type SpecUsageHour = z.infer<typeof SpecUsageHour>;

export const SpecRun = z.object({
  id: SpecId,
  queueId: QueueId,
  position: z.number().int().min(1),
  file: z.string(),
  spec: SpecFile,
  state: SpecState,
  /** 1-based; null before the first try */
  attempt: z.number().int().min(1).nullable(),
  jobId: JobId.nullable(),
  worktree: WorktreeId.nullable(),
  implementer: z.object({ agent: AgentId, accountId: AccountId }).nullable(),
  criteria: z.array(CriterionResult),
  blockedBy: z.array(SpecId),
  startedAt: Timestamp.nullable(),
  finishedAt: Timestamp.nullable(),
  tokens: z.number().int().nonnegative(),
  /** Oldest first. Missing in state saved before it existed. */
  history: z.array(SpecStateChange).default([]),
});
export type SpecRun = z.infer<typeof SpecRun>;

export const SpecQueue = z.object({
  id: QueueId,
  repoPath: z.string(),
  settings: SpecQueueSettings,
  paused: z.boolean(),
  specs: z.array(SpecRun),
  createdAt: Timestamp,
});
export type SpecQueue = z.infer<typeof SpecQueue>;

/** Problems found when loading spec files. The queue does not start while any exist. */
export const SpecLoadProblem = z.object({
  file: z.string(),
  code: z.enum(['invalid_front_matter', 'duplicate_id', 'unknown_dependency', 'dependency_later_in_order', 'dependency_cycle', 'scope_outside_repo']),
  message: z.string(),
});
export type SpecLoadProblem = z.infer<typeof SpecLoadProblem>;

/** One story that `orch specs init` gave front matter to (spec-queue.md §2, §13). */
export const SpecInitItem = z.object({
  file: z.string(),
  id: z.string(),
  title: z.string(),
  criteriaCount: z.number().int().nonnegative(),
});
export type SpecInitItem = z.infer<typeof SpecInitItem>;

/** Result of `orch specs init`: what was added, and which stories already had front matter. */
export const SpecInitReport = z.object({
  added: z.array(SpecInitItem),
  skipped: z.array(z.string()),
});
export type SpecInitReport = z.infer<typeof SpecInitReport>;
