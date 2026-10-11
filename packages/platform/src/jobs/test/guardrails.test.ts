import { describe, expect, it } from 'vitest';
import { globMatchAny } from '../../review/guardrails/common/glob.js';
import {
  PROTECTED_CONFIG_PATTERNS,
  TEST_FILE_PATTERNS,
  findNewSuppressions,
  findProtectedFileChanges,
} from '../../review/guardrails/common/guardrails.js';
import { evaluateGuardrails } from '../node/guardrails.js';

const isTestPath = (p: string): boolean => globMatchAny(TEST_FILE_PATTERNS, p);
const isProtectedPath = (p: string): boolean => globMatchAny(PROTECTED_CONFIG_PATTERNS, p);

describe('guardrails', () => {
  it('isTestPath identifies test files correctly', () => {
    expect(isTestPath('src/foo.test.ts')).toBe(true);
    expect(isTestPath('src/foo.spec.js')).toBe(true);
    expect(isTestPath('test/helper.ts')).toBe(true);
    expect(isTestPath('tests/unit/app.ts')).toBe(true);
    expect(isTestPath('src/foo.ts')).toBe(false);
  });

  it('isProtectedPath identifies protected configuration files', () => {
    expect(isProtectedPath('.eslintrc.json')).toBe(true);
    expect(isProtectedPath('eslint.config.mjs')).toBe(true);
    expect(isProtectedPath('biome.json')).toBe(true);
    expect(isProtectedPath('.stylelintrc')).toBe(true);
    expect(isProtectedPath('tsconfig.json')).toBe(true);
    expect(isProtectedPath('tsconfig.base.json')).toBe(true);
    expect(isProtectedPath('.github/workflows/ci.yml')).toBe(true);
    expect(isProtectedPath('packages/app/__snapshots__/view.snap')).toBe(true);
    expect(isProtectedPath('sprint-status.yaml')).toBe(true);
    expect(isProtectedPath('src/index.ts')).toBe(false);
  });

  it('passes when diff modifies normal source files without suppressions', () => {
    const diff = `
diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 export function hello() {
+  console.log("hello");
   return 1;
 }
`;
    const res = evaluateGuardrails(diff);
    expect(res.passed).toBe(true);
    expect(res.suppressionsResult.status).toBe('passed');
    expect(res.protectedFilesResult.status).toBe('passed');
  });

  it('fails JOB-05 when diff introduces a suppression', () => {
    const diff = `
diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
+// eslint-disable-next-line
 export const x = 1;
`;
    const res = evaluateGuardrails(diff);
    expect(res.passed).toBe(false);
    expect(res.suppressionsResult.status).toBe('failed');
    expect(findNewSuppressions(diff).map((f) => f.pattern)).toContain('eslint-disable');
    expect(res.protectedFilesResult.status).toBe('passed');
  });

  it('fails JOB-06 when diff modifies an existing test file', () => {
    const diff = `
diff --git a/test/app.test.ts b/test/app.test.ts
--- a/test/app.test.ts
+++ b/test/app.test.ts
@@ -1,3 +1,4 @@
-// old test
+// new test
`;
    const res = evaluateGuardrails(diff);
    expect(res.passed).toBe(false);
    expect(res.protectedFilesResult.status).toBe('failed');
    expect(findProtectedFileChanges(diff).map((f) => f.path)).toContain('test/app.test.ts');
  });

  it('allows adding a brand new test file (JOB-06)', () => {
    const diff = `
diff --git a/test/new.test.ts b/test/new.test.ts
new file mode 100644
--- /dev/null
+++ b/test/new.test.ts
@@ -0,0 +1,5 @@
+import { test } from 'vitest';
+test('new test', () => {});
`;
    const res = evaluateGuardrails(diff);
    expect(res.passed).toBe(true);
    expect(res.protectedFilesResult.status).toBe('passed');
  });
});
