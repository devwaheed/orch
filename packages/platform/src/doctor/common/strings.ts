/**
 * User-facing copy for `orch doctor` (UI-07: one strings file per area).
 * Owner review pending: the lead compiles every line here for sign-off.
 * The engine is called "engine" everywhere (ENG-06).
 */
export const DOCTOR_COPY = {
  agent: {
    installed: (name: string, version: string) => `${name} ${version} is installed`,
    notInstalled: (name: string) => `${name} is not installed`,
    notInstalledFix: (name: string, command: string) =>
      `Install ${name}, so that \`${command}\` runs in a terminal. Then run the check again.`,
    didNotStart: (name: string) => `${name} did not start`,
    didNotStartFix: (command: string) =>
      `Run \`${command} --version\` in a terminal. If it fails there too, reinstall it.`,
    unreadableVersion: (name: string) => `orch could not read the ${name} version`,
    unreadableVersionFix: (name: string, command: string) =>
      `Update ${name}, then run the check again. If it still fails, send a bug report with the output of \`${command} --version\`.`,
    uncomparableRange: (name: string, version: string) => `orch cannot compare ${name} ${version} with the tested range yet`,
    uncomparableRangeFix: 'Send a bug report. This is a bug in orch, not in your setup.',
    outOfRange: (name: string, version: string, range: string) =>
      `${name} ${version} is outside the tested range (${range})`,
    outOfRangeFix: (range: string) =>
      `orch is only tested with versions in ${range}. Install a tested version, or update orch.`,
  },
  git: {
    installed: 'Git is installed',
    notInstalled: 'Git is not installed',
    notInstalledFix: 'Install git, then run the check again. orch gives each run its own git worktree.',
    didNotStart: 'Git did not start',
    didNotStartFix: 'Run `git --version` in a terminal. If it fails there too, reinstall git.',
  },
  worktrees: {
    works: 'Git worktrees work',
    broken: 'Git worktrees do not work',
    brokenFix: 'Update git, then run the check again. orch needs worktree support for every run.',
    untested: 'orch could not test git worktrees',
    untestedFix: 'Check that the temporary folder can be written, then run the check again.',
  },
  engine: {
    running: 'The engine is running',
    notRunning: 'The engine is not running.',
    notRunningFix: 'orch restarts it automatically. Wait a moment and run the check again.',
    versionMismatch: (found: string, expected: string) => `The engine is version ${found}, not ${expected}`,
    versionMismatchFix: 'Reinstall orch so the engine matches, then run the check again.',
  },
  isolation: {
    verified: (name: string) => `Two ${name} accounts use separate sign-ins`,
    shared: (name: string) => `Two ${name} accounts show the same sign-in`,
    sharedFix: (name: string) =>
      `Sign in to a different ${name} account for each test account, then run the check again. Two accounts must never share a sign-in.`,
    unconfirmed: (name: string) => `orch could not confirm which ${name} account is signed in`,
    unconfirmedFix: (name: string) => `Check that ${name} can show its signed-in account in a terminal, then run the check again.`,
    unsupported: (name: string) => `orch cannot check ${name} sign-ins on its own`,
    unsupportedFix: (name: string) =>
      `Sign in to two ${name} accounts, then check in ${name} that each one shows its own account. orch cannot check this automatically yet.`,
    signInNotDone: (name: string) => `The test ${name} account was not signed in`,
    signInNotDoneFix: 'Sign in when orch asks, then run the check again.',
  },
  skills: {
    visible: (name: string) => `Shared ${name} skills are visible in each account`,
    nothingToShare: (name: string) => `There are no shared ${name} skills to share yet`,
    notVisible: (name: string) => `Shared ${name} skills are not visible in an account`,
    notVisibleFix: 'Turn shared skills off and on again for that account in Accounts.',
    untested: (name: string) => `orch could not test shared ${name} skills`,
    untestedFix: 'Check that the profiles folder can be written, then run the check again.',
  },
  disk: {
    enough: 'There is enough disk space for orch',
    notEnough: 'There is not enough disk space for orch',
    notEnoughFix: 'Free up disk space, then run the check again.',
    unmeasured: 'orch could not measure free disk space',
    unmeasuredFix: 'Check that the orch data folder can be read, then run the check again.',
  },
} as const;
