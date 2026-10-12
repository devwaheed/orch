/**
 * User-facing strings for the Sessions area (UI-07).
 * Word for word from design/screens.md ("Sessions") and design/prototype/Main.dc.html
 * (the Sessions markup and its state logic). The four resume option descriptions come
 * from the core (resumeOptions), not from this file.
 */

export const sessionsStrings = {
  title: 'Sessions',
  intro:
    'Every agent session orch has started, saved with its transcript, worktree and the CLI’s own session id.',

  filter: {
    group: 'Filter sessions',
    all: (count: number) => `All · ${count}`,
    resumable: (count: number) => `Resumable · ${count}`,
    live: (count: number) => `Live · ${count}`,
  },

  list: {
    label: 'Session list',
  },

  status: {
    live: 'Live',
    paused: 'Paused · limit',
    ended: 'Ended',
    interrupted: 'Interrupted',
  },

  details: {
    label: 'Session details',
    resume: 'Resume',
    lastActivity: 'Last activity',
    resumeOptions: 'Resume options',
    nowAt: 'Now at',
    stoppedAt: 'Stopped at',
    facts: {
      job: 'Job',
      agentAccount: 'Agent · account',
      worktree: 'Worktree',
      run: 'Run',
      started: 'Started',
      tokensUsed: 'Tokens used',
    },
    openInWorkspace: 'Open in workspace',
  },

  option: {
    same: 'Continue this session',
    account: 'Hand off to another account',
    agent: 'Hand off to another agent',
    fork: 'Fork into a new worktree',
  },

  button: {
    resumeSession: 'Resume session',
    schedule: (time: string) => `Schedule for ${time}`,
    resumeOn: (account: string) => `Resume on ${account}`,
    handOffTo: (agent: string) => `Hand off to ${agent}`,
    fork: 'Fork session',
  },

  time: {
    today: 'Today',
    yesterday: 'Yesterday',
    now: 'now',
    yesterdayShort: 'Yest.',
  },

  cli: {
    scheduledFor: (time: string) => `  # scheduled for ${time}`,
  },

  empty: '—',
  step: (step: string, index: number, total: number) => `${step} · step ${index} of ${total}`,
  tryAttempt: (attempt: number) => `, try ${attempt}`,
} as const;
