/**
 * Where a run's worktree lives: <repo>/.orch/wt/<run-id>/ (LOCKED JOB-02).
 * Pure string logic: the browser has no path module. Joins with '\' when the repo path
 * uses it (Windows), else '/'.
 */
export function runWorktreePath(repoPath: string, runId: string): string {
  const sep = repoPath.includes('\\') ? '\\' : '/';
  const base = repoPath.replace(/[\\/]+$/, '');
  return [base, '.orch', 'wt', runId].join(sep);
}
