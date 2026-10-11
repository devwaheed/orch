/**
 * User-facing copy for the engine area. Users see the engine as "engine"
 * (ENG-06); the underlying library is never named here.
 */
export const ENGINE_COPY = {
  unavailable: {
    message: 'The engine is not running.',
    fix: 'orch restarts it automatically. Wait a moment and try again.',
  },
  keepsStopping: 'The engine keeps stopping',
  invalidRequest: {
    message: 'The engine request was not valid.',
    fix: 'Send a bug report. This is a bug in orch, not in your setup.',
  },
  notFound: {
    session: 'The engine has no record of that session.',
    workflow: 'The engine has no record of that workflow.',
  },
  noAccountRecord: {
    message: 'The engine has no account record for that session or workflow, so it cannot run it.',
    fix: 'Start the session or workflow again from orch.',
  },
  compareAgentCount: {
    message: 'Compare runs need between 2 and 5 agents.',
    fix: 'Choose 2 to 5 accounts for the compare run.',
  },
  /** Handoff history stand-in when the earlier conversation was not kept. Lead-drafted. */
  noTranscript: 'The earlier conversation is not available. The work done so far is in this folder.',
  workflowFailed: {
    message: 'The engine could not complete that request.',
    fix: 'Try again. If it keeps happening, send a bug report.',
  },
} as const;

/**
 * What orch says to the autoloop Planner (JOB-09). Claw's Planner proposes a plan,
 * waits for the user's answer in chat, then spawns the Coder and Reviewer itself.
 * Lead-drafted; listed for owner review.
 */
export const PLANNER_MESSAGES = {
  approved: 'The plan is approved. Start the Coder and Reviewer now.',
  rejected: (reason: string | undefined) =>
    `The plan is not approved${reason ? `: ${reason}` : '.'} Write a revised plan and wait for approval again before any coding starts.`,
} as const;
