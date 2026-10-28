/**
 * User-facing strings for the Settings area.
 * Word for word from the lead's specification.
 */
export const settingsStrings = {
  title: 'Settings',
  sections: {
    general: 'General',
    accountsAndRouting: 'Accounts and routing',
    engine: 'Engine',
    commandLine: 'Command line',
    about: 'About',
  },
  general: {
    theme: {
      title: 'Theme',
      system: 'System',
      light: 'Light',
      dark: 'Dark',
    },
    menuSide: {
      title: 'Menu side',
      left: 'Left',
      right: 'Right',
    },
  },
  accountsAndRouting: {
    title: 'Accounts and routing',
    manageAccounts: 'Manage accounts',
    routing: {
      title: 'Routing',
      primaryFirst: {
        label: 'Primary first',
        desc: 'Use the primary account until it nears its limit, then the next',
      },
      mostHeadroom: {
        label: 'Most headroom',
        desc: 'Always pick the account with the most capacity left',
      },
    },
    limits: {
      maxRunsPerAccount: 'Max runs per account',
      nearLimitAt: 'Near limit at',
      shareSkills: 'Share skills',
    },
    helperText: 'Change these in ~/.orch/accounts.yaml.',
    showFile: 'Show file',
  },
  engine: {
    title: 'Engine',
    status: 'Engine status',
    healthy: 'Healthy',
    notHealthy: 'Not healthy',
    restartEngine: 'Restart engine',
    runChecks: 'Run checks',
    runningChecks: 'Running checks…',
    checks: 'Doctor checks',
  },
  commandLine: {
    title: 'Command line',
    status: 'PATH status',
    installed: 'The orch command is on PATH',
    notInstalled: 'The orch command is not on PATH',
    installCommand: 'Install orch command',
    installing: 'Installing…',
  },
  about: {
    title: 'About',
    orchVersion: 'orch version',
    defaultEngineVersion: '7.5.6',
    engineDefault: 'Engine: Claw Orchestrator 7.5.6',
    enginePrefix: 'Engine: Claw Orchestrator',
    showLogs: 'Show logs',
    reportProblem: 'Report a problem',
  },
};
