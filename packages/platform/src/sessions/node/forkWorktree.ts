/**
 * Creates the fork worktree (SES-03) with git commands. Runs through the git
 * module's runGit, which takes argument arrays only.
 *
 * Copies the source worktree's committed state (its HEAD). Uncommitted edits
 * stay in the original worktree.
 */
import path from 'node:path';
import type { Result } from '@orch/contracts';
import { runGit } from '../../git/node/gitService.js';
import type { ISessionWorktrees } from '../common/sessions.js';

export class GitSessionWorktrees implements ISessionWorktrees {
  async fork(fromPath: string, branch: string): Promise<Result<{ path: string }>> {
    // Worktrees live at <repo>/.orch/wt/<run-id> (JOB-02).
    const repoRoot = path.dirname(path.dirname(path.dirname(path.resolve(fromPath))));
    const newPath = path.join(repoRoot, '.orch', 'wt', branch.slice('orch/'.length));
    try {
      const head = await runGit(['-C', path.resolve(fromPath), 'rev-parse', 'HEAD']);
      const commit = head.stdout.trim();
      await runGit(['-C', repoRoot, 'worktree', 'add', '-b', branch, newPath, commit]);
      return { ok: true, value: { path: newPath } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: { code: 'conflict', message } };
    }
  }
}
