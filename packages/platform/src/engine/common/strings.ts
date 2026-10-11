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
  autoloopNeedsAccount: {
    message: 'Autoloop runs cannot use a separate account yet.',
    fix: 'Use single, compare or council mode, or run autoloop on the default account.',
  },
  compareAgentCount: {
    message: 'Compare runs need between 2 and 5 agents.',
    fix: 'Choose 2 to 5 accounts for the compare run.',
  },
  workflowFailed: {
    message: 'The engine could not complete that request.',
    fix: 'Try again. If it keeps happening, send a bug report.',
  },
} as const;
