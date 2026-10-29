/**
 * User-facing strings for the Work area (UI-07).
 * Word for word from design/screens.md ("Work") and design/prototype/Main.dc.html.
 *
 * OPEN QUESTIONS (no copy in the design yet; see the S2-05 report):
 * - run statuses `failed` and `stopped`, and job statuses `scheduled`, `waiting_quota`,
 *   `paused`, `failed`, `cancelled`: `unspecifiedStatus` shows the raw status word until
 *   the owner supplies copy.
 * - empty jobs list, loading, engine restarting and offline states.
 */

export const workStrings = {
  sidebar: {
    ariaLabel: 'Live',
    title: 'Live',
    filterAria: 'Filter jobs',
    newJobAria: 'New spec',
    notFromSpec: 'Not from a spec',
    doneMeta: 'done',
    /** Hover text on the one-line step status under an open job. */
    stepsTitle: 'Steps: triage → implement → review → verify → repair if needed',
    hint: {
      title: 'Live',
      text: 'Open a run to watch it, message the agent, pause or stop it.',
      /** The same card while starting a job (prototype view 'new'). */
      newJobText: 'Describe the goal, pick an orchestrator and who it may use.',
    },
  },

  step: {
    now: (name: string) => `Now: ${name}`,
    progress: (index: number, total: number) => `step ${index} of ${total}`,
    attempt: (attempt: number) => `try ${attempt}`,
  },

  status: {
    running: 'Running',
    done: 'Done',
    pausedLimit: 'Paused · limit',
    queued: 'Queued',
  },

  /** Placeholder for statuses without design copy. Shows the raw status word. */
  unspecifiedStatus: (status: string) => status,

  actions: {
    pause: 'Pause',
    stop: 'Stop',
    shell: 'Shell',
    review: 'Review',
    continue: 'Continue',
    startNow: 'Start now',
  },

  panes: {
    groupLabel: (n: number) => `Editor group ${n}`,
    emptyText: 'No run open. Pick one from Jobs on the left.',
    closeTab: (runId: string) => `Close ${runId}`,
    splitOpen: 'Split editor',
    splitClose: 'Close split',
    where: {
      readOnly: 'main (read-only)',
      notStarted: 'not started',
    },
    noSession: '—',
    working: 'working…',
  },

  message: {
    label: (runId: string) => `Message ${runId}`,
    sendAria: 'Send to agent',
    placeholderRunning: (agent: string, runId: string) => `Message ${agent} in ${runId}…`,
    placeholderPaused: 'Resume the session to send messages',
    placeholderDone: 'Session ended · use Continue to resume it',
    placeholderQueued: 'Starts when its dependency finishes',
  },

  planApproval: {
    title: 'Plan approval needed',
    description: 'The plan needs your approval before coding starts.',
    approve: 'Approve plan',
    reject: 'Ask for a new plan',
    approving: 'Approving…',
    rejecting: 'Asking…',
  },

  paused: {
    title: 'Paused by an account limit',
    /** screens.md Work / Main.dc.html pausedText; window and time are left out when unknown (lead-drafted fallback). */
    pausedText: (agent: string, account: string, window: string | null, at: string | null, session: string) =>
      `${agent} · ${account} hit its ${window ? `${window} ` : ''}limit${at ? ` at ${at}` : ''}. The worktree, transcript and CLI session ${session} are saved.`,
    autoText: (account: string, time: string | null) => `Otherwise continue this exact session on ${account}${time ? ` at ${time}` : ' when it resets'}`,
    resumeNowLabel: (agent: string, account: string) => `Resume now on ${agent} · ${account}`,
    moreOptions: 'More resume options',
    window: { per_minute: 'per-minute', '5h': '5-hour', daily: 'daily', weekly: 'weekly', monthly: 'monthly' },
  },

  specFix: {
    notMetYet: 'Not met yet',
    fixInTerminal: 'Fix in terminal',
    checkAgain: 'Check again',
    checking: 'Checking…',
  },
} as const;
