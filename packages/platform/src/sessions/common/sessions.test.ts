import { describe, expect, it } from 'vitest';
import type { AccountId, QuotaWindow, Session, SessionId, WorktreeId, AgentId } from '@orchagents/contracts';
import {
  accountFacts,
  buildResumeOptions,
  type AccountFacts,
  defaultResumeMode,
  expiredSessionIds,
  FORK_DESCRIPTION,
  forkBaseOf,
  forkBranchName,
  nextForkNumber,
  SESSION_KEEP_DAYS,
  sessionIdFromRandom,
  type SessionRecord,
} from './sessions.js';

const NOW = new Date('2026-10-11T12:00:00.000Z');

function facts(id: string, agent: AgentId, over: Partial<AccountFacts> = {}): AccountFacts {
  return {
    id: id as AccountId,
    agent,
    name: id.split('-')[1]!.replace(/^./, (c) => c.toUpperCase()),
    use: true,
    state: 'available',
    usedPct: 10,
    resetsAt: null,
    ...over,
  };
}

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

describe('accountFacts', () => {
  const window = (accountId: string, usedPct: number, resetsAt: string | null): QuotaWindow => ({
    accountId: accountId as AccountId,
    window: '5h',
    usedPct,
    resetsAt: resetsAt as QuotaWindow['resetsAt'],
    source: 'reported',
    seenAt: '2026-10-11T11:59:00.000Z',
  });

  it('takes the highest usage and reports unknown usage as null', () => {
    const windows = [window('codex-personal', 40, null), window('codex-personal', 62, null), window('codex-team', 5, null)];
    expect(accountFacts({ id: 'codex-personal' as AccountId, agent: 'codex', name: 'Personal', use: true, state: 'available' }, windows, NOW).usedPct).toBe(62);
    expect(accountFacts({ id: 'codex-new' as AccountId, agent: 'codex', name: 'New', use: true, state: 'available' }, windows, NOW).usedPct).toBeNull();
  });

  it('reports the reset of a window at 100% only while it is still in the future', () => {
    const later = accountFacts(
      { id: 'codex-personal' as AccountId, agent: 'codex', name: 'Personal', use: true, state: 'limited' },
      [window('codex-personal', 100, '2026-10-11T15:00:00.000Z')],
      NOW,
    );
    expect(later.resetsAt).toBe('2026-10-11T15:00:00.000Z');
    const past = accountFacts(
      { id: 'codex-personal' as AccountId, agent: 'codex', name: 'Personal', use: true, state: 'limited' },
      [window('codex-personal', 100, '2026-10-11T11:00:00.000Z')],
      NOW,
    );
    expect(past.resetsAt).toBeNull();
  });
});

describe('buildResumeOptions', () => {
  it('offers no options for a live session', () => {
    expect(buildResumeOptions({ session: session({ status: 'live' }), hasEngineHandle: true, accounts: [facts('codex-personal', 'codex')] })).toEqual([]);
  });

  it('offers the four modes in order, with the prototype copy when everything has room', () => {
    const options = buildResumeOptions({
      session: session(),
      hasEngineHandle: true,
      accounts: [facts('codex-personal', 'codex'), facts('codex-team', 'codex'), facts('claude-work', 'claude')],
    });
    expect(options.map((o) => o.mode)).toEqual(['same', 'account', 'agent', 'fork']);
    expect(options[0]).toMatchObject({ available: true, target: 'codex-personal', waitsUntil: null, description: 'Reopens s-91e0 on codex · Personal with its full history.' });
    expect(options[1]).toMatchObject({ available: true, target: 'codex-team', description: 'New codex session on Team in the same worktree, primed with a summary of this one.' });
    expect(options[2]).toMatchObject({ available: true, target: 'claude-work', description: 'Continue on Claude Code · Work with the summary and the job plan.' });
    expect(options[3]).toMatchObject({ available: true, target: 'codex-personal', description: FORK_DESCRIPTION });
  });

  it('makes continue wait for the reset when the account is limited, and hands off by default', () => {
    const accounts = [
      facts('codex-personal', 'codex', { state: 'limited', resetsAt: '2026-10-11T15:00:00.000Z', usedPct: 100 }),
      facts('codex-team', 'codex'),
    ];
    const options = buildResumeOptions({ session: session(), hasEngineHandle: true, accounts });
    expect(options[0]).toMatchObject({ mode: 'same', available: true, waitsUntil: '2026-10-11T15:00:00.000Z' });
    expect(options[0]?.description).toMatch(/^Reopens s-91e0 with its full history\. Personal is limited, so this waits until \d{2}:\d{2}\.$/);
    expect(defaultResumeMode(options)).toBe('account');
  });

  it('disables a hand-off with its reason when no other account has room', () => {
    const accounts = [facts('codex-personal', 'codex'), facts('codex-team', 'codex', { state: 'limited', usedPct: 100 }), facts('codex-old', 'codex', { use: false })];
    const options = buildResumeOptions({ session: session(), hasEngineHandle: true, accounts });
    expect(options[1]).toEqual({ mode: 'account', available: false, description: 'No other codex account has room right now.', target: null, waitsUntil: null });
    expect(defaultResumeMode(options)).toBe('same');
  });

  it('disables the agent hand-off when no other agent has room', () => {
    const options = buildResumeOptions({ session: session(), hasEngineHandle: true, accounts: [facts('codex-personal', 'codex')] });
    expect(options[2]).toEqual({ mode: 'agent', available: false, description: 'No other agent has room right now.', target: null, waitsUntil: null });
  });

  it('disables continue when orch has no engine record of the session', () => {
    const options = buildResumeOptions({ session: session(), hasEngineHandle: false, accounts: [facts('codex-personal', 'codex')] });
    expect(options[0]?.available).toBe(false);
  });

  it('disables fork for a session without a worktree', () => {
    const options = buildResumeOptions({ session: session({ worktree: null }), hasEngineHandle: true, accounts: [facts('codex-personal', 'codex')] });
    expect(options[3]).toMatchObject({ mode: 'fork', available: false, target: null });
  });
});

describe('forks and ids', () => {
  it('names forks orch/<run-id>-fork-<n> and counts past forks of the same run', () => {
    expect(forkBaseOf('orch/r-04' as WorktreeId)).toBe('r-04');
    expect(forkBaseOf('orch/r-04-fork-2' as WorktreeId)).toBe('r-04');
    expect(nextForkNumber('r-04', ['orch/r-04', 'orch/r-04-fork-1', 'orch/r-04-fork-3', 'orch/r-40-fork-9'])).toBe(4);
    expect(nextForkNumber('r-04', ['orch/r-04'])).toBe(1);
    expect(forkBranchName('r-04', 1)).toBe('orch/r-04-fork-1');
  });

  it('makes session ids s- plus four hex digits (JOB-01)', () => {
    expect(sessionIdFromRandom(0)).toBe('s-0000');
    expect(sessionIdFromRandom(0.999999)).toBe('s-ffff');
    expect(sessionIdFromRandom(0.5)).toMatch(/^s-[0-9a-f]{4}$/);
  });
});

describe('expiredSessionIds (SES-04)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const record = (id: string, status: Session['status'], endedAt: Date): SessionRecord => ({
    session: session({ id: id as SessionId, status, lastActivityAt: endedAt.toISOString() as Session['lastActivityAt'] }),
    engineHandle: null,
    cwd: null,
  });

  it('keeps SESSION_KEEP_DAYS = 90 and removes only ended sessions past that', () => {
    expect(SESSION_KEEP_DAYS).toBe(90);
    const now = NOW;
    const records = [
      record('s-0001', 'ended', new Date(now.getTime() - 90 * DAY)),
      record('s-0002', 'ended', new Date(now.getTime() - 90 * DAY + 60_000)),
      record('s-0003', 'ended', new Date(now.getTime() - 3 * DAY)),
      record('s-0004', 'interrupted', new Date(now.getTime() - 400 * DAY)),
      record('s-0005', 'live', new Date(now.getTime() - 400 * DAY)),
    ];
    expect(expiredSessionIds(records, now)).toEqual(['s-0001']);
  });
});
