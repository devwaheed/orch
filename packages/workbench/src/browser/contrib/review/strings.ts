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

  corrections: {
    title: 'Stop this happening again',
    intro: 'Fix it in the strongest place that can hold it. A note only reminds agents; structure and lint make the wrong thing impossible.',
    lessonLabel: 'What went wrong:',
    layerLabel: 'Where to fix it',
    layer: {
      codebase: { label: 'Codebase', tag: 'strongest' },
      lint: { label: 'Lint or CI rule', tag: 'agents can\'t skip it' },
      agent_rule: { label: 'Agent rule', tag: 'agents mostly follow it' },
      review_note: { label: 'Review note', tag: 'doesn\'t scale' },
    },
    actionLabel: {
      codebase: 'Start the refactor job',
      lint: 'Start the lint-rule job',
      agent_rule: 'Add the rule',
      review_note: 'Save the note',
    },
    /** Prototype LAYERS "next" lines, word for word. */
    next: {
      codebase: 'Starts a small job to make this change.', // prototype text is specific to its sample; lead-drafted
      lint: 'Starts a small job that writes the rule and fixes anything it flags.',
      agent_rule: 'Opens the line in AGENTS.md for you to approve.',
      review_note: 'Saves a note on your review checklist.',
    },
    /** Lead-drafted: the prototype pre-writes each action; nothing specifies who drafts it, so you write it. */
    actionPlaceholder: 'What should change? This becomes the job goal, the AGENTS.md line or the note.',
    actionDone: {
      codebase: 'Queued a refactor job. It will come back through Review with its own checks.',
      lint: 'Queued a lint-rule job. Once merged, every agent is blocked from repeating this.',
      agent_rule: 'Added to AGENTS.md after your approval. Agents read it at the start of each run.',
      review_note: 'Saved to your review checklist.',
    },
  },
} as const;
