import type { JobSpec } from '@orch/contracts';

/**
 * Turns a JobSpec into the equivalent `orch run …` command string.
 * Used under New job to show the command equivalent of the form.
 */
export function jobSpecToCommand(spec: JobSpec): string {
  const parts: string[] = ['orch', 'run', JSON.stringify(spec.goal)];

  for (const check of spec.checks) {
    if (check.kind === 'command') {
      parts.push('--check', JSON.stringify(check.run));
    }
  }

  if (spec.mode === 'single') {
    if (spec.orchestrator.account !== 'auto') {
      parts.push('--orchestrator', `${spec.orchestrator.agent}@${spec.orchestrator.account}`);
    } else {
      parts.push('--orchestrator', spec.orchestrator.agent);
    }
  }

  if (spec.onLimit && spec.onLimit !== 'switch-account') {
    parts.push('--on-limit', spec.onLimit);
  }

  return parts.join(' ');
}
