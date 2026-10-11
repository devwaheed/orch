import { describe, expect, it } from 'vitest';
import { err, ok } from '@orch/base';
import type {
  AccountId,
  ISessionsService,
  OrchError,
  ResumeOption,
  ResumeRequest,
  Result,
  Session,
  SessionId,
  SessionStatus,
  WorktreeId,
} from '@orch/contracts';
import { ExitCode } from '../../common/exitCodes.js';
import { accountIdFromChoice, defaultMode, menuLines, resumeCommand } from './resume.js';

const WAITS = '2026-10-11T15:00:00.000Z';

function session(over: Partial<Session> = {}): Session {
  return {
    id: 's-91e0' as SessionId,
    jobId: 'j-01' as Session['jobId'],
    runId: 'r-04' as Session['runId'],
    title: 'Add OAuth login',
    agent: 'codex',
    accountId: 'codex-personal' as AccountId,
    cliSessionId: 'c1',
    status: 'paused',
    worktree: 'orch/r-04' as WorktreeId,
    startedAt: '2026-10-11T10:00:00.000Z',
    lastActivityAt: '2026-10-11T11:00:00.000Z',
    tokens: 1200,
    position: { step: 'Implement', index: 1, total: 2, attempt: 1 },
    handedOffTo: null,
    handedOffFrom: null,
    ...over,
  };
}

function option(mode: ResumeOption['mode'], over: Partial<ResumeOption> = {}): ResumeOption {
  return { mode, available: true, description: `${mode} description`, target: null, waitsUntil: null, ...over };
}

/** The options of a codex session limited on Personal, with Team and Claude Work free. */
const LIMITED_OPTIONS: ResumeOption[] = [
  option('same', { target: 'codex-personal' as AccountId, waitsUntil: WAITS }),
  option('account', { target: 'codex-team' as AccountId }),
  option('agent', { target: 'claude-work' as AccountId }),
  option('fork', { target: 'codex-personal' as AccountId }),
];

interface Fake {
  sessions: ISessionsService;
  requests: ResumeRequest[];
  current: Session;
  options: ResumeOption[];
  resumeResult: Result<Session> | null;
}

function fake(over: { current?: Session; options?: ResumeOption[] } = {}): Fake {
  const state: Fake = {
    current: over.current ?? session(),
    options: over.options ?? LIMITED_OPTIONS,
    requests: [],
    resumeResult: null,
    sessions: {
      list: async () => ok([]),
      get: async () => ok(state.current),
      resumeOptions: async () => ok(state.options),
      resume: async (req) => {
        state.requests.push(req);
        if (state.resumeResult) return state.resumeResult;
        const id = req.mode === 'same' ? req.sessionId : ('s-a3f2' as SessionId);
        const accountId = req.mode === 'same' ? state.current.accountId : ('codex-team' as AccountId);
        return ok(session({ id, status: 'live', accountId, worktree: 'orch/r-04' as WorktreeId }));
      },
    },
  };
  return state;
}

describe('accountIdFromChoice', () => {
  it('turns agent@account into the account id', () => {
    expect(accountIdFromChoice('codex@team')).toBe('codex-team');
    expect(accountIdFromChoice('codex-team')).toBe('codex-team');
  });
});

describe('defaultMode', () => {
  it('hands off when the session account is limited and another account can take it', () => {
    expect(defaultMode(LIMITED_OPTIONS)).toBe('account');
  });

  it('continues when the account has room', () => {
    expect(defaultMode(LIMITED_OPTIONS.map((o) => (o.mode === 'same' ? { ...o, waitsUntil: null } : o)))).toBe('same');
  });
});

describe('menuLines', () => {
  it('prints the prototype prompt (Terminal.dc.html) with its wording', () => {
    const lines = menuLines(session(), LIMITED_OPTIONS, 2);
    expect(lines[0]).toMatch(/^! codex@personal is limited until \d{2}:\d{2}$/);
    expect(lines[1]).toMatch(/^  1\) wait and continue s-91e0 at \d{2}:\d{2} +full history$/);
    expect(lines[2]).toMatch(/^  2\) hand off to codex@team now +same worktree \+ summary$/);
    expect(lines[3]).toMatch(/^  3\) hand off to claude@work now +summary \+ job plan$/);
    expect(lines[4]).toMatch(/^  4\) fork into a new worktree$/);
    expect(lines[5]).toBe('  choose [2]: ');
  });
});

describe('orch resume', () => {
  it('continues a session that has room, without asking', async () => {
    const f = fake({ current: session({ status: 'ended' }), options: LIMITED_OPTIONS.map((o) => (o.mode === 'same' ? { ...o, waitsUntil: null } : o)) });
    const output: string[] = [];
    const code = await resumeCommand(f, 's-91e0', {}, (m) => output.push(m));
    expect(code).toBe(ExitCode.Success);
    expect(f.requests).toEqual([{ mode: 'same', sessionId: 's-91e0' }]);
    expect(output).toEqual(['✓ reopened codex session s-91e0 on codex@personal · worktree orch/r-04 intact']);
  });

  it('shows the four options for a limited session and runs the one chosen', async () => {
    const f = fake();
    const output: string[] = [];
    const asked: string[] = [];
    const code = await resumeCommand(f, 's-91e0', {}, (m) => output.push(m), async (question) => {
      asked.push(question);
      return '3';
    });
    expect(code).toBe(ExitCode.Success);
    expect(output.some((line) => line.includes('hand off to claude@work now'))).toBe(true);
    expect(asked).toEqual(['  choose [2]: ']);
    expect(f.requests).toEqual([{ mode: 'agent', sessionId: 's-91e0', to: 'claude-work' }]);
    expect(output.at(-1)).toBe('✓ started s-a3f2 on codex@team in orch/r-04');
  });

  it('takes the default option on an empty answer', async () => {
    const f = fake();
    await resumeCommand(f, 's-91e0', {}, () => undefined, async () => '');
    expect(f.requests).toEqual([{ mode: 'account', sessionId: 's-91e0', to: 'codex-team' }]);
  });

  it('refuses a menu answer that is not 1 to 4 and resumes nothing', async () => {
    const f = fake();
    const output: string[] = [];
    const code = await resumeCommand(f, 's-91e0', {}, (m) => output.push(m), async () => '9');
    expect(code).toBe(ExitCode.InvalidUsage);
    expect(output).toContain('Pick a number from 1 to 4.');
    expect(f.requests).toEqual([]);
  });

  it('hands off to the account given with --to, as an account hand-off for the same agent', async () => {
    const f = fake();
    const code = await resumeCommand(f, 's-91e0', { to: 'codex@team' }, () => undefined);
    expect(code).toBe(ExitCode.Success);
    expect(f.requests).toEqual([{ mode: 'account', sessionId: 's-91e0', to: 'codex-team' }]);
  });

  it('hands off to another agent with --to', async () => {
    const f = fake();
    await resumeCommand(f, 's-91e0', { to: 'claude@work' }, () => undefined);
    expect(f.requests).toEqual([{ mode: 'agent', sessionId: 's-91e0', to: 'claude-work' }]);
  });

  it('forks with --fork', async () => {
    const f = fake();
    await resumeCommand(f, 's-91e0', { fork: true }, () => undefined);
    expect(f.requests).toEqual([{ mode: 'fork', sessionId: 's-91e0' }]);
  });

  it('prints the service error with its fix and exits with a problem code', async () => {
    const f = fake();
    const error: OrchError = { code: 'conflict', message: 'Session s-91e0 is still live.', fix: 'Open it in the workspace instead.' };
    f.resumeResult = err(error);
    const output: string[] = [];
    const code = await resumeCommand(f, 's-91e0', { fork: true }, (m) => output.push(m));
    expect(code).toBe(ExitCode.ProblemFound);
    expect(output).toEqual(['Error: Session s-91e0 is still live.\nFix: Open it in the workspace instead.']);
  });

  it('rejects a session id that is not in orch form', async () => {
    const f = fake();
    const output: string[] = [];
    const code = await resumeCommand(f, 'nope', {}, (m) => output.push(m));
    expect(code).toBe(ExitCode.InvalidUsage);
    expect(f.requests).toEqual([]);
  });

  it('prints the session as JSON with --json', async () => {
    const f = fake();
    const output: string[] = [];
    await resumeCommand(f, 's-91e0', { fork: true, json: true }, (m) => output.push(m));
    const parsed = JSON.parse(output.join('')) as Session;
    expect(parsed.id).toBe('s-a3f2');
    const status: SessionStatus = parsed.status;
    expect(status).toBe('live');
  });
});
