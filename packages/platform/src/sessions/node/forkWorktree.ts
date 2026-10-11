/**
 * Creates the fork worktree (SES-03) with git commands. Runs through the git
 * module's runGit, which takes argument arrays only.
 *
 * SES-03: a new branch from the current worktree state. The fork gets the source's
 * commit plus its uncommitted edits (tracked changes and new files). The source is
 * not changed.
 */
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Result } from '@orch/contracts';
import { runGit } from '../../git/node/gitService.js';
import type { ISessionWorktrees } from '../common/sessions.js';

export class GitSessionWorktrees implements ISessionWorktrees {
  async fork(fromPath: string, branch: string): Promise<Result<{ path: string }>> {
    // Worktrees live at <repo>/.orch/wt/<run-id> (JOB-02).
    const source = path.resolve(fromPath);
    const repoRoot = path.dirname(path.dirname(path.dirname(source)));
    const newPath = path.join(repoRoot, '.orch', 'wt', branch.slice('orch/'.length));
    try {
      const head = await runGit(['-C', source, 'rev-parse', 'HEAD']);
      const commit = head.stdout.trim();
      await runGit(['-C', repoRoot, 'worktree', 'add', '-b', branch, newPath, commit]);
      await carryWorkingState(source, newPath);
      return { ok: true, value: { path: newPath } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: { code: 'conflict', message } };
    }
  }
}

/** Copies the source's uncommitted tracked changes (as a patch) and its untracked files into the fork. */
async function carryWorkingState(source: string, target: string): Promise<void> {
  const diff = (await runGit(['-C', source, 'diff', 'HEAD', '--binary'])).stdout;
  if (diff.trim().length > 0) {
    const dir = await mkdtemp(path.join(tmpdir(), 'orch-fork-'));
    try {
      const file = path.join(dir, 'working-state.patch');
      // execa strips the final newline of stdout; git needs it back to read the last hunk.
      await writeFile(file, `${diff}\n`, 'utf8');
      await runGit(['-C', target, 'apply', '--binary', file]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  const untracked = (await runGit(['-C', source, 'ls-files', '--others', '--exclude-standard', '-z'])).stdout.split('\0').filter((p) => p.length > 0);
  for (const rel of untracked) {
    await mkdir(path.dirname(path.join(target, rel)), { recursive: true });
    await copyFile(path.join(source, rel), path.join(target, rel));
  }
}
