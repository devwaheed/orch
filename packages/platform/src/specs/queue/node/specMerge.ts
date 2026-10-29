/**
 * Merge logic for approved specs (docs/specs/spec-queue.md §7).
 * - Merge order: approved specs merge in position order; waits while any dependency is not yet merged.
 * - Before merging: rebases worktree onto main and re-runs checks and guardrails. If they fail: back to running.
 * - After merging: updates sprint-status.yaml if present (§2), removes worktree, emits spec.changed.
 */
import { err, ok } from '@orchagents/base';
import type { Result, SpecId, SpecRun } from '@orchagents/contracts';
import fs from 'node:fs';
import * as path from 'node:path';
import type { IGitService } from '../../../git/common/git.js';
import { runGit } from '../../../git/node/gitService.js';
import { evaluateGuardrails } from '../../../jobs/node/guardrails.js';
import { buildDependencyGraph } from '../common/reorder.js';
import { updateSprintStatusOnMerge } from './sprintStatusWriter.js';

export interface CommandRunner {
  (
    cmd: string,
    args: readonly string[],
    /** `env` is extra environment on top of the base env (e.g. ELECTRON_RUN_AS_NODE). */
    options: { cwd?: string; timeoutMs?: number; env?: Readonly<Record<string, string>> },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export interface MergeSpecResult {
  readonly success: boolean;
  readonly rebaseOrChecksFailed?: boolean;
  readonly failureMessage?: string;
}

/**
 * Checks whether an approved spec is ready to merge according to merge order (§7):
 * "approved specs merge in position order. A spec waits in approved while any spec it
 * depends on (directly or indirectly) is not yet merged."
 */
export function isReadyToMerge(spec: SpecRun, allSpecs: readonly SpecRun[]): boolean {
  if (spec.state !== 'approved') {
    return false;
  }

  const specMap = new Map<SpecId, SpecRun>();
  for (const s of allSpecs) {
    specMap.set(s.id, s);
  }

  const depGraph = buildDependencyGraph(allSpecs);
  const allDeps = depGraph.get(spec.id) ?? new Set<SpecId>();

  for (const depId of allDeps) {
    const depSpec = specMap.get(depId);
    if (!depSpec || depSpec.state !== 'merged') {
      return false;
    }
  }

  return true;
}

/**
 * Returns the next approved spec that is ready to merge in position order (§7).
 */
export function getNextSpecToMerge(specs: readonly SpecRun[]): SpecRun | null {
  const approved = specs
    .filter((s) => s.state === 'approved')
    .sort((a, b) => a.position - b.position);

  for (const spec of approved) {
    if (isReadyToMerge(spec, specs)) {
      return spec;
    }
  }

  return null;
}

export interface MergeOptions {
  readonly repoPath: string;
  readonly git: IGitService;
  readonly commandRunner?: CommandRunner | undefined;
}

/**
 * Commits uncommitted changes (staged, unstaged, or untracked) in the spec worktree
 * onto the spec branch before rebasing (§7) or creating a throwaway audit worktree (§6).
 */
export async function commitSpecWorktreeChanges(
  worktreePath: string,
  spec: { id: SpecId | string; spec: { title: string }; attempt?: number | null },
): Promise<Result<void>> {
  if (!fs.existsSync(worktreePath)) {
    return ok(undefined);
  }
  try {
    const statusRes = await runGit(['-C', worktreePath, 'status', '--porcelain', '--untracked-files=all']);
    if (statusRes.exitCode !== 0) {
      return err({ code: 'internal', message: `Could not inspect spec worktree: ${statusRes.stderr || statusRes.stdout}` });
    }
    if (statusRes.stdout.trim()) {
      const addRes = await runGit(['-C', worktreePath, 'add', '-A']);
      if (addRes.exitCode !== 0) {
        return err({ code: 'internal', message: `Could not stage spec changes: ${addRes.stderr || addRes.stdout}` });
      }

      let nameConfigured = true;
      try {
        const nameRes = await runGit(['-C', worktreePath, 'config', '--local', '--get', 'user.name']);
        nameConfigured = nameRes.exitCode === 0 && nameRes.stdout.trim().length > 0;
      } catch {
        nameConfigured = false;
      }
      const identityArgs = nameConfigured ? [] : ['-c', 'user.name=orch', '-c', 'user.email=orch@localhost'];
      const commitMsg = `${spec.spec.title}\n\norch: spec ${spec.id}, try ${spec.attempt ?? 1}`;
      const commitRes = await runGit([...identityArgs, '-C', worktreePath, 'commit', '-m', commitMsg]);
      if (commitRes.exitCode !== 0) {
        return err({ code: 'internal', message: `Could not commit spec changes: ${commitRes.stderr || commitRes.stdout}` });
      }
    }
    return ok(undefined);
  } catch (error) {
    return err({ code: 'internal', message: `Could not prepare spec changes for rebase: ${(error as Error).message}` });
  }
}

/**
 * Executes rebase on main, re-verify checks + guardrails, and merges the worktree (§7).
 */
export async function mergeApprovedSpec(
  spec: SpecRun,
  options: MergeOptions,
): Promise<Result<MergeSpecResult>> {
  const { repoPath, git, commandRunner } = options;

  const defaultBranchRes = await git.getDefaultBranch(repoPath);
  const targetBranch = defaultBranchRes.ok ? defaultBranchRes.value : 'main';

  const runId = `spec-${spec.id}`;
  const worktreePath = path.join(repoPath, '.orch', 'wt', runId);
  const branch = `orch/${runId}`;

  // Verified tries may still have agent changes in the index or worktree.
  // Record those exact changes on the spec branch before rebasing (§7).
  const commitRes = await commitSpecWorktreeChanges(worktreePath, spec);
  if (!commitRes.ok) {
    return commitRes;
  }

  // 1. Rebase worktree onto main
  try {
    const rebaseRes = await runGit(['-C', worktreePath, 'rebase', targetBranch]);
    if (rebaseRes.exitCode !== 0) {
      // Rebase failed (e.g. conflicts) -> abort rebase and fail
      await runGit(['-C', worktreePath, 'rebase', '--abort']).catch(() => {});
      return ok({
        success: false,
        rebaseOrChecksFailed: true,
        failureMessage: `Rebase onto ${targetBranch} failed: ${rebaseRes.stderr || rebaseRes.stdout}`,
      });
    }
  } catch (error) {
    await runGit(['-C', worktreePath, 'rebase', '--abort']).catch(() => {});
    return ok({
      success: false,
      rebaseOrChecksFailed: true,
      failureMessage: `Rebase failed: ${(error as Error).message}`,
    });
  }

  // 2. Re-run check criteria
  for (const item of spec.spec.done_when) {
    if (item.by === 'check' && item.check.kind === 'command') {
      if (commandRunner) {
        const matches = item.check.run.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
        const tokens = matches.map((t) => {
          if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
            return t.slice(1, -1);
          }
          return t;
        });
        const cmd = tokens[0] ?? '';
        const args = tokens.slice(1);
        const res = await commandRunner(cmd, args, { cwd: worktreePath });
        if (res.exitCode !== 0) {
          return ok({
            success: false,
            rebaseOrChecksFailed: true,
            failureMessage: `Check failed after rebase: ${item.text}`,
          });
        }
      }
    }
  }

  // 3. Re-run guardrails on the rebased diff
  const diffRes = await git.getDiff(worktreePath, targetBranch);
  const diff = diffRes.ok ? diffRes.value : '';
  const guardrails = evaluateGuardrails(diff, spec.spec.scope);
  if (!guardrails.passed) {
    return ok({
      success: false,
      rebaseOrChecksFailed: true,
      failureMessage: 'Guardrails failed after rebase',
    });
  }

  // 4. Merge squashed commit into default branch (REV-02 / §7)
  try {
    const mergeRes = await runGit(['-C', repoPath, 'merge', '--squash', branch]);
    if (mergeRes.exitCode !== 0) {
      return err({
        code: 'internal',
        message: `Merge failed: ${mergeRes.stderr || mergeRes.stdout}`,
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const commitMsg = `${spec.spec.title}\n\norch: spec ${spec.id}, verified ${today}`;
    const commitRes = await runGit(['-C', repoPath, 'commit', '-m', commitMsg]);
    if (commitRes.exitCode !== 0) {
      return err({
        code: 'internal',
        message: `Squash commit failed: ${commitRes.stderr || commitRes.stdout}`,
      });
    }
  } catch (error) {
    return err({
      code: 'internal',
      message: `Failed to commit merged spec: ${(error as Error).message}`,
    });
  }

  // 5. Update sprint-status.yaml if present (§2, SQ-22)
  await updateSprintStatusOnMerge(repoPath, spec.id);

  // 6. Remove worktree and branch
  await git.removeWorktree({ repoPath, runId, deleteBranch: true });

  return ok({ success: true });
}
