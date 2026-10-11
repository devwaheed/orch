/**
 * User-facing strings for the Review area (UI-07).
 * Word for word from design/screens.md ("Review") and design/prototype/Main.dc.html (the
 * Review markup and its sample data): the page title and intro, the state pills, the verdict
 * banner texts, the buttons and the note.
 *
 * The strings marked "no design copy" are the few the design does not cover (an empty list
 * and the two flows the LOCKED behaviours require but the prototype does not draw: the
 * request-changes box, REV-05, and the discard confirmation, REV-04). They are written in the
 * product's vocabulary and reported in the story summary as gaps to confirm.
 */
export const reviewStrings = {
  title: 'Review changes',
  introBefore: 'Each run works in its own worktree. Nothing reaches ',
  introCode: 'main',
  introAfter: ' until you approve it here.',

  list: {
    label: 'Worktrees',
    /** no design copy: shown when there are no worktrees to review. */
    empty: 'No worktrees are waiting for review.',
  },

  detail: {
    label: 'Worktree details',
    toMain: '→ main',
  },

  button: {
    approve: 'Approve & merge',
    merged: 'Merged into main',
    requestChanges: 'Request changes',
    resume: 'Resume in Sessions',
    openInEditor: 'Open in editor',
    discard: 'Discard',
    evidence: 'Evidence',
  },

  checks: {
    label: 'Checks run by orch, not the agent:',
  },

  /** no design copy: the request-changes composer (REV-05). */
  request: {
    label: 'Request changes',
    placeholder: 'What should the agent change?',
    submit: 'Send request',
    cancel: 'Cancel',
  },

  /** no design copy: the discard confirmation (REV-04). */
  discardConfirm: {
    ariaLabel: 'Confirm discarding the worktree',
    title: 'Discard these changes?',
    body: 'This deletes the worktree and its branch. The work can’t be recovered.',
    confirm: 'Discard',
    cancel: 'Keep',
  },

  empty: '—',
} as const;
