/**
 * User-facing strings for the terminal dock (UI-07).
 * Word for word from design/screens.md and design/prototype/Main.dc.html, and the
 * shells area's copy in packages/platform/src/shells/common/strings.ts (the workbench
 * may not import platform, so the copy is repeated here).
 */

export const terminalStrings = {
  dockTitle: 'Terminal',
  dockHint: 'runs on this machine via orchd',
  newShell: 'New shell',
  newShellTitle: 'New shell in a worktree',
  hideTerminal: 'Hide terminal',
  closeShell: (label: string) => `Close shell ${label}`,
  shellInputAria: 'Shell command',
  /** Shown when the PTY host dies and the shell was running. Rendered as "Terminal stopped · Restart". */
  stopped: {
    message: 'Terminal stopped',
    fix: 'Restart',
  },
  /** Copied from SHELLS_COPY.openFailed (platform/src/shells/common/strings.ts). */
  openFailed: {
    message: 'Could not open a shell.',
    fix: 'Check that your shell is installed and try again.',
  },
} as const;
