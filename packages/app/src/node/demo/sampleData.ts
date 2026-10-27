/**
 * Sample data transcribed EXACTLY from design/prototype/Main.dc.html renderVals().
 *
 * Each section cites the prototype variable name in comments:
 * - AG: accounts and agent info (lines 1588-1608)
 * - SUP: OS support and isolation setting (lines 1610-1616)
 * - SKSRC: shared skills directories and counts (line 1995)
 * - jobsDef: jobs list (lines 1920-1924)
 * - R: active/queued runs (lines 1759-1768)
 * - LN: agent run log lines (lines 1775-1836)
 * - SS: sessions and positions (lines 2013-2027)
 * - STOP: session stopped positions (lines 2028-2033)
 * - WT: worktree reviews and checks (lines 2163-2176)
 * - DIFFS: file diffs per worktree (lines 2178-2183)
 * - TR / TRA / LAYCOUNT / gardenFinds: trust figures (lines 2302-2338)
 * - SPECS: spec queue and criteria (lines 2352-2375)
 * - SH: terminal dock shells (lines 2240-2245)
 * - yamlRaw: accounts.yaml text (lines 2260-2273)
 *
 * Differences from prototype representation to contract schemas:
 * 1. AG.state uses 'near' and 'auth'; contracts use 'near_limit' and 'signed_out'.
 * 2. AG.windows label uses '5-hour', 'Weekly', 'Daily', 'Copilot monthly'; contracts use '5h', 'weekly', 'daily', 'monthly'.
 * 3. Relative timestamps (e.g. '4 min ago', 'Today 12:28', 'now') are converted to UTC ISO-8601 timestamps.
 * 4. SS.status uses 'orphaned'; contracts use 'interrupted'.
 * 5. SS.tokens uses strings like '182k'; contracts use integers (182000).
 * 6. LN kinds 'you' and 'msg' map to contract kinds 'prompt' and 'message'.
 * 7. WT.state uses 'progress'; contracts use 'in_progress'.
 * 8. WT.checks tuples map to CheckResult objects with structured Check definitions.
 * 9. WT.files tuples map to ChangedFile { path, added, removed }.
 * 10. TR percentages (strings like '76%') and '4 of 5' ratios map to numbers and { moved: 4, total: 5 }.
 */
import type {
  Account,
  AccountId,
  AccountsFile,
  AgentId,
  AgentInfo,
  DoctorReport,
  Job,
  JobId,
  Os,
  QueueId,
  QuotaWindow,
  Run,
  RunId,
  RunLine,
  Session,
  SessionId,
  SpecId,
  SpecQueue,
  SpecRun,
  TrustSummary,
  WorktreeId,
  WorktreeReview,
} from '@orchagents/contracts';

/** Prototype account windows use local clock times, regardless of the machine's UTC offset. */
function demoLocalAt(year: number, month: number, day: number, hour: number, minute: number): string {
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
}

function demoLocalClock(iso: string): string {
  const date = new Date(iso);
  return new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  ).toISOString();
}

export const DEMO_RESET_AT = demoLocalAt(2026, 10, 11, 15, 0);
const seenMinutesAgo = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();
const QUOTA_SEEN = {
  claudePersonal: seenMinutesAgo(4),
  claudeWork: seenMinutesAgo(9),
  codexPersonal: seenMinutesAgo(1),
  codexTeam: seenMinutesAgo(2),
  openCode: seenMinutesAgo(6),
};

// ---------- accounts & agents (Prototype: AG, SUP, SKSRC) ----------

export const DEMO_ACCOUNTS: readonly Account[] = [
  // Prototype AG[0].accounts[0] (claude-personal)
  {
    id: 'claude-personal' as AccountId,
    agent: 'claude',
    name: 'Personal',
    primary: true,
    use: true,
    state: 'available',
    emailMasked: 'a•••@gmail.com',
    plan: 'Max',
    profileDir: '~/.orch/profiles/claude-personal',
    skillsShared: true,
  },
  // Prototype AG[0].accounts[1] (claude-work)
  {
    id: 'claude-work' as AccountId,
    agent: 'claude',
    name: 'Work',
    primary: false,
    use: true,
    state: 'near_limit', // prototype: 'near'
    emailMasked: 'a•••@acme.dev',
    plan: 'Pro',
    profileDir: '~/.orch/profiles/claude-work',
    skillsShared: true,
  },
  // Prototype AG[1].accounts[0] (codex-personal)
  {
    id: 'codex-personal' as AccountId,
    agent: 'codex',
    name: 'Personal',
    primary: true,
    use: true,
    state: 'limited',
    emailMasked: 'a•••@gmail.com',
    plan: 'Plus',
    profileDir: '~/.orch/profiles/codex-personal',
    skillsShared: true,
  },
  // Prototype AG[1].accounts[1] (codex-team)
  {
    id: 'codex-team' as AccountId,
    agent: 'codex',
    name: 'Team',
    primary: false,
    use: true,
    state: 'available',
    emailMasked: 'a•••@acme.dev',
    plan: 'Team',
    profileDir: '~/.orch/profiles/codex-team',
    skillsShared: true,
  },
  // Prototype AG[2].accounts[0] (agy-main)
  {
    id: 'agy-main' as AccountId,
    agent: 'agy',
    name: 'Main',
    primary: true,
    use: true,
    state: 'estimated',
    emailMasked: 'a•••@gmail.com',
    plan: 'Google account',
    profileDir: '~/.orch/profiles/agy-main',
    skillsShared: true,
  },
  // Prototype AG[2].accounts[1] (agy-alt)
  {
    id: 'agy-alt' as AccountId,
    agent: 'agy',
    name: 'Alt',
    primary: false,
    use: true,
    state: 'signed_out', // prototype: 'auth'
    emailMasked: 'b•••@gmail.com',
    plan: 'Google account',
    profileDir: '~/.orch/profiles/agy-alt',
    skillsShared: true,
  },
  // Prototype AG[3].accounts[0] (gemini-google)
  {
    id: 'gemini-google' as AccountId,
    agent: 'gemini',
    name: 'Google',
    primary: true,
    use: true,
    state: 'estimated',
    emailMasked: 'a•••@gmail.com',
    plan: 'Free tier',
    profileDir: '~/.orch/profiles/gemini-google',
    skillsShared: true,
  },
  // Prototype AG[4].accounts[0] (opencode-main)
  {
    id: 'opencode-main' as AccountId,
    agent: 'opencode',
    name: 'Main',
    primary: true,
    use: true,
    state: 'available',
    emailMasked: 'a•••@acme.dev',
    plan: '2 provider logins',
    profileDir: '~/.orch/profiles/opencode-main',
    skillsShared: true,
    providers: [
      { provider: 'GitHub Copilot', kind: 'subscription' },
      { provider: 'OpenAI', kind: 'api_key' },
    ],
  },
];

export const DEMO_AGENTS: readonly AgentInfo[] = [
  // Prototype AG[0] + SUP.claude + SKSRC.claude
  {
    id: 'claude',
    displayName: 'Claude Code',
    command: 'claude',
    installed: true,
    version: '1.0.0',
    support: 'parallel',
    supportByOs: { macos: 'parallel', linux: 'parallel', windows: 'parallel' },
    accountSetting: 'CLAUDE_CONFIG_DIR',
    sharedSkillsDir: '~/.claude/skills',
    sharedSkillsCount: 12,
    sharedSkillNames: ['saas-factory'],
  },
  // Prototype AG[1] + SUP.codex + SKSRC.codex
  {
    id: 'codex',
    displayName: 'Codex',
    command: 'codex',
    installed: true,
    version: '1.0.0',
    support: 'parallel',
    supportByOs: { macos: 'parallel', linux: 'parallel', windows: 'parallel' },
    accountSetting: 'CODEX_HOME',
    sharedSkillsDir: '~/.codex/skills',
    sharedSkillsCount: 9,
    sharedSkillNames: ['saas-factory'],
  },
  // Prototype AG[2] + SUP.agy + SKSRC.agy
  {
    id: 'agy',
    displayName: 'Antigravity',
    command: 'agy',
    installed: true,
    version: '1.0.0',
    support: 'single',
    supportByOs: { macos: 'single', linux: 'parallel', windows: 'single' },
    accountSetting: 'separate home folder',
    sharedSkillsDir: '~/.gemini/antigravity/skills',
    sharedSkillsCount: 5,
    sharedSkillNames: ['saas-factory'],
  },
  // Prototype AG[3] + SUP.gemini + SKSRC.gemini
  {
    id: 'gemini',
    displayName: 'Gemini CLI',
    command: 'gemini',
    installed: true,
    version: '1.0.0',
    support: 'parallel',
    supportByOs: { macos: 'parallel', linux: 'parallel', windows: 'parallel' },
    accountSetting: 'GEMINI_CLI_HOME',
    sharedSkillsDir: '~/.gemini/skills',
    sharedSkillsCount: 7,
    sharedSkillNames: ['saas-factory'],
  },
  // Prototype AG[4] + SUP.opencode + SKSRC.opencode
  {
    id: 'opencode',
    displayName: 'OpenCode',
    command: 'opencode',
    installed: true,
    version: '1.0.0',
    support: 'parallel',
    supportByOs: { macos: 'parallel', linux: 'parallel', windows: 'unverified' },
    accountSetting: 'XDG_DATA_HOME + OPENCODE_CONFIG_DIR',
    sharedSkillsDir: '~/.config/opencode/skills',
    sharedSkillsCount: 6,
    sharedSkillNames: ['saas-factory'],
  },
];

// ---------- quota windows (Prototype: AG.accounts.windows) ----------

export const DEMO_QUOTA_WINDOWS: readonly QuotaWindow[] = [
  // claude-personal (AG[0].accounts[0].windows)
  {
    accountId: 'claude-personal' as AccountId,
    window: '5h',
    usedPct: 62,
    resetsAt: demoLocalAt(2026, 10, 11, 17, 30),
    source: 'reported',
    seenAt: QUOTA_SEEN.claudePersonal,
  },
  {
    accountId: 'claude-personal' as AccountId,
    window: 'weekly',
    usedPct: 41,
    resetsAt: demoLocalAt(2026, 10, 14, 11, 0),
    source: 'reported',
    seenAt: QUOTA_SEEN.claudePersonal,
  },
  // claude-work (AG[0].accounts[1].windows)
  {
    accountId: 'claude-work' as AccountId,
    window: '5h',
    usedPct: 91,
    resetsAt: demoLocalAt(2026, 10, 11, 16, 10),
    source: 'reported',
    seenAt: QUOTA_SEEN.claudeWork,
  },
  {
    accountId: 'claude-work' as AccountId,
    window: 'weekly',
    usedPct: 58,
    resetsAt: demoLocalAt(2026, 10, 15, 8, 0),
    source: 'reported',
    seenAt: QUOTA_SEEN.claudeWork,
  },
  // codex-personal (AG[1].accounts[0].windows)
  {
    accountId: 'codex-personal' as AccountId,
    window: '5h',
    usedPct: 100,
    resetsAt: DEMO_RESET_AT,
    source: 'reported',
    seenAt: QUOTA_SEEN.codexPersonal,
  },
  {
    accountId: 'codex-personal' as AccountId,
    window: 'weekly',
    usedPct: 71,
    resetsAt: demoLocalAt(2026, 10, 12, 9, 4),
    source: 'reported',
    seenAt: QUOTA_SEEN.codexPersonal,
  },
  // codex-team (AG[1].accounts[1].windows)
  {
    accountId: 'codex-team' as AccountId,
    window: '5h',
    usedPct: 22,
    resetsAt: demoLocalAt(2026, 10, 11, 18, 40),
    source: 'reported',
    seenAt: QUOTA_SEEN.codexTeam,
  },
  {
    accountId: 'codex-team' as AccountId,
    window: 'weekly',
    usedPct: 12,
    resetsAt: demoLocalAt(2026, 10, 12, 9, 4),
    source: 'reported',
    seenAt: QUOTA_SEEN.codexTeam,
  },
  // agy-main (AG[2].accounts[0].windows)
  {
    accountId: 'agy-main' as AccountId,
    window: 'daily',
    usedPct: 30,
    resetsAt: '2026-10-12T07:00:00Z',
    source: 'estimated',
    seenAt: '2026-10-11T12:00:00Z',
  },
  // gemini-google (AG[3].accounts[0].windows)
  {
    accountId: 'gemini-google' as AccountId,
    window: 'daily',
    usedPct: 38,
    resetsAt: '2026-10-12T07:00:00Z',
    source: 'estimated',
    seenAt: '2026-10-11T12:00:00Z',
  },
  // opencode-main (AG[4].accounts[0].windows)
  {
    accountId: 'opencode-main' as AccountId,
    window: 'monthly',
    usedPct: 34,
    resetsAt: '2026-11-01T00:00:00Z',
    source: 'reported',
    seenAt: QUOTA_SEEN.openCode,
  },
];

// ---------- jobs (Prototype: jobsDef) ----------

export const DEMO_JOBS: readonly Job[] = [
  // Prototype jobsDef[0] (j-07)
  {
    id: 'j-07' as JobId,
    title: 'Add OAuth login',
    status: 'running',
    step: {
      name: 'Implement',
      index: 2,
      total: 5,
      attempt: 1,
      looping: false,
    },
    createdAt: '2026-10-11T12:28:00Z',
    scheduledFor: null,
    spec: {
      mode: 'single',
      goal: 'Add OAuth login (Google + GitHub) to api-server with tests and docs.',
      repoPath: '~/code/api-server',
      checks: [
        { kind: 'command', run: 'npm test' },
        { kind: 'command', run: 'npm run lint' },
      ],
      onLimit: 'switch-account',
      orchestrator: { agent: 'claude', account: 'claude-personal' as AccountId },
      workers: ['claude', 'codex', 'gemini', 'agy', 'opencode'],
    },
  },
  // Prototype jobsDef[1] (j-08)
  {
    id: 'j-08' as JobId,
    title: 'Fix flaky tests',
    status: 'waiting_quota',
    step: {
      name: 'Verify',
      index: 4,
      total: 5,
      attempt: 3,
      looping: true,
    },
    createdAt: '2026-10-10T18:00:00Z',
    scheduledFor: DEMO_RESET_AT,
    spec: {
      mode: 'single',
      goal: 'Fix flaky integration tests in test/auth',
      repoPath: '~/code/api-server',
      checks: [
        { kind: 'command', run: 'npm test' },
        { kind: 'command', run: 'npm run lint' },
      ],
      onLimit: 'switch-account',
      orchestrator: { agent: 'codex', account: 'codex-team' as AccountId },
      workers: ['codex', 'claude'],
    },
  },
  // Prototype jobsDef[2] (j-05)
  {
    id: 'j-05' as JobId,
    title: 'Upgrade to Node 22',
    status: 'done',
    step: null,
    createdAt: '2026-10-10T14:10:00Z',
    scheduledFor: null,
    spec: {
      mode: 'single',
      goal: 'Upgrade runtime to Node 22 and fix breaking changes',
      repoPath: '~/code/api-server',
      checks: [
        { kind: 'command', run: 'npm test' },
        { kind: 'command', run: 'npm run lint' },
      ],
      onLimit: 'switch-account',
      orchestrator: { agent: 'claude', account: 'claude-work' as AccountId },
      workers: ['claude'],
    },
  },
];

// ---------- runs (Prototype: R) ----------

export const DEMO_RUNS: readonly Run[] = [
  // Prototype R[0] (r-01)
  {
    id: 'r-01' as RunId,
    jobId: 'j-07' as JobId,
    parentId: null,
    depth: 0,
    role: 'orchestrator',
    task: 'Plan and coordinate OAuth login',
    agent: 'claude',
    accountId: 'claude-personal' as AccountId,
    status: 'running',
    worktree: null,
    readOnly: true,
    sessionId: 's-0f9d' as SessionId,
    startedAt: '2026-10-11T12:28:02Z',
    resumesAt: null,
  },
  // Prototype R[1] (r-02)
  {
    id: 'r-02' as RunId,
    jobId: 'j-07' as JobId,
    parentId: 'r-01' as RunId,
    depth: 1,
    role: 'implementer',
    task: 'Implement /auth/callback',
    agent: 'claude',
    accountId: 'claude-personal' as AccountId,
    status: 'running',
    worktree: 'orch/r-02' as WorktreeId,
    readOnly: false,
    sessionId: 's-7a1c' as SessionId,
    startedAt: '2026-10-11T12:41:02Z',
    resumesAt: null,
  },
  // Prototype R[2] (r-03)
  {
    id: 'r-03' as RunId,
    jobId: 'j-07' as JobId,
    parentId: 'r-01' as RunId,
    depth: 1,
    role: 'reviewer',
    task: 'Security review of token storage',
    agent: 'gemini',
    accountId: 'gemini-google' as AccountId,
    status: 'done',
    worktree: null,
    readOnly: true,
    sessionId: 's-c410' as SessionId,
    startedAt: '2026-10-11T12:29:10Z',
    resumesAt: null,
  },
  // Prototype R[3] (r-04)
  {
    id: 'r-04' as RunId,
    jobId: 'j-07' as JobId,
    parentId: 'r-01' as RunId,
    depth: 1,
    role: 'implementer',
    task: 'Refactor session middleware',
    agent: 'codex',
    accountId: 'codex-personal' as AccountId,
    status: 'paused_limit', // prototype: 'paused'
    worktree: 'orch/r-04' as WorktreeId,
    readOnly: false,
    sessionId: 's-91e0' as SessionId,
    startedAt: '2026-10-11T12:31:44Z',
    resumesAt: DEMO_RESET_AT,
  },
  // Prototype R[4] (r-05)
  {
    id: 'r-05' as RunId,
    jobId: 'j-07' as JobId,
    parentId: 'r-02' as RunId,
    depth: 2,
    role: 'tester',
    task: 'Integration tests for callback flow',
    agent: 'codex',
    accountId: 'codex-team' as AccountId,
    status: 'running',
    worktree: 'orch/r-05' as WorktreeId,
    readOnly: false,
    sessionId: 's-3b22' as SessionId,
    startedAt: '2026-10-11T12:46:13Z',
    resumesAt: null,
  },
  // Prototype R[5] (r-06)
  {
    id: 'r-06' as RunId,
    jobId: 'j-07' as JobId,
    parentId: 'r-01' as RunId,
    depth: 1,
    role: 'writer',
    task: 'Update API docs for /auth',
    agent: 'agy',
    accountId: 'agy-main' as AccountId,
    status: 'queued',
    worktree: null,
    readOnly: false,
    sessionId: null,
    startedAt: null,
    resumesAt: null,
  },
];

// ---------- run lines (Prototype: LN) ----------

const demoRunLines: Readonly<Record<string, readonly RunLine[]>> = {
  // Prototype LN['r-01']
  'r-01': [
    { runId: 'r-01' as RunId, seq: 0, at: '2026-10-11T12:28:02Z', kind: 'meta', text: 'session s-0f9d · claude@personal · read-only' },
    { runId: 'r-01' as RunId, seq: 1, at: '2026-10-11T12:28:02Z', kind: 'prompt', text: 'Add OAuth login (Google + GitHub) to api-server with tests and docs.' },
    { runId: 'r-01' as RunId, seq: 2, at: '2026-10-11T12:28:40Z', kind: 'message', text: 'Plan: callback + PKCE, token storage review, middleware refactor, tests, docs. Saved to the job plan.' },
    { runId: 'r-01' as RunId, seq: 3, at: '2026-10-11T12:29:02Z', kind: 'spawn', text: 'r-02 Implement /auth/callback → claude@personal' },
    { runId: 'r-01' as RunId, seq: 4, at: '2026-10-11T12:29:04Z', kind: 'spawn', text: 'r-03 Security review → gemini@google (read-only)' },
    { runId: 'r-01' as RunId, seq: 5, at: '2026-10-11T12:31:40Z', kind: 'spawn', text: 'r-04 Refactor session middleware → codex@personal' },
    { runId: 'r-01' as RunId, seq: 6, at: '2026-10-11T12:32:21Z', kind: 'message', text: 'r-03 flagged refresh tokens stored unencrypted. Folding that into r-04.' },
    { runId: 'r-01' as RunId, seq: 7, at: '2026-10-11T12:46:12Z', kind: 'limit', text: 'codex@personal limited until 15:00 — r-05 routed to codex@team' },
    { runId: 'r-01' as RunId, seq: 8, at: '2026-10-11T12:46:13Z', kind: 'spawn', text: 'r-05 Integration tests → codex@team' },
  ],
  // Prototype LN['r-02']
  'r-02': [
    { runId: 'r-02' as RunId, seq: 0, at: '2026-10-11T12:41:02Z', kind: 'meta', text: 'session s-7a1c · claude@personal · worktree orch/r-02' },
    { runId: 'r-02' as RunId, seq: 1, at: '2026-10-11T12:41:02Z', kind: 'prompt', text: 'Implement /auth/callback with state + PKCE validation. Keep changes inside src/auth.' },
    { runId: 'r-02' as RunId, seq: 2, at: '2026-10-11T12:41:05Z', kind: 'tool', text: 'Read src/auth/routes.ts' },
    { runId: 'r-02' as RunId, seq: 3, at: '2026-10-11T12:41:09Z', kind: 'tool', text: 'Read src/auth/session.ts' },
    { runId: 'r-02' as RunId, seq: 4, at: '2026-10-11T12:41:20Z', kind: 'message', text: 'The callback has to check state before the token exchange. Adding a PKCE verifier lookup.' },
    { runId: 'r-02' as RunId, seq: 5, at: '2026-10-11T12:42:47Z', kind: 'tool', text: 'Edit src/auth/callback.ts' },
    { runId: 'r-02' as RunId, seq: 6, at: '2026-10-11T12:42:48Z', kind: 'diff_add', text: '+ const verifier = await pkceStore.take(state)' },
    { runId: 'r-02' as RunId, seq: 7, at: '2026-10-11T12:42:49Z', kind: 'diff_add', text: "+ if (!verifier) return res.status(400).json({ error: 'invalid_state' })" },
    { runId: 'r-02' as RunId, seq: 8, at: '2026-10-11T12:42:50Z', kind: 'diff_del', text: '- const tokens = await exchange(code)' },
    { runId: 'r-02' as RunId, seq: 9, at: '2026-10-11T12:42:51Z', kind: 'diff_add', text: '+ const tokens = await exchange(code, verifier)' },
    { runId: 'r-02' as RunId, seq: 10, at: '2026-10-11T12:44:10Z', kind: 'tool', text: 'Bash npm test -- auth' },
    { runId: 'r-02' as RunId, seq: 11, at: '2026-10-11T12:44:31Z', kind: 'ok', text: '14 passed · 0 failed' },
    { runId: 'r-02' as RunId, seq: 12, at: '2026-10-11T12:44:40Z', kind: 'message', text: 'Callback is done. Waiting on review notes before touching token storage.' },
  ],
  // Prototype LN['r-03']
  'r-03': [
    { runId: 'r-03' as RunId, seq: 0, at: '2026-10-11T12:29:10Z', kind: 'meta', text: 'session s-c410 · gemini@google · read-only' },
    { runId: 'r-03' as RunId, seq: 1, at: '2026-10-11T12:29:10Z', kind: 'prompt', text: 'Review how tokens are stored. Report risks, do not edit.' },
    { runId: 'r-03' as RunId, seq: 2, at: '2026-10-11T12:30:02Z', kind: 'tool', text: 'Read src/auth/** (14 files)' },
    { runId: 'r-03' as RunId, seq: 3, at: '2026-10-11T12:31:55Z', kind: 'message', text: 'Refresh tokens are stored unencrypted in the sessions table. Recommend encryption at rest and rotation on use.' },
    { runId: 'r-03' as RunId, seq: 4, at: '2026-10-11T12:32:20Z', kind: 'ok', text: 'Finished · summary sent to r-01' },
  ],
  // Prototype LN['r-04']
  'r-04': [
    { runId: 'r-04' as RunId, seq: 0, at: '2026-10-11T12:31:44Z', kind: 'meta', text: 'session s-91e0 · codex@personal · worktree orch/r-04' },
    { runId: 'r-04' as RunId, seq: 1, at: '2026-10-11T12:31:44Z', kind: 'prompt', text: 'Refactor session middleware to use the new token store, and encrypt refresh tokens.' },
    { runId: 'r-04' as RunId, seq: 2, at: '2026-10-11T12:33:10Z', kind: 'tool', text: 'Read src/auth/session.ts' },
    { runId: 'r-04' as RunId, seq: 3, at: '2026-10-11T12:38:02Z', kind: 'tool', text: 'Edit src/auth/session.ts' },
    { runId: 'r-04' as RunId, seq: 4, at: '2026-10-11T12:38:03Z', kind: 'diff_add', text: '+ const store = new EncryptedTokenStore(kms)' },
    { runId: 'r-04' as RunId, seq: 5, at: '2026-10-11T12:38:04Z', kind: 'diff_del', text: '- db.sessions.insert({ refreshToken })' },
    { runId: 'r-04' as RunId, seq: 6, at: '2026-10-11T12:46:12Z', kind: 'limit', text: 'Usage limit reached · resets 15:00' },
    { runId: 'r-04' as RunId, seq: 7, at: '2026-10-11T12:46:12Z', kind: 'meta', text: 'orch: paused · worktree, transcript and CLI session saved' },
  ],
  // Prototype LN['r-05']
  'r-05': [
    { runId: 'r-05' as RunId, seq: 0, at: '2026-10-11T12:46:13Z', kind: 'meta', text: 'session s-3b22 · codex@team · worktree orch/r-05 · rerouted from codex@personal' },
    { runId: 'r-05' as RunId, seq: 1, at: '2026-10-11T12:46:13Z', kind: 'prompt', text: 'Write integration tests for the OAuth callback flow.' },
    { runId: 'r-05' as RunId, seq: 2, at: '2026-10-11T12:47:58Z', kind: 'tool', text: 'Write test/auth/callback.test.ts' },
    { runId: 'r-05' as RunId, seq: 3, at: '2026-10-11T12:47:59Z', kind: 'diff_add', text: "+ it('rejects an unknown state', async () => {" },
    { runId: 'r-05' as RunId, seq: 4, at: '2026-10-11T12:49:30Z', kind: 'tool', text: 'Bash npm test -- callback' },
    { runId: 'r-05' as RunId, seq: 5, at: '2026-10-11T12:49:52Z', kind: 'err', text: '1 failed: expected 400, received 500' },
    { runId: 'r-05' as RunId, seq: 6, at: '2026-10-11T12:50:05Z', kind: 'message', text: 'pkceStore is not mocked in the test setup. Adding a test double.' },
  ],
  // Prototype LN['r-06']
  'r-06': [
    { runId: 'r-06' as RunId, seq: 0, at: '2026-10-11T12:50:00Z', kind: 'meta', text: 'Not started · waits for r-02 to finish' },
    { runId: 'r-06' as RunId, seq: 1, at: '2026-10-11T12:50:00Z', kind: 'meta', text: 'Will run on agy@main (estimated capacity)' },
  ],
};

/** Keep the prototype's wall-clock times stable in every local timezone. */
export const DEMO_RUN_LINES: Readonly<Record<string, readonly RunLine[]>> = Object.fromEntries(
  Object.entries(demoRunLines).map(([runId, lines]) => [
    runId,
    lines.map((line) => ({ ...line, at: demoLocalClock(line.at) })),
  ]),
);

// ---------- sessions (Prototype: SS, STOP) ----------

export const DEMO_SESSIONS: readonly Session[] = [
  // Prototype SS[0] (s-0f9d)
  {
    id: 's-0f9d' as SessionId,
    jobId: 'j-07' as JobId,
    runId: 'r-01' as RunId,
    title: 'Plan and coordinate OAuth login',
    agent: 'claude',
    accountId: 'claude-personal' as AccountId,
    cliSessionId: '4c1e09a2',
    status: 'live',
    worktree: null,
    startedAt: '2026-10-11T12:28:00Z',
    lastActivityAt: '2026-10-11T12:50:00Z',
    tokens: 182_000, // prototype: '182k'
    position: {
      step: 'Implement',
      index: 2,
      total: 5,
      attempt: 1,
    },
    handedOffTo: null,
    handedOffFrom: null,
  },
  // Prototype SS[1] (s-7a1c)
  {
    id: 's-7a1c' as SessionId,
    jobId: 'j-07' as JobId,
    runId: 'r-02' as RunId,
    title: 'Implement /auth/callback',
    agent: 'claude',
    accountId: 'claude-personal' as AccountId,
    cliSessionId: '7a1c0e03',
    status: 'live',
    worktree: 'orch/r-02' as WorktreeId,
    startedAt: '2026-10-11T12:41:00Z',
    lastActivityAt: '2026-10-11T12:50:00Z',
    tokens: 48_000, // prototype: '48k'
    position: {
      step: 'Implement',
      index: 2,
      total: 5,
      attempt: 1,
    },
    handedOffTo: null,
    handedOffFrom: null,
  },
  // Prototype SS[2] (s-91e0)
  {
    id: 's-91e0' as SessionId,
    jobId: 'j-07' as JobId,
    runId: 'r-04' as RunId,
    title: 'Refactor session middleware',
    agent: 'codex',
    accountId: 'codex-personal' as AccountId,
    cliSessionId: '91e00b47',
    status: 'paused',
    worktree: 'orch/r-04' as WorktreeId,
    startedAt: '2026-10-11T12:31:00Z',
    lastActivityAt: '2026-10-11T12:46:00Z',
    tokens: 61_000, // prototype: '61k'
    position: {
      step: 'Implement',
      index: 2,
      total: 5,
      attempt: 1,
      note: 'Paused when Codex · Personal hit its 5-hour limit. Worktree and transcript are saved.',
    },
    handedOffTo: null,
    handedOffFrom: null,
  },
  // Prototype SS[3] (s-3b22)
  {
    id: 's-3b22' as SessionId,
    jobId: 'j-07' as JobId,
    runId: 'r-05' as RunId,
    title: 'Integration tests for callback flow',
    agent: 'codex',
    accountId: 'codex-team' as AccountId,
    cliSessionId: '3b2201fd',
    status: 'live',
    worktree: 'orch/r-05' as WorktreeId,
    startedAt: '2026-10-11T12:46:00Z',
    lastActivityAt: '2026-10-11T12:50:00Z',
    tokens: 22_000, // prototype: '22k'
    position: {
      step: 'Implement',
      index: 2,
      total: 5,
      attempt: 1,
    },
    handedOffTo: null,
    handedOffFrom: null,
  },
  // Prototype SS[4] (s-c410)
  {
    id: 's-c410' as SessionId,
    jobId: 'j-07' as JobId,
    runId: 'r-03' as RunId,
    title: 'Security review of token storage',
    agent: 'gemini',
    accountId: 'gemini-google' as AccountId,
    cliSessionId: 'c410077a',
    status: 'ended',
    worktree: null,
    startedAt: '2026-10-11T12:29:00Z',
    lastActivityAt: '2026-10-11T12:32:00Z',
    tokens: 95_000, // prototype: '95k'
    position: {
      step: 'Triage',
      index: 1,
      total: 5,
      attempt: 1,
      note: 'finished its part',
    },
    handedOffTo: null,
    handedOffFrom: null,
  },
  // Prototype SS[5] (s-2d18)
  {
    id: 's-2d18' as SessionId,
    jobId: 'j-08' as JobId,
    runId: null,
    title: 'Stabilize callback retries (first attempt)',
    agent: 'codex',
    accountId: 'codex-team' as AccountId,
    cliSessionId: '2d180c90',
    status: 'interrupted', // prototype: 'orphaned'
    worktree: 'orch/j-08-a' as WorktreeId,
    startedAt: '2026-10-10T18:02:00Z',
    lastActivityAt: '2026-10-10T18:40:00Z',
    tokens: 73_000, // prototype: '73k'
    position: {
      step: 'Verify',
      index: 4,
      total: 5,
      attempt: 3,
      note: 'The agent process stopped when orchd restarted. Transcript and worktree are intact, so it can pick up where it left off.',
    },
    handedOffTo: null,
    handedOffFrom: null,
  },
  // Prototype SS[6] (s-e57a)
  {
    id: 's-e57a' as SessionId,
    jobId: 'j-05' as JobId,
    runId: null,
    title: 'Upgrade runtime and fix breaking changes',
    agent: 'claude',
    accountId: 'claude-work' as AccountId,
    cliSessionId: 'e57a041b',
    status: 'ended',
    worktree: null,
    startedAt: '2026-10-10T14:10:00Z',
    lastActivityAt: '2026-10-10T15:02:00Z',
    tokens: 240_000, // prototype: '240k'
    position: {
      step: 'Finished all 5 steps',
      index: 5,
      total: 5,
      attempt: 1,
      note: 'Its worktree was cleaned up after merge. Resuming recreates it from the merged branch.',
    },
    handedOffTo: null,
    handedOffFrom: null,
  },
];

// ---------- worktree reviews (Prototype: WT) ----------

export const DEMO_REVIEWS: readonly WorktreeReview[] = [
  // Prototype WT[0] (orch/r-02)
  {
    worktree: 'orch/r-02' as WorktreeId,
    jobId: 'j-07' as JobId,
    runId: 'r-02' as RunId,
    sessionId: 's-7a1c' as SessionId,
    title: 'Implement /auth/callback',
    state: 'ready',
    verdict: 'verified',
    checks: [
      { check: { kind: 'command', run: 'npm test' }, status: 'passed', summary: 'Tests · 14 passed' },
      { check: { kind: 'command', run: 'npm run lint' }, status: 'passed', summary: 'Lint' },
      { check: { kind: 'file_rule', allow: ['src/auth/**'] }, status: 'passed', summary: 'Scope · src/auth only' },
    ],
    files: [
      { path: 'src/auth/callback.ts', added: 64, removed: 3 },
      { path: 'src/auth/pkce.ts', added: 41, removed: 0 },
    ],
    evidenceRef: 'ev-r-02',
    note: 'The agent marked this task done. Its session stays open for follow-ups.',
  },
  // Prototype WT[1] (orch/r-05)
  {
    worktree: 'orch/r-05' as WorktreeId,
    jobId: 'j-07' as JobId,
    runId: 'r-05' as RunId,
    sessionId: 's-3b22' as SessionId,
    title: 'Integration tests for callback flow',
    state: 'failing',
    verdict: 'refuted',
    checks: [
      { check: { kind: 'command', run: 'npm test' }, status: 'failed', summary: 'Tests · 1 failing' },
      { check: { kind: 'command', run: 'npm run lint' }, status: 'passed', summary: 'Lint' },
      { check: { kind: 'file_rule', allow: ['test/**'] }, status: 'passed', summary: 'Scope · test/ only' },
    ],
    files: [
      { path: 'test/auth/callback.test.ts', added: 88, removed: 0 },
    ],
    evidenceRef: 'ev-r-05',
    note: 'Can’t merge while a check fails. The agent is fixing it now.',
  },
  // Prototype WT[2] (orch/r-04)
  {
    worktree: 'orch/r-04' as WorktreeId,
    jobId: 'j-07' as JobId,
    runId: 'r-04' as RunId,
    sessionId: 's-91e0' as SessionId,
    title: 'Refactor session middleware',
    state: 'paused',
    verdict: 'unverified',
    checks: [
      { check: { kind: 'command', run: 'npm test' }, status: 'not_run', summary: 'Tests · not run yet' },
      { check: { kind: 'command', run: 'npm run lint' }, status: 'passed', summary: 'Lint' },
      { check: { kind: 'file_rule', allow: ['src/auth/**'] }, status: 'passed', summary: 'Scope · src/auth only' },
    ],
    files: [
      { path: 'src/auth/session.ts', added: 12, removed: 18 },
    ],
    evidenceRef: null,
    note: 'Work stopped at an account limit. Pick it back up from Sessions.',
  },
  // Prototype WT[3] (orch/j-08-a)
  {
    worktree: 'orch/j-08-a' as WorktreeId,
    jobId: 'j-08' as JobId,
    runId: null,
    sessionId: 's-2d18' as SessionId,
    title: 'Stabilize callback retries',
    state: 'interrupted',
    verdict: 'unverified',
    checks: [
      { check: { kind: 'command', run: 'npm test' }, status: 'not_run', summary: 'Tests · not run' },
      { check: { kind: 'command', run: 'npm run lint' }, status: 'passed', summary: 'Lint' },
      { check: { kind: 'file_rule', allow: ['src/auth/**'] }, status: 'passed', summary: 'Scope · src/auth only' },
    ],
    files: [
      { path: 'src/auth/retry.ts', added: 41, removed: 9 },
    ],
    evidenceRef: null,
    note: 'The agent process stopped when orchd restarted. Resume it from Sessions to finish.',
  },
];

// ---------- diffs (Prototype: DIFFS) ----------

export const DEMO_DIFFS: Readonly<Record<string, { before: string; after: string }>> = {
  // Prototype DIFFS['src/auth/callback.ts']
  'src/auth/callback.ts': {
    before: `export async function callback(req, res) {
  const { code, state } = req.query
  const tokens = await exchange(code)
  await sessions.create(res, tokens)
}`,
    after: `export async function callback(req, res) {
  const { code, state } = req.query
  const verifier = await pkceStore.take(state)
  if (!verifier) {
    return res.status(400).json({ error: 'invalid_state' })
  }
  const tokens = await exchange(code, verifier)
  await sessions.create(res, tokens)
}`,
  },
  // Prototype DIFFS['src/auth/pkce.ts']
  'src/auth/pkce.ts': {
    before: '',
    after: `import { randomBytes, createHash } from 'node:crypto'

export function createVerifier() {
  return randomBytes(32).toString('base64url')
}`,
  },
  // Prototype DIFFS['test/auth/callback.test.ts']
  'test/auth/callback.test.ts': {
    before: '',
    after: `describe('GET /auth/callback', () => {
  it('rejects an unknown state', async () => {
    const res = await get('/auth/callback?state=nope&code=x')
    expect(res.status).toBe(400)
  })
})`,
  },
  // Prototype DIFFS['src/auth/session.ts']
  'src/auth/session.ts': {
    before: `db.sessions.insert({ refreshToken })`,
    after: `const store = new EncryptedTokenStore(kms)
await store.save(userId, refreshToken)`,
  },
  // Prototype DIFFS['src/auth/retry.ts']
  'src/auth/retry.ts': {
    before: `return fn()`,
    after: `export async function withBackoff(fn, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { return await fn() } catch (e) { await sleep(2 ** i * 100) }
  }
}`,
  },
};

// ---------- trust summaries (Prototype: TR, TRA, LAYCOUNT, gardenFinds) ----------

const demoAgentTracks = [
  // Prototype TRA.claude: { lvl: 2, rate: 88 }
  {
    agent: 'claude' as AgentId,
    runs: 24,
    firstTryVerifiedPct: 88,
    humanFixPct: 8,
    level: 2 as const,
    eligibleFor: 3 as const, // rate 88 >= 85 (NEED[3])
  },
  // Prototype TRA.codex: { lvl: 2, rate: 81 }
  {
    agent: 'codex' as AgentId,
    runs: 21,
    firstTryVerifiedPct: 81,
    humanFixPct: 12,
    level: 2 as const,
    eligibleFor: null,
  },
  // Prototype TRA.agy: { lvl: 1, rate: 58 }
  {
    agent: 'agy' as AgentId,
    runs: 20,
    firstTryVerifiedPct: 58,
    humanFixPct: 25,
    level: 1 as const,
    eligibleFor: null,
  },
  // Prototype TRA.gemini: { lvl: 2, rate: 74 }
  {
    agent: 'gemini' as AgentId,
    runs: 20,
    firstTryVerifiedPct: 74,
    humanFixPct: 16,
    level: 2 as const,
    eligibleFor: null,
  },
  // Prototype TRA.opencode: { lvl: 1, rate: 66 }
  {
    agent: 'opencode' as AgentId,
    runs: 20,
    firstTryVerifiedPct: 66,
    humanFixPct: 20,
    level: 1 as const,
    eligibleFor: null,
  },
];

const demoGardenFindings = [
  { text: 'A retry-with-sleep workaround from r-05 was copied into 2 other tests.', at: '2026-10-05T09:00:00Z' },
  { text: '3 new “eslint-disable” comments in src/auth since the last run.', at: '2026-10-05T09:00:00Z' },
];

export const DEMO_TRUST_SUMMARY_7: TrustSummary = {
  periodDays: 7,
  firstTryVerifiedPct: 76,
  humanFixPct: 15,
  refutedCount: 3,
  correctionsMovedUp: { moved: 4, total: 5 },
  correctionsByLayer: {
    codebase: 1,
    lint: 3,
    agent_rule: 0,
    review_note: 1,
  },
  agents: demoAgentTracks,
  gardener: {
    on: true,
    nextRunAt: '2026-10-12T09:00:00Z',
    findings: demoGardenFindings,
  },
};

export const DEMO_TRUST_SUMMARY_30: TrustSummary = {
  periodDays: 30,
  firstTryVerifiedPct: 72,
  humanFixPct: 18,
  refutedCount: 9,
  correctionsMovedUp: { moved: 11, total: 14 },
  correctionsByLayer: {
    codebase: 3,
    lint: 8,
    agent_rule: 1,
    review_note: 2,
  },
  agents: demoAgentTracks,
  gardener: {
    on: true,
    nextRunAt: '2026-10-12T09:00:00Z',
    findings: demoGardenFindings,
  },
};

// ---------- spec queue (Prototype: SPECS) ----------

const demoGroupedSpec = (number: number, state: 'merged' | 'queued', position: number): SpecRun => {
  const id = String(number) as SpecId;
  return {
    id,
    queueId: 'q-specs' as QueueId,
    position,
    file: `docs/stories/${id}-story.md`,
    spec: {
      id,
      title: `Story ${id}`,
      depends_on: state === 'queued' && number > 48 ? [String(number - 1)] : [],
      scope: ['docs/**'],
      done_when: [{ by: 'check', text: 'Story is complete', check: { kind: 'command', run: 'npm test' } }],
      agent: 'auto',
    },
    state,
    attempt: state === 'merged' ? 1 : null,
    jobId: null,
    worktree: null,
    implementer: null,
    criteria: [],
    blockedBy: state === 'queued' && number > 48 ? [String(number - 1) as SpecId] : [],
    startedAt: state === 'merged' ? '2026-10-10T12:00:00Z' : null,
    finishedAt: state === 'merged' ? '2026-10-10T12:08:00Z' : null,
    tokens: 0,
    history: [],
  };
};

const demoMergedSpecs = Array.from({ length: 38 }, (_, index) => demoGroupedSpec(index + 1, 'merged', index + 1));
const demoQueuedSpecs = Array.from({ length: 17 }, (_, index) => demoGroupedSpec(index + 48, 'queued', index + 48));

export const DEMO_SPEC_QUEUE: SpecQueue = {
  id: 'q-specs' as QueueId,
  repoPath: '~/code/api-server',
  settings: {
    source: 'docs/stories (epic 3 · Auth)',
    order: 'waves',
    advance: 'verified',
    on_fail: 'retry-stop',
    max_parallel: 2,
    retries: 2,
    after_each: [{ name: 'Timed e2e and smoke gates', run: 'shell', timeout_s: 30 }],
  },
  paused: false,
  createdAt: '2026-10-11T10:00:00Z',
  specs: [
    ...demoMergedSpecs,
    ...([
    // Prototype SPECS[0] (39)
    {
      id: '39' as SpecId,
      queueId: 'q-specs' as QueueId,
      position: 39,
      file: 'docs/specs/spec-39.md',
      spec: {
        id: '39',
        title: 'Rate limiter for /login',
        depends_on: ['38'],
        scope: ['src/auth/limit*'],
        done_when: Array.from({ length: 5 }, (_, index) => ({ by: 'check' as const, text: `Criterion ${index + 1}`, check: { kind: 'command' as const, run: 'npm test' } })),
        agent: 'claude',
      },
      state: 'merged',
      attempt: 1,
      jobId: 'j-05' as JobId,
      worktree: null,
      implementer: { agent: 'claude', accountId: 'claude-personal' as AccountId },
      criteria: Array.from({ length: 5 }, (_, index) => ({ index, state: 'met' as const, summary: 'Criterion met', auditor: null })),
      blockedBy: [],
      startedAt: '2026-10-10T12:00:00Z',
      finishedAt: '2026-10-10T12:06:00Z',
      tokens: 84_000,
      history: [],
    },
    // Prototype SPECS[1] (40)
    {
      id: '40' as SpecId,
      queueId: 'q-specs' as QueueId,
      position: 40,
      file: 'docs/specs/spec-40.md',
      spec: {
        id: '40',
        title: 'Rotate session cookies on login',
        depends_on: ['39'],
        scope: ['src/auth/session*'],
        done_when: Array.from({ length: 4 }, (_, index) => ({ by: 'check' as const, text: `Criterion ${index + 1}`, check: { kind: 'command' as const, run: 'npm test' } })),
        agent: 'codex',
      },
      state: 'merged',
      attempt: 1,
      jobId: 'j-05' as JobId,
      worktree: null,
      implementer: { agent: 'codex', accountId: 'codex-team' as AccountId },
      criteria: Array.from({ length: 4 }, (_, index) => ({ index, state: 'met' as const, summary: 'Criterion met', auditor: null })),
      blockedBy: [],
      startedAt: '2026-10-10T13:00:00Z',
      finishedAt: '2026-10-10T13:09:00Z',
      tokens: 120_000,
      history: [],
    },
    // Prototype SPECS[2] (41)
    {
      id: '41' as SpecId,
      queueId: 'q-specs' as QueueId,
      position: 41,
      file: 'docs/specs/spec-41.md',
      spec: {
        id: '41',
        title: 'OAuth state and PKCE validation',
        depends_on: ['40'],
        scope: ['src/auth/callback.ts', 'src/auth/pkce.ts'],
        done_when: Array.from({ length: 6 }, (_, index) => ({ by: 'check' as const, text: `Criterion ${index + 1}`, check: { kind: 'command' as const, run: 'npm test' } })),
        agent: 'claude',
      },
      state: 'verified',
      attempt: 1,
      jobId: 'j-07' as JobId,
      worktree: 'orch/r-02' as WorktreeId,
      implementer: { agent: 'claude', accountId: 'claude-personal' as AccountId },
      criteria: Array.from({ length: 6 }, (_, index) => ({ index, state: 'met' as const, summary: 'Criterion met', auditor: null })),
      blockedBy: [],
      startedAt: '2026-10-11T12:00:00Z',
      finishedAt: '2026-10-11T12:12:00Z',
      tokens: 161_000,
      history: [],
    },
    // Prototype SPECS[3] (42)
    {
      id: '42' as SpecId,
      queueId: 'q-specs' as QueueId,
      position: 42,
      file: 'docs/specs/spec-42.md',
      spec: {
        id: '42',
        title: 'Integration tests for the callback flow',
        depends_on: ['41'],
        scope: ['test/auth/**'],
        done_when: [
          { by: 'check', text: 'Unknown state returns 400 with error invalid_state', check: { kind: 'command', run: 'npm test' } },
          { by: 'check', text: 'PKCE verifier can only be used once', check: { kind: 'command', run: 'npm test' } },
          { by: 'check', text: 'All tests under test/auth pass three runs in a row', check: { kind: 'command', run: 'npm run flaky-check' } },
          { by: 'check', text: 'No new lint or type suppressions', check: { kind: 'guardrail', rule: 'no_new_suppressions' } },
          { by: 'audit', text: 'Error codes match docs/api/errors.md' },
        ],
        agent: 'codex',
      },
      state: 'running',
      attempt: 2,
      jobId: 'j-07' as JobId,
      worktree: 'orch/r-05' as WorktreeId,
      implementer: { agent: 'codex', accountId: 'codex-team' as AccountId },
      criteria: [
        { index: 0, state: 'met', summary: 'npm test passed', auditor: null },
        { index: 1, state: 'met', summary: 'npm test passed', auditor: null },
        { index: 2, state: 'running', summary: 'flaky-check running', auditor: null },
        { index: 3, state: 'met', summary: 'Guardrail met', auditor: null },
        { index: 4, state: 'pending', summary: null, auditor: { agent: 'gemini', accountId: 'gemini-google' as AccountId, sameAgent: false } },
      ],
      blockedBy: [],
      startedAt: seenMinutesAgo(4),
      finishedAt: null,
      tokens: 61_000,
      history: [],
    },
    // Prototype SPECS[4] (43)
    {
      id: '43' as SpecId,
      queueId: 'q-specs' as QueueId,
      position: 43,
      file: 'docs/specs/spec-43.md',
      spec: {
        id: '43',
        title: 'GitHub as a second sign-in provider',
        depends_on: ['41'],
        scope: ['src/auth/providers/github.ts'],
        done_when: Array.from({ length: 6 }, (_, index) => ({ by: 'check' as const, text: `Criterion ${index + 1}`, check: { kind: 'command' as const, run: 'npm test' } })),
        agent: 'claude',
      },
      state: 'running',
      attempt: 1,
      jobId: 'j-07' as JobId,
      worktree: null,
      implementer: { agent: 'claude', accountId: 'claude-work' as AccountId },
      criteria: Array.from({ length: 6 }, (_, index) => ({ index, state: index === 0 ? 'met' as const : 'pending' as const, summary: index === 0 ? 'Criterion met' : null, auditor: null })),
      blockedBy: [],
      startedAt: seenMinutesAgo(2),
      finishedAt: null,
      tokens: 38_000,
      history: [],
    },
    // Prototype SPECS[5] (44)
    {
      id: '44' as SpecId,
      queueId: 'q-specs' as QueueId,
      position: 44,
      file: 'docs/specs/spec-44.md',
      spec: {
        id: '44',
        title: 'Encrypt refresh tokens at rest',
        depends_on: ['42'],
        scope: ['src/auth/store.ts'],
        done_when: Array.from({ length: 5 }, (_, index) => ({ by: 'check' as const, text: `Criterion ${index + 1}`, check: { kind: 'command' as const, run: 'npm test' } })),
        agent: 'auto',
      },
      state: 'queued',
      attempt: null,
      jobId: null,
      worktree: null,
      implementer: null,
      criteria: [],
      blockedBy: ['42' as SpecId],
      startedAt: null,
      finishedAt: null,
      tokens: 0,
      history: [],
    },
    // Prototype SPECS[6] (45)
    {
      id: '45' as SpecId,
      queueId: 'q-specs' as QueueId,
      position: 45,
      file: 'docs/specs/spec-45.md',
      spec: {
        id: '45',
        title: 'Admin audit log for sign-ins',
        depends_on: ['40'],
        scope: ['src/admin/audit*'],
        done_when: [
          { by: 'check', text: 'Each sign-in writes one audit row', check: { kind: 'command', run: 'npm test' } },
          { by: 'check', text: 'No new lint or type suppressions', check: { kind: 'guardrail', rule: 'no_new_suppressions' } },
          { by: 'check', text: 'Audit rows never contain tokens or emails', check: { kind: 'command', run: 'npm test' } },
          { by: 'audit', text: 'Retention matches docs/policies/retention.md' },
        ],
        agent: 'gemini',
      },
      state: 'needs_you',
      attempt: 3,
      jobId: 'j-08' as JobId,
      worktree: null,
      implementer: { agent: 'gemini', accountId: 'gemini-google' as AccountId },
      criteria: [
        { index: 0, state: 'met', summary: 'npm test passed', auditor: null },
        { index: 1, state: 'met', summary: 'guardrail met', auditor: null },
        { index: 2, state: 'not_met', summary: '3 of 3 runs failed', auditor: null },
        { index: 3, state: 'pending', summary: null, auditor: null },
      ],
      blockedBy: [],
      startedAt: '2026-10-10T17:00:00Z',
      finishedAt: '2026-10-10T17:31:00Z',
      tokens: 402_000,
      history: [],
    },
    // Prototype SPECS[7] (46)
    {
      id: '46' as SpecId,
      queueId: 'q-specs' as QueueId,
      position: 46,
      file: 'docs/specs/spec-46.md',
      spec: {
        id: '46',
        title: 'Docs for the /auth endpoints',
        depends_on: ['41', '43'],
        scope: ['docs/api/auth.md'],
        done_when: Array.from({ length: 3 }, (_, index) => ({ by: 'check' as const, text: `Criterion ${index + 1}`, check: { kind: 'file_rule' as const, allow: ['docs/api/auth.md'] } })),
        agent: 'auto',
      },
      state: 'queued',
      attempt: null,
      jobId: null,
      worktree: null,
      implementer: null,
      criteria: [],
      blockedBy: ['41' as SpecId, '43' as SpecId],
      startedAt: null,
      finishedAt: null,
      tokens: 0,
      history: [],
    },
    // Prototype SPECS[8] (47)
    {
      id: '47' as SpecId,
      queueId: 'q-specs' as QueueId,
      position: 47,
      file: 'docs/specs/spec-47.md',
      spec: {
        id: '47',
        title: 'Sign-out everywhere',
        depends_on: ['44'],
        scope: ['src/auth/session*'],
        done_when: Array.from({ length: 4 }, (_, index) => ({ by: 'check' as const, text: `Criterion ${index + 1}`, check: { kind: 'command' as const, run: 'npm test' } })),
        agent: 'auto',
      },
      state: 'queued',
      attempt: null,
      jobId: null,
      worktree: null,
      implementer: null,
      criteria: [],
      blockedBy: ['44' as SpecId],
      startedAt: null,
      finishedAt: null,
      tokens: 0,
      history: [],
    },
    ] satisfies SpecRun[]),
    ...demoQueuedSpecs,
  ],
};

// ---------- doctor report (Prototype: lines 2489-2490) ----------

export function createDemoDoctorReport(os: Os = 'macos'): DoctorReport {
  return {
    os,
    orchVersion: 'demo',
    engineVersion: '7.5.6',
    checks: [
      { id: 'cli_claude', title: 'Claude Code installed', status: 'pass', agent: 'claude' },
      { id: 'cli_codex', title: 'Codex installed', status: 'pass', agent: 'codex' },
      { id: 'cli_gemini', title: 'Gemini CLI installed', status: 'pass', agent: 'gemini' },
      { id: 'cli_opencode', title: 'OpenCode installed', status: 'pass', agent: 'opencode' },
      { id: 'cli_agy', title: 'Antigravity installed', status: 'pass', agent: 'agy' },
      { id: 'node_version', title: 'Node.js 22 LTS', status: 'pass' },
      { id: 'git_version', title: 'Git version supported', status: 'pass' },
      { id: 'isolation_check', title: 'Separate logins confirmed across all agent accounts', status: 'pass' },
      { id: 'skills_sharing', title: 'Shared skills linked into profile folders', status: 'pass' },
      { id: 'disk_space', title: 'Sufficient free disk space', status: 'pass' },
    ],
  };
}

// ---------- accounts.yaml (Prototype: yamlRaw, lines 2260-2273) ----------

export const DEMO_ACCOUNTS_YAML_TEXT = `# Everything orch needs. Folders, logins and env vars are handled for you.

routing: primary-first     # or: most-headroom

accounts:
  claude:
    personal: { primary: true }
    work: {}
  codex:
    personal: { primary: true }
    team: {}
  agy:
    main: { primary: true }
    alt: {}   # not signed in yet
  gemini:
    google: { primary: true }
  opencode:
    main: { primary: true }

limits:
  max_runs_per_account: 3
  near_limit_at: 85%

share_skills: true    # each agent’s own skills folder is linked into all its accounts
`.trimEnd();

export const DEMO_ACCOUNTS_FILE: AccountsFile = {
  routing: 'primary-first',
  accounts: {
    claude: {
      personal: { primary: true },
      work: {},
    },
    codex: {
      personal: { primary: true },
      team: {},
    },
    agy: {
      main: { primary: true },
      alt: {},
    },
    gemini: {
      google: { primary: true },
    },
    opencode: {
      main: { primary: true },
    },
  },
  limits: {
    max_runs_per_account: 3,
    near_limit_at: '85%',
  },
  share_skills: true,
};
