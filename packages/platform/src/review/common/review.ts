import { createServiceId } from '@orch/base';
import type { IReviewService as IReviewServiceContract, OrchError } from '@orch/contracts';

export type IReviewService = IReviewServiceContract;
export const IReviewService = createServiceId<IReviewService>('review');

export const REVIEW_ERRORS = {
  notFound: (worktree: string): OrchError => ({
    code: 'not_found',
    message: `Worktree review not found: ${worktree}`,
    fix: 'Check the worktree id and try again.',
  }),
  notVerified: (verdict: string): OrchError => ({
    code: 'not_verified',
    message: `Only verified work can be merged (current verdict: ${verdict}).`,
    fix: 'Wait for checks to pass or request changes before merging.',
  }),
  checksFailedAfterRebase: (reason?: string): OrchError => ({
    code: 'not_verified',
    message: reason ? `Checks failed after rebasing onto main: ${reason}` : 'Checks failed after rebasing onto main.',
    fix: 'Resolve the check failures or request changes.',
  }),
  mergeConflict: (branch: string, details?: string): OrchError => ({
    code: 'merge_conflict',
    message: `Could not rebase worktree onto ${branch} due to merge conflict.${details ? ` ${details}` : ''}`,
    fix: 'Resolve merge conflicts in the worktree or request changes.',
  }),
  worktreeDirty: (details?: string): OrchError => ({
    code: 'worktree_dirty',
    message: `Working directory has uncommitted changes.${details ? ` ${details}` : ''}`,
    fix: 'Commit or stash changes before continuing.',
  }),
  internal: (message: string): OrchError => ({
    code: 'internal',
    message,
    fix: 'Check git and engine state, then try again.',
  }),
  noJobsService: (): OrchError => ({
    code: 'internal',
    message: 'The jobs service is not available, so a correction job cannot be started.',
    fix: 'Restart orch and try again.',
  }),
  missingRunForSpec: (worktree: string): OrchError => ({
    code: 'not_found',
    message: `No run found for ${worktree}; a correction job needs the original run's agent.`,
    fix: 'Select a worktree that has an associated run.',
  }),
  agentsMdFailed: (message: string): OrchError => ({
    code: 'internal',
    message: `Could not update AGENTS.md: ${message}`,
    fix: 'Check that AGENTS.md is writable and try again.',
  }),
};
