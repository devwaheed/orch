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
    ariaLabel: 'Jobs',
    title: 'Jobs',
    newJobAria: 'New job',
    /** Hover text on the one-line step status under an open job. */
    stepsTitle: 'Steps: triage → implement → review → verify → repair if needed',
    hint: {
      title: 'Work',
      text: 'Open a run to watch it, message the agent, pause or stop it.',
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
} as const;
