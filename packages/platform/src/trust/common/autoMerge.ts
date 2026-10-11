/**
 * TRU-03: what a level-3 agent may merge on its own. Pure, so the merge gate
 * and its tests need nothing but a job's mode and its diff.
 */
import type { JobMode, TrustLevel } from '@orch/contracts';
import { globToRegExp, normalizeSlashes } from './glob.js';

/** TRU-03: the changed files a level-3 agent may auto-merge. */
export const AUTO_MERGE_FILE_PATTERNS: readonly string[] = [
  '**/*.md',
  'docs/**',
  'test/**',
  'tests/**',
  '**/*.test.*',
  '**/*.spec.*',
];

/** TRU-03: the diff must be under this many changed lines. */
export const AUTO_MERGE_MAX_CHANGED_LINES = 200;

/** TRU-03: only this mode may be auto-merged. */
export const AUTO_MERGE_MODE: JobMode = 'single';

const FILE_MATCHERS = AUTO_MERGE_FILE_PATTERNS.map((pattern) => globToRegExp(pattern));

/** True when one changed file falls inside the TRU-03 allowlist. */
export function matchesAutoMergePath(path: string): boolean {
  const normalized = normalizeSlashes(path);
  return FILE_MATCHERS.some((matcher) => matcher.test(normalized));
}

export interface AutoMergeInput {
  /** The level on record for the agent that did the work (TRU-02). */
  readonly level: TrustLevel;
  readonly mode: JobMode;
  /** A job from the spec queue is never auto-merged (TRU-03, PRD-07). */
  readonly specQueue: boolean;
  /** Every path the job changed. */
  readonly changedFiles: readonly string[];
  /** Added plus removed lines across the whole diff. */
  readonly changedLines: number;
}

/**
 * Whether orch may merge this job without asking. All of TRU-03 must hold:
 * level 3, single mode, not from the spec queue, every changed file in the
 * allowlist, and a diff under AUTO_MERGE_MAX_CHANGED_LINES.
 */
export function autoMergeAllowed(input: AutoMergeInput): boolean {
  if (input.level !== 3) {
    return false;
  }
  if (input.mode !== AUTO_MERGE_MODE) {
    return false;
  }
  if (input.specQueue) {
    return false;
  }
  if (input.changedLines >= AUTO_MERGE_MAX_CHANGED_LINES) {
    return false;
  }
  return input.changedFiles.every((path) => matchesAutoMergePath(path));
}
