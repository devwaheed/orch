import type { CheckResult } from '@orch/contracts';
import { checkNoNewSuppressions, checkProtectedFiles } from '../../review/guardrails/common/guardrails.js';

export interface GuardrailEvaluation {
  suppressionsResult: CheckResult;
  protectedFilesResult: CheckResult;
  passed: boolean;
}

/** The two always-on guardrails (JOB-05, JOB-06), implemented once in review/guardrails (S4-02). */
export function evaluateGuardrails(diff: string, scope: readonly string[] = []): GuardrailEvaluation {
  const suppressionsResult = checkNoNewSuppressions(diff);
  const protectedFilesResult = checkProtectedFiles(diff, scope);
  return {
    suppressionsResult,
    protectedFilesResult,
    passed: suppressionsResult.status === 'passed' && protectedFilesResult.status === 'passed',
  };
}
