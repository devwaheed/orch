import { describe, expect, it } from 'vitest';
import { err, ok } from '@orchagents/base';
import {
  AccountId,
  JobId,
  OrchError,
  Run,
  RunId,
  SessionId,
  WorktreeId,
  type IRunsService,
  type Result,
} from '@orchagents/contracts';
import { ExitCode } from '../../common/exitCodes.js';
import { moveCommand } from './move.js';

function runFixture(over: Partial<Run> = {}): Run {
  return {
    id: 'r-02' as RunId,
    jobId: 'j-01' as JobId,
    parentId: null,
    depth: 0,
    role: 'implementer',
    task: 'Implement callback',
    agent: 'codex',
    accountId: 'codex-team' as AccountId,
    status: 'running',
    worktree: 'orch/r-02' as WorktreeId,
    readOnly: false,
    sessionId: 's-7a1c' as SessionId,
    startedAt: '2026-10-11T12:00:00Z',
    resumesAt: null,
    ...over,
  };
}

interface FakeRuns {
  runs: IRunsService;
  calls: Array<{ runId: RunId; accountId: AccountId }>;
  result: Result<Run>;
}

function fakeRuns(over: { result?: Result<Run> } = {}): FakeRuns {
  const calls: Array<{ runId: RunId; accountId: AccountId }> = [];
  const state: FakeRuns = {
    calls,
    result: over.result ?? ok(runFixture()),
    runs: {
      list: async () => ok([]),
      lines: async () => ok([]),
      send: async () => ok(undefined),
      pause: async () => ok(undefined),
      stop: async () => ok(undefined),
      startNow: async () => ok(undefined),
      resumeOn: async (runId, accountId) => {
        calls.push({ runId, accountId });
        return state.result;
      },
      setAutoResume: async () => ok(undefined),
    },
  };
  return state;
}

describe('moveCommand', () => {
  it('moves a run to another account and prints success line', async () => {
    const fake = fakeRuns();
    const output: string[] = [];
    const code = await moveCommand(
      { runs: fake.runs },
      'r-02',
      { to: 'codex@team' },
      (msg) => output.push(msg),
    );

    expect(code).toBe(ExitCode.Success);
    expect(fake.calls).toEqual([{ runId: 'r-02', accountId: 'codex-team' }]);
    expect(output).toEqual(['✓ moved r-02 to codex@team']);
  });

  it('prints json when --json is passed', async () => {
    const fake = fakeRuns();
    const output: string[] = [];
    const code = await moveCommand(
      { runs: fake.runs },
      'r-02',
      { to: 'codex@team', json: true },
      (msg) => output.push(msg),
    );

    expect(code).toBe(ExitCode.Success);
    expect(fake.calls).toHaveLength(1);
    expect(JSON.parse(output.join('\n'))).toMatchObject({ id: 'r-02', accountId: 'codex-team' });
  });

  it('exits 2 when --to is missing', async () => {
    const fake = fakeRuns();
    const output: string[] = [];
    const code = await moveCommand(
      { runs: fake.runs },
      'r-02',
      {},
      (msg) => output.push(msg),
    );

    expect(code).toBe(ExitCode.InvalidUsage);
    expect(fake.calls).toHaveLength(0);
    expect(output[0]).toContain('Missing required option --to');
  });

  it('exits 2 when run id is invalid', async () => {
    const fake = fakeRuns();
    const output: string[] = [];
    const code = await moveCommand(
      { runs: fake.runs },
      'invalid-run',
      { to: 'codex@team' },
      (msg) => output.push(msg),
    );

    expect(code).toBe(ExitCode.InvalidUsage);
    expect(fake.calls).toHaveLength(0);
    expect(output[0]).toContain('invalid-run is not a run id');
  });

  it('exits 2 when --to is not a valid account choice', async () => {
    const fake = fakeRuns();
    const output: string[] = [];
    const code = await moveCommand(
      { runs: fake.runs },
      'r-02',
      { to: 'invalid_account' },
      (msg) => output.push(msg),
    );

    expect(code).toBe(ExitCode.InvalidUsage);
    expect(fake.calls).toHaveLength(0);
    expect(output[0]).toContain('invalid_account is not an account');
  });

  it('prints OrchError and exits 1 on failure', async () => {
    const orchError: OrchError = {
      code: 'not_found',
      message: 'Account codex-team is not configured',
      fix: 'Run orch accounts to see available accounts',
    };
    const fake = fakeRuns({ result: err(orchError) });
    const output: string[] = [];
    const code = await moveCommand(
      { runs: fake.runs },
      'r-02',
      { to: 'codex@team' },
      (msg) => output.push(msg),
    );

    expect(code).toBe(ExitCode.ProblemFound);
    expect(output[0]).toContain('Error: Account codex-team is not configured');
    expect(output[0]).toContain('Fix: Run orch accounts to see available accounts');
  });
});
