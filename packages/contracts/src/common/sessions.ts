import { z } from 'zod';
import { AccountId, AgentId, JobId, RunId, SessionId, Timestamp, WorktreeId } from './ids.js';

export const SessionStatus = z.enum(['live', 'paused', 'ended', 'interrupted']);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const Session = z.object({
  id: SessionId,
  jobId: JobId,
  runId: RunId.nullable(),
  title: z.string(),
  agent: AgentId,
  accountId: AccountId,
  /** The agent CLI's own session id; resumable only on the same account */
  cliSessionId: z.string(),
  status: SessionStatus,
  worktree: WorktreeId.nullable(),
  startedAt: Timestamp,
  lastActivityAt: Timestamp,
  tokens: z.number().int().nonnegative(),
  /** "Stopped at" / "Now at" */
  position: z.object({ step: z.string(), index: z.number().int(), total: z.number().int(), attempt: z.number().int(), note: z.string().optional() }),
  handedOffTo: SessionId.nullable(),
  handedOffFrom: SessionId.nullable(),
});
export type Session = z.infer<typeof Session>;

export const ResumeMode = z.enum(['same', 'account', 'agent', 'fork']);
export type ResumeMode = z.infer<typeof ResumeMode>;

export const ResumeRequest = z.discriminatedUnion('mode', [
  /** Same session, full history; waits for the account's reset if limited */
  z.object({ mode: z.literal('same'), sessionId: SessionId }),
  /** New session for the same agent on another account, same worktree, with a summary */
  z.object({ mode: z.literal('account'), sessionId: SessionId, to: AccountId }),
  /** New session on another agent, same worktree, with summary and job plan */
  z.object({ mode: z.literal('agent'), sessionId: SessionId, to: AccountId }),
  /** Copy the current state to a new branch */
  z.object({ mode: z.literal('fork'), sessionId: SessionId }),
]);
export type ResumeRequest = z.infer<typeof ResumeRequest>;

export const ResumeOption = z.object({
  mode: ResumeMode,
  available: z.boolean(),
  /** Why it isn't available, or what will happen */
  description: z.string(),
  target: AccountId.nullable(),
  waitsUntil: Timestamp.nullable(),
});
export type ResumeOption = z.infer<typeof ResumeOption>;
