import type { Check, CheckResult } from '@orchagents/contracts';
import { checkFileRule, checkNoNewSuppressions, checkProtectedFiles } from '../../review/guardrails/common/guardrails.js';

export interface GuardrailEvaluation {
  suppressionsResult: CheckResult;
  protectedFilesResult: CheckResult;
  /** One result per declared `file_rule` check; they are judged from the diff like the guardrails. */
  fileRuleResults: CheckResult[];
  passed: boolean;
}

/** The two always-on guardrails (JOB-05, JOB-06), implemented once in review/guardrails (S4-02), plus any file rules. */
export function evaluateGuardrails(
  diff: string,
  scope: readonly string[] = [],
  checks: readonly Check[] = [],
): GuardrailEvaluation {
  const suppressionsResult = checkNoNewSuppressions(diff);
  const protectedFilesResult = checkProtectedFiles(diff, scope);
  const fileRuleResults = checks.flatMap((c) => (c.kind === 'file_rule' ? [checkFileRule(diff, c)] : []));
  return {
    suppressionsResult,
    protectedFilesResult,
    fileRuleResults,
    passed: [suppressionsResult, protectedFilesResult, ...fileRuleResults].every((r) => r.status === 'passed'),
  };
}
