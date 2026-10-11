import { z } from 'zod';
import { AccountId, AgentId, JobId, RunId, SessionId, Timestamp, WorktreeId } from './ids.js';

export const JobMode = z.enum(['single', 'compare', 'council', 'autoloop']);
export type JobMode = z.infer<typeof JobMode>;

/** "How do we know it's done?" Run by orch, never by the agent. */
export const Check = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('command'), run: z.string().min(1), cwd: z.string().optional() }),
  z.object({ kind: z.literal('http'), url: z.string().url(), expectStatus: z.number().int().default(200) }),
  z.object({ kind: z.literal('screenshot'), url: z.string().url(), name: z.string() }),
  z.object({ kind: z.literal('file_rule'), allow: z.array(z.string()).min(1) }),
  /** Always on; cannot be removed by the user or an agent */
  z.object({ kind: z.literal('guardrail'), rule: z.enum(['no_new_suppressions', 'protected_files']) }),
]);
export type Check = z.infer<typeof Check>;

export const LimitPolicy = z.enum(['switch-account', 'switch-agent', 'ask']);
export type LimitPolicy = z.infer<typeof LimitPolicy>;

/** `auto` lets the router pick the account with room. */
export const AgentChoice = z.object({ agent: AgentId, account: z.union([z.literal('auto'), AccountId]) });
export type AgentChoice = z.infer<typeof AgentChoice>;

const JobBase = z.object({
  goal: z.string().min(1).max(20_000),
  repoPath: z.string(),
  checks: z.array(Check).default([]),
  onLimit: LimitPolicy.default('switch-account'),
  /** Optional BMAD story file used as the goal source */
  storyPath: z.string().optional(),
});

export const JobSpec = z.discriminatedUnion('mode', [
  JobBase.extend({ mode: z.literal('single'), orchestrator: AgentChoice, workers: z.array(AgentId).min(1) }),
  JobBase.extend({ mode: z.literal('compare'), agents: z.array(AgentId).min(2), combine: z.boolean().default(true) }),
  JobBase.extend({ mode: z.literal('council'), agents: z.array(AgentId).min(2), maxRounds: z.number().int().min(1).max(10).default(5) }),
  JobBase.extend({
    mode: z.literal('autoloop'),
    roles: z.object({ planner: AgentId, coder: AgentId, reviewer: AgentId }),
  }),
]);
export type JobSpec = z.infer<typeof JobSpec>;

/** The one-line "Now: Implement · step 2 of 5 · try 1" */
export const JobStep = z.object({
  name: z.string(),
  index: z.number().int().min(1),
  total: z.number().int().min(1),
  attempt: z.number().int().min(1),
  /** true when the same step has failed 2+ times */
  looping: z.boolean(),
});
export type JobStep = z.infer<typeof JobStep>;

export const JobStatus = z.enum(['scheduled', 'running', 'waiting_quota', 'paused', 'done', 'failed', 'cancelled']);
export type JobStatus = z.infer<typeof JobStatus>;

export const Job = z.object({
  id: JobId,
  title: z.string(),
  spec: JobSpec,
  status: JobStatus,
  step: JobStep.nullable(),
  createdAt: Timestamp,
  scheduledFor: Timestamp.nullable(),
});
export type Job = z.infer<typeof Job>;

export const RunRole = z.enum(['orchestrator', 'implementer', 'reviewer', 'tester', 'writer', 'planner', 'coder', 'member']);
export type RunRole = z.infer<typeof RunRole>;

export const RunStatus = z.enum(['queued', 'running', 'paused_limit', 'done', 'failed', 'stopped']);
export type RunStatus = z.infer<typeof RunStatus>;

export const Run = z.object({
  id: RunId,
  jobId: JobId,
  parentId: RunId.nullable(),
  depth: z.number().int().min(0).max(5),
  role: RunRole,
  task: z.string(),
  agent: AgentId,
  accountId: AccountId,
  status: RunStatus,
  worktree: WorktreeId.nullable(),
  readOnly: z.boolean(),
  sessionId: SessionId.nullable(),
  startedAt: Timestamp.nullable(),
  /** When paused_limit: when the account resets */
  resumesAt: Timestamp.nullable(),
});
export type Run = z.infer<typeof Run>;

/** One line in an agent pane. `seq` is per run and strictly increasing. */
export const RunLine = z.object({
  runId: RunId,
  seq: z.number().int().nonnegative(),
  at: Timestamp,
  kind: z.enum(['meta', 'prompt', 'message', 'tool', 'diff_add', 'diff_del', 'ok', 'err', 'limit', 'spawn']),
  text: z.string(),
});
export type RunLine = z.infer<typeof RunLine>;
