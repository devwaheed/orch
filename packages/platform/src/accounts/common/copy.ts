/**
 * User-facing copy for the accounts area (one strings file per area, UI-07).
 * Errors follow OrchError: `message` says what happened, `fix` says what to do.
 * Copy not yet in a spec is marked as proposed for owner review.
 */
import type { Os } from '@orchagents/contracts';

export const OS_NAMES: Readonly<Record<Os, string>> = {
  macos: 'macOS',
  linux: 'Linux',
  windows: 'Windows',
};

export const ACCOUNT_COPY = {
  singleAccountOs: (agentName: string, os: Os) => ({
    message: `${agentName} allows one account on ${OS_NAMES[os]}.`,
    fix: 'Sign in to the account you already have. orch does not swap logins between accounts.',
  }),
  notFound: {
    message: 'That account is not in orch.',
    fix: 'Refresh the Accounts screen, then try again.',
  },
  agentUnavailable: {
    message: 'This agent is not available.',
    fix: 'Restart orch. If this keeps happening, report it with the log file.',
  },
  agentCannotStart: (agentName: string, command: string) => ({
    message: `orch could not start ${agentName}.`,
    fix: `Check that ${command} is installed and on your PATH, then try again.`,
  }),
  saveFailed: {
    message: 'orch could not save the account.',
    fix: 'Try again. If it keeps happening, restart orch.',
  },
  routingInvalid: {
    message: 'Choose a routing rule.',
    fix: 'Pick primary-first or most-headroom.',
  },
  useInvalid: {
    message: 'Choose whether this account is used.',
    fix: 'Turn Use on or off for the account, then try again.',
  },
  shareInvalid: {
    message: 'Choose whether shared skills are on.',
    fix: 'Turn shared skills on or off, then try again.',
  },
  nameInvalid: {
    message: 'Name the account with 1 to 40 characters.',
    fix: 'Use letters and numbers, then try again.',
  },
} as const;
