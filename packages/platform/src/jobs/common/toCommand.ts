import type { JobSpec } from '@orchagents/contracts';

/**
 * Turns a JobSpec into the equivalent `orch run …` command string.
 * Used under New job to show the command equivalent of the form.
 */
export function jobSpecToCommand(spec: JobSpec): string {
  const parts: string[] = ['orch', 'run'];

  if (spec.mode === 'compare') {
    parts.push('--mode', 'compare');
    parts.push('--agents', spec.agents.join(','));
    if (spec.combine) {
      parts.push('--combine');
    }
    parts.push(JSON.stringify(spec.goal));
    return parts.join(' ');
  }

  if (spec.mode === 'council') {
    parts.push('--mode', 'council');
    parts.push('--agents', spec.agents.join(','));
    parts.push('--rounds', String(spec.maxRounds));
    for (const check of spec.checks) {
      if (check.kind === 'command') {
        parts.push('--check', JSON.stringify(check.run));
      }
    }
    parts.push(JSON.stringify(spec.goal));
    return parts.join(' ');
  }

  if (spec.mode === 'autoloop') {
    parts.push('--mode', 'autoloop');
    parts.push('--planner', spec.roles.planner);
    parts.push('--coder', spec.roles.coder);
    parts.push('--reviewer', spec.roles.reviewer);
    for (const check of spec.checks) {
      if (check.kind === 'command') {
        parts.push('--check', JSON.stringify(check.run));
      }
    }
    parts.push(JSON.stringify(spec.goal));
    return parts.join(' ');
  }

  parts.push(JSON.stringify(spec.goal));

  for (const check of spec.checks) {
    if (check.kind === 'command') {
      parts.push('--check', JSON.stringify(check.run));
    }
  }

  if (spec.orchestrator.account !== 'auto') {
    parts.push('--orchestrator', `${spec.orchestrator.agent}@${spec.orchestrator.account}`);
  } else {
    parts.push('--orchestrator', spec.orchestrator.agent);
  }

  if (spec.onLimit && spec.onLimit !== 'switch-account') {
    parts.push('--on-limit', spec.onLimit);
  }

  return parts.join(' ');
}
