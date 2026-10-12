import { createServiceId } from '@orchagents/base';
import type { ChangedFile, OrchError, Result } from '@orchagents/contracts';

export interface CreateWorktreeOptions {
  readonly repoPath: string;
  readonly runId: string;
  readonly targetBranch?: string;
}

export interface CreateWorktreeResult {
  readonly worktreePath: string;
  readonly branch: string;
  readonly targetBranch: string;
}

export interface RemoveWorktreeOptions {
  readonly repoPath: string;
  readonly runId: string;
  readonly deleteBranch?: boolean;
}

export interface IGitService {
  ensureExclude(repoPath: string): Promise<Result<void>>;
  getDefaultBranch(repoPath: string): Promise<Result<string>>;
  createWorktree(options: CreateWorktreeOptions): Promise<Result<CreateWorktreeResult>>;
  removeWorktree(options: RemoveWorktreeOptions): Promise<Result<void>>;
  getChangedFiles(worktreePath: string, targetBranch: string): Promise<Result<ChangedFile[]>>;
  getDiff(worktreePath: string, targetBranch: string, filePath?: string): Promise<Result<string>>;
}

export const IGitService = createServiceId<IGitService>('git');

export const GIT_ERRORS = {
  notGitRepo: (repoPath: string): OrchError => ({
    code: 'validation_failed',
    message: `The folder at ${repoPath} is not a git repository.`,
    fix: 'Initialize a git repository with git init or choose a valid git repository folder.',
  }),
  worktreeFailed: (message: string): OrchError => ({
    code: 'conflict',
    message: `Could not create a worktree: ${message}`,
    fix: 'Check if a branch or worktree with the same name already exists, or run git worktree prune.',
  }),
  diffFailed: (message: string): OrchError => ({
    code: 'internal',
    message: `Could not compute git diff: ${message}`,
    fix: 'Check the repository state and target branch, then try again.',
  }),
  commandFailed: (message: string): OrchError => ({
    code: 'internal',
    message: `Git command failed: ${message}`,
    fix: 'Verify git is installed and working, then try again.',
  }),
};
