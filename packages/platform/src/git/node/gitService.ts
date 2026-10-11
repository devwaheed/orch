import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import type { ChangedFile, Result } from '@orch/contracts';
import {
  type CreateWorktreeOptions,
  type CreateWorktreeResult,
  GIT_ERRORS,
  type IGitService,
  type RemoveWorktreeOptions,
} from '../common/git.js';

export class GitService implements IGitService {
  async ensureExclude(repoPath: string): Promise<Result<void>> {
    try {
      let excludePath: string;
      try {
        const { stdout } = await execa('git', ['-C', repoPath, 'rev-parse', '--git-path', 'info/exclude']);
        const relOrAbs = stdout.trim();
        excludePath = path.isAbsolute(relOrAbs) ? relOrAbs : path.resolve(repoPath, relOrAbs);
      } catch {
        excludePath = path.join(repoPath, '.git', 'info', 'exclude');
      }

      const dir = path.dirname(excludePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      let content = '';
      if (fs.existsSync(excludePath)) {
        content = fs.readFileSync(excludePath, 'utf8');
      }

      const lines = content.split('\n').map((l) => l.trim());
      const hasOrch = lines.some((l) => l === '.orch' || l === '.orch/' || l === '/.orch' || l === '/.orch/');
      if (!hasOrch) {
        const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
        fs.appendFileSync(excludePath, `${prefix}.orch/\n`, 'utf8');
      }

      return { ok: true, value: undefined };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: GIT_ERRORS.commandFailed(msg) };
    }
  }

  async getDefaultBranch(repoPath: string): Promise<Result<string>> {
    try {
      // 1. Try origin HEAD symbolic ref
      try {
        const { stdout } = await execa('git', ['-C', repoPath, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
        const branch = stdout.trim().replace(/^origin\//, '');
        if (branch) return { ok: true, value: branch };
      } catch {
        // ignore
      }

      // 2. Try current branch
      try {
        const { stdout } = await execa('git', ['-C', repoPath, 'branch', '--show-current']);
        const branch = stdout.trim();
        if (branch) return { ok: true, value: branch };
      } catch {
        // ignore
      }

      // 3. Try rev-parse HEAD
      try {
        const { stdout } = await execa('git', ['-C', repoPath, 'rev-parse', '--abbrev-ref', 'HEAD']);
        const branch = stdout.trim();
        if (branch && branch !== 'HEAD') return { ok: true, value: branch };
      } catch {
        // ignore
      }

      // 4. Check if main or master exists
      try {
        const { stdout } = await execa('git', ['-C', repoPath, 'branch', '--list', 'main', 'master']);
        const branches = stdout.split('\n').map((b) => b.replace(/^\*?\s+/, '').trim());
        if (branches.includes('main')) return { ok: true, value: 'main' };
        if (branches.includes('master')) return { ok: true, value: 'master' };
      } catch {
        // ignore
      }

      return { ok: true, value: 'main' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: GIT_ERRORS.commandFailed(msg) };
    }
  }

  async createWorktree(options: CreateWorktreeOptions): Promise<Result<CreateWorktreeResult>> {
    const { repoPath, runId } = options;
    try {
      const excludeRes = await this.ensureExclude(repoPath);
      if (!excludeRes.ok) return excludeRes;

      let targetBranch = options.targetBranch;
      if (!targetBranch) {
        const defaultBranchRes = await this.getDefaultBranch(repoPath);
        if (!defaultBranchRes.ok) return defaultBranchRes;
        targetBranch = defaultBranchRes.value;
      }

      const worktreePath = path.join(repoPath, '.orch', 'wt', runId);
      const branch = `orch/${runId}`;

      // Check if worktree directory already exists
      if (fs.existsSync(worktreePath)) {
        return { ok: true, value: { worktreePath, branch, targetBranch } };
      }

      const wtParent = path.dirname(worktreePath);
      if (!fs.existsSync(wtParent)) {
        fs.mkdirSync(wtParent, { recursive: true });
      }

      // Try creating with new branch
      try {
        await execa('git', ['-C', repoPath, 'worktree', 'add', '-b', branch, worktreePath, targetBranch]);
      } catch {
        // If branch already exists, attach to it
        await execa('git', ['-C', repoPath, 'worktree', 'add', worktreePath, branch]);
      }

      return { ok: true, value: { worktreePath, branch, targetBranch } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: GIT_ERRORS.worktreeFailed(msg) };
    }
  }

  async removeWorktree(options: RemoveWorktreeOptions): Promise<Result<void>> {
    const { repoPath, runId, deleteBranch } = options;
    const worktreePath = path.join(repoPath, '.orch', 'wt', runId);
    try {
      if (fs.existsSync(worktreePath)) {
        await execa('git', ['-C', repoPath, 'worktree', 'remove', '--force', worktreePath]);
      }
      if (deleteBranch) {
        const branch = `orch/${runId}`;
        try {
          await execa('git', ['-C', repoPath, 'branch', '-D', branch]);
        } catch {
          // ignore if branch already deleted
        }
      }
      return { ok: true, value: undefined };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: GIT_ERRORS.commandFailed(msg) };
    }
  }

  async getChangedFiles(worktreePath: string, targetBranch: string): Promise<Result<ChangedFile[]>> {
    try {
      const filesMap = new Map<string, ChangedFile>();

      // 1. git diff --numstat targetBranch
      try {
        const { stdout } = await execa('git', ['-C', worktreePath, 'diff', '--numstat', targetBranch]);
        for (const line of stdout.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const [addedStr, removedStr, ...rest] = trimmed.split('\t');
          if (!addedStr || !removedStr) continue;
          const filePath = rest.join('\t');
          if (!filePath) continue;
          const added = parseInt(addedStr, 10);
          const removed = parseInt(removedStr, 10);
          filesMap.set(filePath, {
            path: filePath,
            added: Number.isFinite(added) ? added : 0,
            removed: Number.isFinite(removed) ? removed : 0,
          });
        }
      } catch {
        // ignore
      }

      // 2. Untracked files from git status --porcelain
      try {
        const { stdout } = await execa('git', ['-C', worktreePath, 'status', '--porcelain']);
        for (const line of stdout.split('\n')) {
          if (line.startsWith('?? ')) {
            const relPath = line.slice(3).trim();
            if (!filesMap.has(relPath)) {
              let added = 0;
              try {
                const fullPath = path.join(worktreePath, relPath);
                if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
                  const content = fs.readFileSync(fullPath, 'utf8');
                  added = content ? content.split('\n').length : 0;
                }
              } catch {
                // ignore
              }
              filesMap.set(relPath, { path: relPath, added, removed: 0 });
            }
          }
        }
      } catch {
        // ignore
      }

      return { ok: true, value: Array.from(filesMap.values()) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: GIT_ERRORS.diffFailed(msg) };
    }
  }

  async getDiff(worktreePath: string, targetBranch: string, filePath?: string): Promise<Result<string>> {
    try {
      const args = ['-C', worktreePath, 'diff', targetBranch];
      if (filePath) {
        args.push('--', filePath);
      }
      const { stdout } = await execa('git', args);
      return { ok: true, value: stdout };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: GIT_ERRORS.diffFailed(msg) };
    }
  }
}

/** Test helper for running git commands in git test environments */
export async function runGit(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await execa('git', args, cwd ? { cwd } : {});
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode ?? 0 };
}
