/**
 * User-facing copy for the shells area (one strings file per area, UI-07).
 * Errors follow OrchError: `message` says what happened, `fix` says what to do.
 */
export const SHELLS_COPY = {
  stopped: {
    message: 'Terminal stopped',
    fix: 'Restart',
  },
  ptyHostUnavailable: {
    message: 'The terminal host is not running.',
    fix: 'orch restarts it automatically. Wait a moment and try again.',
  },
  openFailed: {
    message: 'Could not open a shell.',
    fix: 'Check that your shell is installed and try again.',
  },
  writeFailed: {
    message: 'Could not write to the shell.',
    fix: 'The shell may have exited. Try opening a new one.',
  },
  resizeFailed: {
    message: 'Could not resize the shell.',
    fix: 'Try opening a new shell.',
  },
  closeFailed: {
    message: 'Could not close the shell.',
    fix: 'The shell may have already exited.',
  },
} as const;