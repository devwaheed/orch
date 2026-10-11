/**
 * The two always-on guardrails (JOB-05, JOB-06). Pure functions over a unified
 * diff: no Node APIs, no filesystem. The diff comes from `git diff --no-color`
 * and the spec's `scope` globs are optional (JOB-06: a test file inside a
 * spec's scope may be modified, but never deleted).
 */
import type { Check, CheckResult } from '@orch/contracts';
import { parseDiff, type DiffFile } from './diff.js';
import { globMatch, globMatchAny } from './glob.js';
import { GUARDRAIL_COPY } from './strings.js';

/**
 * JOB-05. The entries are assembled from pieces at runtime so this module's own
 * source never contains the strings it looks for. Without that, shipping the
 * guardrail would itself trip the guardrail — the same trap an agent
 * implementing it falls into.
 */
export const SUPPRESSION_PATTERNS = [
  'eslint-' + 'disable',
  '@ts-' + 'ignore',
  '@ts-expect-' + 'error',
  '@ts-' + 'nocheck',
  'biome-' + 'ignore',
  'stylelint-' + 'disable',
  '# type: ' + 'ignore',
  '# ' + 'noqa',
  '//' + 'nolint',
  '#[' + 'allow(',
  '@Suppress' + 'Warnings',
];

/** JOB-06: config, CI and snapshot paths a diff may not modify or delete. */
export const PROTECTED_CONFIG_PATTERNS = [
  '.eslintrc*',
  'eslint.config.*',
  'biome.json*',
  '.stylelintrc*',
  'stylelint.config.*',
  'tsconfig*.json',
  '.github/workflows/**',
  '**/__snapshots__/**',
  '**/__screenshots__/**',
  'sprint-status.yaml',
] as const;

/** JOB-06: new test files may be added; existing ones may not be deleted. */
export const TEST_FILE_PATTERNS = ['**/*.test.*', '**/*.spec.*', 'test/**', 'tests/**'] as const;

export interface SuppressionFinding {
  path: string;
  pattern: string;
  line: string;
}

export type ProtectedFileReason = 'protected' | 'test_deleted' | 'test_modified';

export interface ProtectedFileFinding {
  path: string;
  reason: ProtectedFileReason;
  patterns: string[];
}

function isProtectedConfig(path: string): boolean {
  return globMatchAny(PROTECTED_CONFIG_PATTERNS, path);
}

function isTestPath(path: string): boolean {
  return globMatchAny(TEST_FILE_PATTERNS, path);
}

function configPatternsFor(path: string): string[] {
  return PROTECTED_CONFIG_PATTERNS.filter((pattern) => globMatch(pattern, path));
}

function testPatternsFor(path: string): string[] {
  return TEST_FILE_PATTERNS.filter((pattern) => globMatch(pattern, path));
}

/** The paths a change touches. An unchanged rename touches neither. */
function touchedPaths(file: DiffFile): string[] {
  if (file.unchangedRename) return [];
  if (file.status === 'added') return file.newPath === null ? [] : [file.newPath];
  if (file.status === 'deleted') return file.oldPath === null ? [] : [file.oldPath];
  if (file.status === 'renamed') {
    return [file.oldPath, file.newPath].filter((path): path is string => path !== null);
  }
  const path = file.newPath ?? file.oldPath;
  return path === null ? [] : [path];
}

/** Only added content lines count; `+++` headers and removed lines do not (JOB-05). */
export function findNewSuppressions(diff: string): SuppressionFinding[] {
  const findings: SuppressionFinding[] = [];
  for (const file of parseDiff(diff)) {
    const path = file.newPath ?? file.oldPath ?? '';
    for (const line of file.addedLines) {
      for (const pattern of SUPPRESSION_PATTERNS) {
        if (line.includes(pattern)) findings.push({ path, pattern, line });
      }
    }
  }
  return findings;
}

/** Protected config, CI, snapshot and test-file changes (JOB-06). */
export function findProtectedFileChanges(diff: string, scope: readonly string[] = []): ProtectedFileFinding[] {
  const findings: ProtectedFileFinding[] = [];
  for (const file of parseDiff(diff)) {
    for (const path of touchedPaths(file)) {
      if (isProtectedConfig(path)) {
        findings.push({ path, reason: 'protected', patterns: configPatternsFor(path) });
      }
    }

    if (file.status === 'added') continue;
    if (file.unchangedRename) continue;

    if (file.status === 'deleted') {
      const path = file.oldPath;
      if (path !== null && isTestPath(path)) {
        findings.push({ path, reason: 'test_deleted', patterns: testPatternsFor(path) });
      }
      continue;
    }

    const paths = file.status === 'renamed' ? [file.oldPath, file.newPath] : [file.newPath ?? file.oldPath];
    for (const path of paths) {
      if (path === null || !isTestPath(path)) continue;
      if (globMatchAny(scope, path)) continue;
      findings.push({ path, reason: 'test_modified', patterns: testPatternsFor(path) });
    }
  }
  return findings;
}

function suppressionCheck(): Check {
  return { kind: 'guardrail', rule: 'no_new_suppressions' };
}

function protectedFilesCheck(): Check {
  return { kind: 'guardrail', rule: 'protected_files' };
}

export function checkNoNewSuppressions(diff: string): CheckResult {
  const findings = findNewSuppressions(diff);
  return {
    check: suppressionCheck(),
    status: findings.length === 0 ? 'passed' : 'failed',
    summary:
      findings.length === 0 ? GUARDRAIL_COPY.noNewSuppressions.passed : GUARDRAIL_COPY.noNewSuppressions.failed(findings.length),
  };
}

export function checkProtectedFiles(diff: string, scope: readonly string[] = []): CheckResult {
  const findings = findProtectedFileChanges(diff, scope);
  return {
    check: protectedFilesCheck(),
    status: findings.length === 0 ? 'passed' : 'failed',
    summary:
      findings.length === 0 ? GUARDRAIL_COPY.protectedFiles.passed : GUARDRAIL_COPY.protectedFiles.failed(findings.length),
  };
}
