/**
 * User-facing strings for the Bug Report feature (UI-07).
 * Follows LOCKED BUG-01, BUG-02, BUG-04 and ENG-07 exactly.
 */

export const bugReportStrings = {
  dialog: {
    title: 'Report a problem',
    ariaLabel: 'Report a problem dialog',
    intro: 'orch will save these files to a zip on your computer. Nothing is sent anywhere.',
    saveReport: 'Save report',
    saving: 'Saving report…',
    cancel: 'Cancel',
    close: 'Close',
    savedTo: (path: string) => `Saved to ${path}`,
    showInFolder: 'Show in folder',
    openGitHubIssue: 'Open GitHub issue',
    loadingFiles: 'Collecting files to include…',
    noFiles: 'No files to include.',
  },
  commands: {
    reportProblem: 'Report a problem…',
  },
  engineBar: {
    keepsStopping: 'The engine keeps stopping.',
    restartEngine: 'Restart engine',
    reportProblem: 'Report a problem',
  },
} as const;
