import { describe, expect, it } from 'vitest';
import type { AccountId, JobSpec } from '@orch/contracts';
import { jobSpecToCommand } from '../common/toCommand.js';

describe('jobSpecToCommand', () => {
  it('formats basic single mode job spec', () => {
    const spec: JobSpec = {
      mode: 'single',
      goal: 'fix the failing test',
      repoPath: '/repo',
      orchestrator: { agent: 'claude', account: 'auto' },
      workers: ['claude'],
      checks: [{ kind: 'command', run: 'npm test' }],
      onLimit: 'switch-account',
    };
    expect(jobSpecToCommand(spec)).toBe('orch run "fix the failing test" --check "npm test" --orchestrator claude');
  });

  it('formats single mode with specific account and custom onLimit', () => {
    const spec: JobSpec = {
      mode: 'single',
      goal: 'refactor database layer',
      repoPath: '/repo',
      orchestrator: { agent: 'codex', account: 'codex-team' as AccountId },
      workers: ['codex'],
      checks: [
        { kind: 'command', run: 'npm test' },
        { kind: 'command', run: 'npm run lint' },
      ],
      onLimit: 'ask',
    };
    expect(jobSpecToCommand(spec)).toBe(
      'orch run "refactor database layer" --check "npm test" --check "npm run lint" --orchestrator codex@codex-team --on-limit ask',
    );
  });
});
