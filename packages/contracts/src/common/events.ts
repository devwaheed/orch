/**
 * Live events from the core host to every client (window, CLI, MCP).
 * Clients subscribe once and update their stores; they never poll.
 */
import { z } from 'zod';
import { Account } from './accounts.js';
import { AccountId, JobId, RunId, SessionId, ShellId, WorktreeId } from './ids.js';
import { Job, Run, RunLine } from './jobs.js';
import { QuotaWindow } from './quota.js';
import { Session } from './sessions.js';
import { WorktreeReview } from './review.js';
import { SpecRun, SpecQueue } from './specs.js';

/** One problem in an outside edit of accounts.yaml. Same shape as the config service's field errors. */
export const ConfigFieldError = z.object({
  /** Dot path to the field, e.g. `limits.max_runs_per_account`. Empty for the whole file. */
  path: z.string(),
  line: z.number().int().nullable(),
  message: z.string(),
});
export type ConfigFieldError = z.infer<typeof ConfigFieldError>;

export const OrchEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('account.changed'), account: Account }),
  z.object({ type: z.literal('account.removed'), accountId: AccountId }),
  z.object({ type: z.literal('quota.changed'), window: QuotaWindow }),
  z.object({ type: z.literal('quota.limited'), accountId: AccountId, resetsAt: z.string().nullable() }),
  z.object({ type: z.literal('quota.available'), accountId: AccountId }),
  z.object({ type: z.literal('job.changed'), job: Job }),
  z.object({ type: z.literal('run.changed'), run: Run }),
  z.object({ type: z.literal('run.line'), line: RunLine }),
  z.object({ type: z.literal('session.changed'), session: Session }),
  z.object({ type: z.literal('review.changed'), review: WorktreeReview }),
  z.object({ type: z.literal('shell.output'), shellId: ShellId, data: z.string() }),
  z.object({ type: z.literal('shell.exited'), shellId: ShellId, code: z.number().int().nullable() }),
  z.object({ type: z.literal('engine.health'), state: z.enum(['starting', 'ready', 'restarting', 'failed']), message: z.string().optional() }),
  z.object({ type: z.literal('config.changed'), source: z.enum(['file', 'app']) }),
  z.object({ type: z.literal('config.invalid'), errors: z.array(ConfigFieldError) }),
  z.object({ type: z.literal('spec.changed'), spec: SpecRun }),
  z.object({ type: z.literal('queue.changed'), queue: SpecQueue }),
  z.object({
    type: z.literal('run.attention'),
    runId: RunId,
    reason: z.enum(['limit_ask']),
  }),
]);
export type OrchEvent = z.infer<typeof OrchEvent>;

// Re-exported for convenience in clients that switch on ids
export type { JobId, RunId, SessionId, WorktreeId };
