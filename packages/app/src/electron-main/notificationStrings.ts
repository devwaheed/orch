/**
 * User-facing strings for native notifications (UI-06).
 * Shown only while the window is not focused.
 *
 * All notification copy is centralized in this single file (UI-07).
 */
export const NOTIFICATION_STRINGS = {
  runAttentionLimitAsk: {
    title: 'Run needs attention',
    body: (runId: string) => `Run ${runId} hit a limit and is waiting for your decision.`,
  },
  specNeedsYou: {
    title: 'Spec needs you',
    body: (specId: string) => `Spec ${specId} stopped after its retries and needs you.`,
  },
  quotaAvailable: {
    title: 'Account available again',
    body: (accountId: string) => `Account ${accountId} is available to run jobs again.`,
  },
  jobVerified: {
    title: 'Job verified',
    body: (title: string) => `"${title}" was verified and is ready to review.`,
  },
  engineKeepsStopping: {
    title: 'Engine alert',
    body: 'The engine keeps stopping. Check orch doctor or restart.',
  },
} as const;
