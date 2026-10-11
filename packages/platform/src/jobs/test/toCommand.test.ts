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

  it('formats compare mode with --combine', () => {
    const spec: JobSpec = {
      mode: 'compare',
      goal: 'Fix the flaky integration tests…',
      repoPath: '/repo',
      checks: [],
      onLimit: 'switch-account',
      agents: ['claude', 'codex'],
      combine: true,
    };
    expect(jobSpecToCommand(spec)).toBe(
      'orch run --mode compare --agents claude,codex --combine "Fix the flaky integration tests…"',
    );
  });

  it('formats compare mode without --combine', () => {
    const spec: JobSpec = {
      mode: 'compare',
      goal: 'Fix the flaky integration tests…',
      repoPath: '/repo',
      checks: [],
      onLimit: 'switch-account',
      agents: ['claude', 'codex', 'gemini'],
      combine: false,
    };
    expect(jobSpecToCommand(spec)).toBe(
      'orch run --mode compare --agents claude,codex,gemini "Fix the flaky integration tests…"',
    );
  });

  it('formats council mode with --rounds and checks', () => {
    const spec: JobSpec = {
      mode: 'council',
      goal: 'Fix the flaky integration tests…',
      repoPath: '/repo',
      onLimit: 'switch-account',
      agents: ['claude', 'codex', 'opencode'],
      maxRounds: 5,
      checks: [{ kind: 'command', run: 'npm test' }],
    };
    expect(jobSpecToCommand(spec)).toBe(
      'orch run --mode council --agents claude,codex,opencode --rounds 5 --check "npm test" "Fix the flaky integration tests…"',
    );
  });

  it('formats autoloop mode with --planner, --coder, --reviewer and checks', () => {
    const spec: JobSpec = {
      mode: 'autoloop',
      goal: 'Fix the flaky integration tests…',
      repoPath: '/repo',
      onLimit: 'switch-account',
      roles: {
        planner: 'claude',
        coder: 'codex',
        reviewer: 'gemini',
      },
      checks: [{ kind: 'command', run: 'npm test' }],
    };
    expect(jobSpecToCommand(spec)).toBe(
      'orch run --mode autoloop --planner claude --coder codex --reviewer gemini --check "npm test" "Fix the flaky integration tests…"',
    );
  });
});
