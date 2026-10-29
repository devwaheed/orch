import { z } from 'zod';
import { JobId, RunId, SessionId, Timestamp, WorktreeId } from './ids.js';
import { Check } from './jobs.js';

export const Verdict = z.enum(['verified', 'refuted', 'unverified']);
export type Verdict = z.infer<typeof Verdict>;

export const CheckResult = z.object({
  check: Check,
  status: z.enum(['passed', 'failed', 'not_run']),
  /** Short human summary, e.g. "14 passed" or "1 failing" */
  summary: z.string(),
});
export type CheckResult = z.infer<typeof CheckResult>;

export const WorktreeState = z.enum(['ready', 'failing', 'in_progress', 'paused', 'interrupted', 'merged', 'discarded']);
export type WorktreeState = z.infer<typeof WorktreeState>;

export const ChangedFile = z.object({ path: z.string(), added: z.number().int().nonnegative(), removed: z.number().int().nonnegative() });
export type ChangedFile = z.infer<typeof ChangedFile>;

export const WorktreeReview = z.object({
  repoPath: z.string(),
  worktree: WorktreeId,
  jobId: JobId,
  runId: RunId.nullable(),
  sessionId: SessionId.nullable(),
  title: z.string(),
  state: WorktreeState,
  verdict: Verdict,
  checks: z.array(CheckResult),
  files: z.array(ChangedFile),
  /** Opaque reference to the engine's evidence bundle */
  evidenceRef: z.string().nullable(),
  note: z.string().nullable(),
});
export type WorktreeReview = z.infer<typeof WorktreeReview>;

/** "Stop this happening again", strongest first */
export const CorrectionLayer = z.enum(['codebase', 'lint', 'agent_rule', 'review_note']);
export type CorrectionLayer = z.infer<typeof CorrectionLayer>;

export const Correction = z.object({
  worktree: WorktreeId,
  whatWentWrong: z.string(),
  layer: CorrectionLayer,
  /** Proposed concrete action, editable by the user before starting */
  action: z.string(),
  followUpJobId: JobId.nullable(),
  createdAt: Timestamp,
});
export type Correction = z.infer<typeof Correction>;
