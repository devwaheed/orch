import { describe, expect, it } from 'vitest';
import { AccountId, AgentId, SessionId, WorktreeId, type ResumeOption, type Session } from '@orchagents/contracts';
import {
  buildResumeRequest,
  cliLine,
  defaultResumeMode,
  effectiveResumeMode,
  filterCounts,
  filterOptions,
  filterSessions,
  sessionsForProject,
  sessionsInDefaultWindow,
  formatAgentAccount,
  formatTokens,
  formatWhen,
  positionText,
  resolveSelection,
  resumeButtonLabel,
  resumeRows,
  sessionDetails,
  sessionListRow,
  statusView,
  noteTone,
} from './sessionsView.js';

const NOW = new Date(2026, 9, 11, 14, 0, 0);
const at = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m, d, h, min).toISOString();

const CODEX_PERSONAL = AccountId.parse('codex-personal');
const CODEX_TEAM = AccountId.parse('codex-team');
const CLAUDE_PERSONAL = AccountId.parse('claude-personal');
const AGENTS = [
  { id: AgentId.parse('claude'), displayName: 'Claude Code', command: 'claude' },
  { id: AgentId.parse('codex'), displayName: 'Codex', command: 'codex' },
];
const ACCOUNTS = [
  { id: CODEX_PERSONAL, name: 'Personal', agent: AgentId.parse('codex') },
  { id: CODEX_TEAM, name: 'Team', agent: AgentId.parse('codex') },
  { id: CLAUDE_PERSONAL, name: 'Personal', agent: AgentId.parse('claude') },
];

function session(overrides: Partial<Omit<Session, 'id'>> & { id: string; status: Session['status'] }): Session {
  return {
    jobId: 'j-01' as Session['jobId'],
    runId: null,
    title: 'Refactor session middleware',
    agent: AgentId.parse('codex'),
    accountId: CODEX_PERSONAL,
    cliSessionId: '91e0…0b47',
    worktree: null,
    startedAt: at(2026, 9, 11, 12, 31),
    lastActivityAt: at(2026, 9, 11, 12, 46),
    tokens: 61000,
    position: { step: 'Implement', index: 2, total: 5, attempt: 1 },
    handedOffTo: null,
    handedOffFrom: null,
    ...overrides,
    id: SessionId.parse(overrides.id),
  };
}

const live = session({ id: 's-0f9d', status: 'live' });
const paused = session({ id: 's-91e0', status: 'paused', worktree: WorktreeId.parse('orch/r-04'), runId: null });
const ended = session({ id: 's-c410', status: 'ended' });
const interrupted = session({ id: 's-2d18', status: 'interrupted' });
const all = [live, paused, ended, interrupted];

function option(mode: ResumeOption['mode'], patch: Partial<ResumeOption> = {}): ResumeOption {
  return { mode, available: true, description: `${mode} description`, target: null, waitsUntil: null, ...patch };
}

describe('filters', () => {
  it('shows only sessions for the open project and excludes sessions without a project job', () => {
    const projectJobs = [
      { id: 'j-01' as Session['jobId'], spec: { repoPath: '/project' } },
      { id: 'j-02' as Session['jobId'], spec: { repoPath: '/other' } },
    ];
    const otherProject = session({ id: 's-a115', status: 'ended', jobId: 'j-02' as Session['jobId'] });
    expect(sessionsForProject([...all, otherProject], projectJobs, '/project').map((item) => item.id)).toEqual(all.map((item) => item.id));
    expect(sessionsForProject([live], projectJobs, '').map((item) => item.id)).toEqual([]);
    expect(sessionsForProject([live], [], '/project')).toEqual([]);
  });

  it('defaults to seven days while always retaining live and paused sessions', () => {
    const recent = session({ id: 's-a111', status: 'ended', lastActivityAt: at(2026, 9, 4, 14, 0) });
    const oldEnded = session({ id: 's-a112', status: 'ended', lastActivityAt: at(2026, 9, 3, 13, 59) });
    const oldPaused = session({ id: 's-a113', status: 'paused', lastActivityAt: at(2026, 9, 1, 14, 0) });
    const oldLive = session({ id: 's-a114', status: 'live', lastActivityAt: at(2026, 8, 1, 14, 0) });
    expect(sessionsInDefaultWindow([recent, oldEnded, oldPaused, oldLive], NOW).map((item) => item.id)).toEqual([
      's-a111', 's-a113', 's-a114',
    ]);
  });

  it('All keeps every session; Live keeps only live; Resumable keeps the rest', () => {
    expect(filterSessions(all, 'all')).toHaveLength(4);
    expect(filterSessions(all, 'live').map((s) => s.id)).toEqual(['s-0f9d']);
    expect(filterSessions(all, 'resumable').map((s) => s.id)).toEqual(['s-91e0', 's-c410', 's-2d18']);
  });

  it('counts each filter and labels it as the screen shows it', () => {
    const counts = filterCounts(all);
    expect(counts).toEqual({ all: 4, resumable: 3, live: 1 });
    expect(filterOptions(counts, 'resumable')).toEqual([
      { id: 'all', label: 'All · 4', pressed: false },
      { id: 'resumable', label: 'Resumable · 3', pressed: true },
      { id: 'live', label: 'Live · 1', pressed: false },
    ]);
  });

  it('keeps the selected session when it is still listed, otherwise the first one, otherwise none', () => {
    const filtered = filterSessions(all, 'resumable');
    expect(resolveSelection(filtered, SessionId.parse('s-c410'))?.id).toBe('s-c410');
    expect(resolveSelection(filtered, SessionId.parse('s-0f9d'))?.id).toBe('s-91e0');
    expect(resolveSelection(filtered, null)?.id).toBe('s-91e0');
    expect(resolveSelection([], null)).toBeNull();
  });
});

describe('status', () => {
  it('always gives a word with the colour, and uses the prototype labels', () => {
    expect(statusView('live')).toEqual({ label: 'Live', tone: 'info' });
    expect(statusView('paused')).toEqual({ label: 'Paused · limit', tone: 'warn' });
    expect(statusView('ended')).toEqual({ label: 'Ended', tone: 'neutral' });
    expect(statusView('interrupted')).toEqual({ label: 'Interrupted', tone: 'err' });
  });

  it('tones the note by status', () => {
    expect(noteTone('paused')).toBe('warn');
    expect(noteTone('interrupted')).toBe('err');
    expect(noteTone('ended')).toBe('info');
  });
});

describe('formatting', () => {
  it('shows tokens in thousands as the prototype does', () => {
    expect(formatTokens(61000)).toBe('61k');
    expect(formatTokens(182000)).toBe('182k');
    expect(formatTokens(6000)).toBe('6k');
    expect(formatTokens(999)).toBe('999');
  });

  it('writes the position with its step, its place in the job, and the try after the first', () => {
    expect(positionText({ step: 'Implement', index: 2, total: 5, attempt: 1 })).toBe('Implement · step 2 of 5');
    expect(positionText({ step: 'Verify', index: 4, total: 5, attempt: 3 })).toBe('Verify · step 4 of 5, try 3');
  });

  it('says Today, Yesterday, or the date, with the local clock', () => {
    expect(formatWhen(at(2026, 9, 11, 12, 31), NOW)).toBe('Today 12:31');
    expect(formatWhen(at(2026, 9, 10, 18, 2), NOW)).toBe('Yesterday 18:02');
    expect(formatWhen(at(2026, 9, 10, 18, 2), NOW, true)).toBe('Yest. 18:02');
    expect(formatWhen(at(2026, 9, 3, 9, 15), NOW)).toBe('Oct 3 09:15');
  });

  it('turns an account id into the CLI form, as CLI-01 takes it', () => {
    expect(formatAgentAccount('codex', 'codex-team')).toBe('codex@team');
    expect(formatAgentAccount('claude', 'claude-work')).toBe('claude@work');
  });
});

describe('list rows', () => {
  it('shows now for a live session and the time of last activity otherwise', () => {
    const jobTitle = 'Add OAuth login';
    const liveRow = sessionListRow(live, { jobTitle, agents: AGENTS, accounts: ACCOUNTS, now: NOW });
    expect(liveRow.last).toBe('now');
    expect(liveRow.status.label).toBe('Live');
    const pausedRow = sessionListRow(paused, { jobTitle, agents: AGENTS, accounts: ACCOUNTS, now: NOW });
    expect(pausedRow.last).toBe('Today 12:46');
    expect(pausedRow.agentName).toBe('Codex');
    expect(pausedRow.accountName).toBe('Personal');
    expect(pausedRow.badge).toEqual({ mono: 'CX', tone: 'cx' });
  });
});

describe('details', () => {
  it('says Now at for a live session and Stopped at otherwise', () => {
    const pausedFacts = sessionDetails(paused, { jobTitle: 'Add OAuth login', agents: AGENTS, accounts: ACCOUNTS, now: NOW }).facts;
    expect(pausedFacts.at(-1)).toEqual({ key: 'Stopped at', value: 'Implement · step 2 of 5' });
    const liveFacts = sessionDetails(live, { jobTitle: 'Add OAuth login', agents: AGENTS, accounts: ACCOUNTS, now: NOW }).facts;
    expect(liveFacts.at(-1)?.key).toBe('Now at');
  });

  it('shows the prototype limit annotation in the stopped position', () => {
    expect(positionText({
      step: 'Implement', index: 2, total: 5, attempt: 1,
      note: 'Paused when Codex · Personal hit its 5-hour limit. Worktree and transcript are saved.',
    })).toBe('Implement · step 2 of 5 (paused by limit)');
  });

  it('lists the facts in the prototype order with dashes for what is not set', () => {
    const details = sessionDetails(paused, { jobTitle: '', agents: AGENTS, accounts: ACCOUNTS, now: NOW });
    expect(details.facts.map((f) => f.key)).toEqual([
      'Job',
      'Agent · account',
      'Worktree',
      'Run',
      'Started',
      'Tokens used',
      'Stopped at',
    ]);
    expect(details.facts[0]?.value).toBe('—');
    expect(details.facts[1]?.value).toBe('Codex · Personal');
    expect(details.facts[2]?.value).toBe('orch/r-04');
    expect(details.facts[3]?.value).toBe('—');
    expect(details.facts[4]?.value).toBe('Today 12:31');
    expect(details.facts[5]?.value).toBe('61k');
    expect(details.idLine).toBe('s-91e0 · codex 91e0…0b47');
  });

  it('marks a live session so the screen shows only Open in workspace', () => {
    expect(sessionDetails(live, { jobTitle: '', agents: AGENTS, accounts: ACCOUNTS, now: NOW }).isLive).toBe(true);
    expect(sessionDetails(paused, { jobTitle: '', agents: AGENTS, accounts: ACCOUNTS, now: NOW }).isLive).toBe(false);
  });
});

describe('resume options', () => {
  const full: ResumeOption[] = [
    option('same', { description: 'Reopens s-91e0 on Codex · Personal with its full history.', target: CODEX_PERSONAL }),
    option('account', { target: CODEX_TEAM, description: 'New codex session on Team in the same worktree.' }),
    option('agent', { target: CLAUDE_PERSONAL, description: 'Continue on Claude Code · Personal with the summary and the job plan.' }),
    option('fork', { description: 'Copy the current state to a new branch.' }),
  ];

  it('pre-selects continue when the account can take it, and hand-off when this account is limited', () => {
    expect(defaultResumeMode(full)).toBe('same');
    const limited = full.map((o) => (o.mode === 'same' ? { ...o, waitsUntil: at(2026, 9, 11, 15, 0) } : o));
    expect(defaultResumeMode(limited)).toBe('account');
    const noAccount = limited.map((o) => (o.mode === 'account' ? { ...o, available: false, target: null } : o));
    expect(defaultResumeMode(noAccount)).toBe('same');
  });

  it('falls back to the default when the chosen option is not available', () => {
    const unavailable = full.map((o) => (o.mode === 'fork' ? { ...o, available: false } : o));
    expect(effectiveResumeMode(unavailable, 'fork')).toBe('same');
    expect(effectiveResumeMode(unavailable, 'agent')).toBe('agent');
  });

  it('returns no mode when nothing is available', () => {
    expect(defaultResumeMode(full.map((o) => ({ ...o, available: false })))).toBeNull();
  });

  it('lays out the rows in the core order, shows the core description, and disables a row with no target', () => {
    const rows = resumeRows(
      full.map((o) => (o.mode === 'agent' ? { ...o, available: false, target: null, description: 'No other agent has room right now.' } : o)),
      'account',
    );
    expect(rows.map((r) => r.title)).toEqual([
      'Continue this session',
      'Hand off to another account',
      'Hand off to another agent',
      'Fork into a new worktree',
    ]);
    expect(rows.map((r) => r.checked)).toEqual([false, true, false, false]);
    expect(rows[2]).toMatchObject({ available: false, description: 'No other agent has room right now.' });
    expect(rows[0]?.description).toBe('Reopens s-91e0 on Codex · Personal with its full history.');
  });

  it('names the resume button after the target', () => {
    const ctx = { agents: AGENTS, accounts: ACCOUNTS };
    expect(resumeButtonLabel('same', full[0], ctx)).toBe('Resume session');
    expect(resumeButtonLabel('account', full[1], ctx)).toBe('Resume on Team');
    expect(resumeButtonLabel('agent', full[2], ctx)).toBe('Hand off to Claude Code');
    expect(resumeButtonLabel('fork', full[3], ctx)).toBe('Fork session');
    const waiting = option('same', { waitsUntil: at(2026, 9, 11, 15, 0), target: CODEX_PERSONAL });
    expect(resumeButtonLabel('same', waiting, ctx)).toBe('Schedule for 15:00');
  });
});

describe('CLI line', () => {
  const sid = SessionId.parse('s-91e0');
  const accounts = ACCOUNTS.map((a) => ({ id: a.id, agent: a.agent }));
  const opts = {
    account: option('account', { target: CODEX_TEAM }),
    agent: option('agent', { target: CLAUDE_PERSONAL }),
    same: option('same', { target: CODEX_PERSONAL }),
    waiting: option('same', { target: CODEX_PERSONAL, waitsUntil: at(2026, 9, 11, 15, 0) }),
    fork: option('fork'),
  };

  it('builds the CLI-01 form for each mode', () => {
    expect(cliLine(sid, 'same', opts.same, accounts)).toBe('orch resume s-91e0');
    expect(cliLine(sid, 'account', opts.account, accounts)).toBe('orch resume s-91e0 --to codex@team');
    expect(cliLine(sid, 'agent', opts.agent, accounts)).toBe('orch resume s-91e0 --to claude@personal');
    expect(cliLine(sid, 'fork', opts.fork, accounts)).toBe('orch resume s-91e0 --fork');
    expect(cliLine(sid, null, undefined, accounts)).toBe('orch resume s-91e0');
  });

  it('adds the scheduled comment only to a continue that waits for a reset', () => {
    expect(cliLine(sid, 'same', opts.waiting, accounts)).toBe('orch resume s-91e0  # scheduled for 15:00');
  });
});

describe('resume requests', () => {
  const sid = SessionId.parse('s-91e0');
  it('sends the mode the person sees, with the target for a hand-off', () => {
    expect(buildResumeRequest(sid, 'same', option('same'))).toEqual({ mode: 'same', sessionId: sid });
    expect(buildResumeRequest(sid, 'fork', option('fork'))).toEqual({ mode: 'fork', sessionId: sid });
    expect(buildResumeRequest(sid, 'account', option('account', { target: CODEX_TEAM }))).toEqual({
      mode: 'account',
      sessionId: sid,
      to: CODEX_TEAM,
    });
  });

  it('sends nothing for a hand-off with no target', () => {
    expect(buildResumeRequest(sid, 'agent', option('agent', { target: null }))).toBeNull();
    expect(buildResumeRequest(sid, null, undefined)).toBeNull();
  });
});
