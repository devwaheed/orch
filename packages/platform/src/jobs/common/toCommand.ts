import type { JobSpec } from '@orchagents/contracts';

/** Quote one value for display as a shell command (not for shell execution). */
export function quoteCommandArg(value: string): string {
  return JSON.stringify(value);
}

/**
 * Turns a JobSpec into the equivalent `orch run …` command string.
 * Used under New job to show the command equivalent of the form.
 */
export function jobSpecToCommand(spec: JobSpec): string {
  const parts: string[] = ['orch', 'run'];
  const appendChecks = (): void => {
    for (const check of spec.checks) {
      if (check.kind === 'command') {
        parts.push('--check', quoteCommandArg(check.run));
      } else if (check.kind === 'http') {
        parts.push('--web-check', quoteCommandArg(check.url));
      } else if (check.kind === 'file_rule') {
        for (const glob of check.allow) {
          parts.push('--allow', quoteCommandArg(glob));
        }
      }
    }
  };

  if (spec.mode === 'compare') {
    parts.push('--mode', 'compare');
    parts.push('--agents', spec.agents.join(','));
    if (spec.combine) {
      parts.push('--combine');
    }
    parts.push(quoteCommandArg(spec.goal));
    return parts.join(' ');
  }

  if (spec.mode === 'council') {
    parts.push('--mode', 'council');
    parts.push('--agents', spec.agents.join(','));
    parts.push('--rounds', String(spec.maxRounds));
    appendChecks();
    parts.push(quoteCommandArg(spec.goal));
    return parts.join(' ');
  }

  if (spec.mode === 'autoloop') {
    parts.push('--mode', 'autoloop');
    parts.push('--planner', spec.roles.planner);
    parts.push('--coder', spec.roles.coder);
    parts.push('--reviewer', spec.roles.reviewer);
    appendChecks();
    parts.push(quoteCommandArg(spec.goal));
    return parts.join(' ');
  }

  parts.push(quoteCommandArg(spec.goal));

  appendChecks();

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
