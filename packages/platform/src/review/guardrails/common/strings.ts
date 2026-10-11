/**
 * Short summaries for the two guardrail checks (JOB-05, JOB-06). They follow
 * the `CheckResult.summary` convention ("14 passed", "1 failing"): a count and
 * a noun, no product copy. The offending files and lines are available from
 * `findNewSuppressions` and `findProtectedFileChanges` for the Review screen to
 * show in full.
 */
export const GUARDRAIL_COPY = {
  noNewSuppressions: {
    passed: 'No new suppressions',
    failed: (count: number) => `${count} new ${count === 1 ? 'suppression' : 'suppressions'}`,
  },
  protectedFiles: {
    passed: 'No protected files changed',
    failed: (count: number) => `${count} protected ${count === 1 ? 'file' : 'files'} changed`,
  },
} as const;
