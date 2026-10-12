import { describe, expect, it } from 'vitest';
import {
  PROTECTED_CONFIG_PATTERNS,
  SUPPRESSION_PATTERNS,
  TEST_FILE_PATTERNS,
  checkFileRule,
  checkNoNewSuppressions,
  checkProtectedFiles,
  findNewSuppressions,
  findProtectedFileChanges,
} from './guardrails.js';

function modified(path: string, added: string[], removed: string[] = ['old']): string {
  return (
    [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      '@@ -1 +1 @@',
      ...removed.map((line) => `-${line}`),
      ...added.map((line) => `+${line}`),
    ].join('\n') + '\n'
  );
}

function addedFile(path: string, lines: string[] = ['new']): string {
  return (
    [
      `diff --git a/${path} b/${path}`,
      'new file mode 100644',
      '--- /dev/null',
      `+++ b/${path}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((line) => `+${line}`),
    ].join('\n') + '\n'
  );
}

function removedFile(path: string): string {
  return (
    [
      `diff --git a/${path} b/${path}`,
      'deleted file mode 100644',
      `--- a/${path}`,
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-gone',
    ].join('\n') + '\n'
  );
}

function rename(from: string, to: string, changed: boolean): string {
  const head = [
    `diff --git a/${from} b/${to}`,
    changed ? 'similarity index 90%' : 'similarity index 100%',
    `rename from ${from}`,
    `rename to ${to}`,
  ];
  if (!changed) return head.join('\n') + '\n';
  return [...head, `--- a/${from}`, `+++ b/${to}`, '@@ -1 +1 @@', '-old', '+new'].join('\n') + '\n';
}

function suppressionAt(index: number): string {
  const pattern = SUPPRESSION_PATTERNS[index];
  if (pattern === undefined) throw new Error(`No suppression pattern at index ${index}`);
  return pattern;
}

describe('findNewSuppressions (JOB-05)', () => {
  it.each(SUPPRESSION_PATTERNS)('flags an added line containing %s', (pattern) => {
    const diff = modified('src/a.ts', [`const value = 1; // ${pattern} because`]);
    const findings = findNewSuppressions(diff);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ path: 'src/a.ts', pattern });
  });

  it('passes a diff with no suppressions', () => {
    expect(findNewSuppressions(modified('src/a.ts', ['const value = 1;']))).toEqual([]);
  });

  it('ignores suppressions on removed lines', () => {
    const diff = modified('src/a.ts', ['const value = 1;'], ['// ' + suppressionAt(0) + '-next-line']);
    expect(findNewSuppressions(diff)).toEqual([]);
  });

  it('ignores suppressions on context lines', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,2 @@',
      ' // ' + suppressionAt(0) + '-next-line',
      '-old',
      '+new',
      '',
    ].join('\n');
    expect(findNewSuppressions(diff)).toEqual([]);
  });

  it('ignores a suppression in a file path header', () => {
    const diff = addedFile('src/' + suppressionAt(0) + '.ts', ['const value = 1;']);
    expect(findNewSuppressions(diff)).toEqual([]);
  });

  it('finds suppressions in every file of a multi-file diff', () => {
    const diff = modified('src/a.ts', ['// ' + suppressionAt(2)]) + modified('src/b.py', [suppressionAt(7)]);
    expect(findNewSuppressions(diff).map((f) => f.path)).toEqual(['src/a.ts', 'src/b.py']);
  });

  it('returns a CheckResult with the guardrail rule', () => {
    expect(checkNoNewSuppressions(modified('src/a.ts', ['const value = 1;']))).toEqual({
      check: { kind: 'guardrail', rule: 'no_new_suppressions' },
      status: 'passed',
      summary: 'No new suppressions',
    });
  });

  it('fails and counts each suppression', () => {
    const diff = modified('src/a.ts', [suppressionAt(1), suppressionAt(0)]);
    expect(checkNoNewSuppressions(diff)).toEqual({
      check: { kind: 'guardrail', rule: 'no_new_suppressions' },
      status: 'failed',
      summary: '2 new suppressions',
    });
  });
});

const PROTECTED_SAMPLES: ReadonlyArray<readonly [string, string]> = [
  ['.eslintrc*', '.eslintrc.json'],
  ['eslint.config.*', 'packages/app/eslint.config.mjs'],
  ['biome.json*', 'biome.jsonc'],
  ['.stylelintrc*', '.stylelintrc.yaml'],
  ['stylelint.config.*', 'stylelint.config.mjs'],
  ['tsconfig*.json', 'packages/platform/tsconfig.node.json'],
  ['.github/workflows/**', '.github/workflows/ci.yml'],
  ['**/__snapshots__/**', 'packages/platform/src/a/__snapshots__/a.snap'],
  ['**/__screenshots__/**', 'design/tests/__screenshots__/a.png'],
  ['sprint-status.yaml', 'docs/stories/sprint-status.yaml'],
];

describe('findProtectedFileChanges (JOB-06) — protected paths', () => {
  it('covers every locked protected pattern', () => {
    expect(PROTECTED_SAMPLES.map(([pattern]) => pattern)).toEqual([...PROTECTED_CONFIG_PATTERNS]);
  });

  it.each(PROTECTED_SAMPLES)('fails when a file matching %s is modified', (_pattern, path) => {
    const findings = findProtectedFileChanges(modified(path, ['changed']));
    expect(findings.map((f) => f.reason)).toContain('protected');
  });

  it('flags the exact protected pattern that matched', () => {
    const findings = findProtectedFileChanges(modified('.eslintrc.json', ['x']));
    expect(findings[0]).toMatchObject({ path: '.eslintrc.json', reason: 'protected', patterns: ['.eslintrc*'] });
  });

  it('fails when a protected file is deleted', () => {
    const findings = findProtectedFileChanges(removedFile('packages/app/tsconfig.json'));
    expect(findings.map((f) => f.reason)).toContain('protected');
  });

  it('still fails for a protected path even when it is inside the spec scope', () => {
    const findings = findProtectedFileChanges(modified('tsconfig.json', ['x']), ['tsconfig.json', '**/*']);
    expect(findings.map((f) => f.reason)).toContain('protected');
  });

  it('passes a diff that touches no protected path', () => {
    expect(findProtectedFileChanges(modified('src/a.ts', ['x']))).toEqual([]);
  });

  it('returns a CheckResult with the guardrail rule', () => {
    expect(checkProtectedFiles(modified('src/a.ts', ['x']))).toEqual({
      check: { kind: 'guardrail', rule: 'protected_files' },
      status: 'passed',
      summary: 'No protected files changed',
    });
  });
});

describe('findProtectedFileChanges (JOB-06) — test files', () => {
  it.each(TEST_FILE_PATTERNS)('fails when an existing file matching %s is modified', (pattern) => {
    const path = pattern === 'test/**' ? 'test/helper.ts' : pattern === 'tests/**' ? 'tests/helper.ts' : 'src/a.test.ts';
    const findings = findProtectedFileChanges(modified(path, ['x']));
    expect(findings.map((f) => f.reason)).toContain('test_modified');
  });

  it('allows adding a new test file', () => {
    expect(findProtectedFileChanges(addedFile('src/a.test.ts', ['it("x", () => {})']))).toEqual([]);
    expect(findProtectedFileChanges(addedFile('test/helper.ts'))).toEqual([]);
  });

  it('fails when an existing test file is deleted', () => {
    const findings = findProtectedFileChanges(removedFile('src/a.test.ts'));
    expect(findings[0]).toMatchObject({ path: 'src/a.test.ts', reason: 'test_deleted' });
  });

  it('allows modifying a test file inside the spec scope', () => {
    expect(findProtectedFileChanges(modified('src/a.test.ts', ['x']), ['src/**'])).toEqual([]);
  });

  it('fails modifying a test file outside the spec scope', () => {
    expect(findProtectedFileChanges(modified('src/a.test.ts', ['x']), ['docs/**'])).toHaveLength(1);
  });

  it('fails deleting a test file even inside the spec scope', () => {
    const findings = findProtectedFileChanges(removedFile('src/a.test.ts'), ['src/**']);
    expect(findings[0]?.reason).toBe('test_deleted');
  });

  it('allows a rename that keeps a test file unchanged', () => {
    expect(findProtectedFileChanges(rename('src/a.test.ts', 'src/b.test.ts', false))).toEqual([]);
  });

  it('fails a rename that changes a test file', () => {
    const findings = findProtectedFileChanges(rename('src/a.test.ts', 'src/b.test.ts', true));
    expect(findings.map((f) => f.reason)).toContain('test_modified');
  });
});

describe('checkFileRule', () => {
  const rule = { kind: 'file_rule' as const, allow: ['src/**', 'test/**'] };

  it('passes when every touched path is allowed, including nested folders', () => {
    const diff = modified('src/a/b.ts', ['x']) + addedFile('test/a.test.ts') + removedFile('src/old.ts');
    expect(checkFileRule(diff, rule)).toMatchObject({ status: 'passed', summary: 'Only allowed files changed' });
  });

  it('fails on a change outside the rule, counting both sides of a rename', () => {
    const diff = modified('README.md', ['x']) + rename('src/a.ts', 'lib/a.ts', false) + modified('src/ok.ts', ['x']);
    expect(checkFileRule(diff, rule)).toMatchObject({ status: 'failed', summary: '1 file changed outside the rule' });
    expect(checkFileRule(rename('src/a.ts', 'lib/a.ts', true), rule).summary).toBe('1 file changed outside the rule');
  });
});
