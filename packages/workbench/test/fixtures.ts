/** Sample contract objects for workbench tests. Each one passes its contracts schema. */
import type { Account, AgentInfo, QuotaWindow, Run, RunLine, Session, WorktreeReview } from '@orch/contracts';

export function sampleAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'claude-team' as Account['id'],
    agent: 'claude',
    name: 'Team',
    primary: true,
    use: true,
    state: 'available',
    emailMasked: 'd•••@acme.dev',
    profileDir: '/home/orch/.orch/profiles/claude-team',
    skillsShared: false,
    ...overrides,
  };
}

export function sampleAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'claude',
    displayName: 'Claude Code',
    command: 'claude',
    installed: true,
    support: 'parallel',
    supportByOs: { macos: 'parallel', linux: 'parallel', windows: 'parallel' },
    accountSetting: 'via CLAUDE_CONFIG_DIR',
    sharedSkillsDir: null,
    sharedSkillsCount: 0,
    ...overrides,
  };
}

export function sampleQuotaWindow(overrides: Partial<QuotaWindow> = {}): QuotaWindow {
  return {
    accountId: 'claude-team' as QuotaWindow['accountId'],
    window: '5h',
    usedPct: 40,
    resetsAt: '2026-10-11T18:00:00.000Z',
    source: 'reported',
    seenAt: '2026-10-11T13:00:00.000Z',
    ...overrides,
  };
}

export function sampleRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'r-1' as Run['id'],
    jobId: 'j-1' as Run['jobId'],
    parentId: null,
    depth: 0,
    role: 'implementer',
    task: 'Add the queue view',
    agent: 'claude',
    accountId: 'claude-team' as Run['accountId'],
    status: 'running',
    worktree: null,
    readOnly: false,
    sessionId: null,
    startedAt: '2026-10-11T13:00:00.000Z',
    resumesAt: null,
    ...overrides,
  };
}

export function sampleLine(overrides: Partial<RunLine> = {}): RunLine {
  return {
    runId: 'r-1' as RunLine['runId'],
    seq: 1,
    at: '2026-10-11T13:00:01.000Z',
    kind: 'message',
    text: 'Reading the spec',
    ...overrides,
  };
}

export function sampleReview(overrides: Partial<WorktreeReview> = {}): WorktreeReview {
  return {
    worktree: 'orch/queue-view' as WorktreeReview['worktree'],
    jobId: 'j-1' as WorktreeReview['jobId'],
    runId: 'r-1' as WorktreeReview['runId'],
    sessionId: null,
    title: 'Add the queue view',
    state: 'ready',
    verdict: 'verified',
    checks: [],
    files: [],
    evidenceRef: null,
    note: null,
    ...overrides,
  };
}

export type SessionFixture = Session;
