/**
 * User-facing strings for the shell area (UI-07).
 * Word for word from design/screens.md and design/prototype/Main.dc.html.
 */

export const shellStrings = {
  appName: 'orch',

  titleBar: {
    searchPlaceholder: 'Search runs, sessions, or run a command',
    searchAriaLabel: 'Search runs, sessions, or run a command',
    notifications: (unread: number) =>
      unread > 0 ? `Notifications, ${unread} new` : 'Notifications',
    themeLight: 'Switch to light theme',
    themeDark: 'Switch to dark theme',
    toggleCapacity: 'Toggle capacity panel',
    newJob: 'New job',
    projectFolder: (name: string) => name,
  },

  activityBar: {
    navAriaLabel: 'Views',
    work: {
      name: 'Work',
      label: 'Work: run and steer agents',
    },
    specs: {
      name: 'Specs',
      label: 'Specs: ordered queue that runs itself',
    },
    review: {
      name: 'Review',
      label: 'Review: approve changes',
    },
    sessions: {
      name: 'Sessions',
      label: 'Sessions: resume and recover',
    },
    trust: {
      name: 'Trust',
      label: 'Trust: how reliable agent work is',
    },
    accounts: {
      name: 'Accounts',
      label: 'Accounts: logins and routing',
    },
    settings: {
      name: 'Settings',
      label: 'Settings',
    },
  },

  statusBar: {
    engineName: 'orchd',
    engineRestarting: 'engine restarting',
    branch: 'main',
    terminal: 'Terminal',
    toggleTerminalAria: 'Toggle terminal dock',
    limitedStatus: (agent: string, account: string, time: string) =>
      `${agent} · ${account} limited → ${time}`,
    signedOutStatus: (count: number) =>
      `${count} ${count === 1 ? 'account' : 'accounts'} signed out`,
    paletteCommandsHint: '⌘K commands',
  },

  capacity: {
    title: 'Capacity',
    ariaLabel: 'Capacity panel',
    emptyTitle: 'No account usage data yet',
    emptyDescription: 'Live usage per account appears here once jobs run.',
    liveUsage: '· live usage',
    legendReported: 'reported',
    legendEstimated: 'estimated',
    spendToday: 'Spend today',
    spendRunLedger: 'run ledger',
    spendApiKeysOnly: 'API keys only',
    notSignedIn: 'Not signed in',
    accountSettings: 'Account settings',
    stateAvailable: 'Available',
    stateNearLimit: 'Near limit',
    stateLimited: 'Limited',
    stateEstimated: 'Available · est.',
    stateSignedOut: 'Signed out',
    usableText: (used: number, total: number) => `${used}/${total} usable`,
    bindingText: (count: number) => `${count} ${count === 1 ? 'run' : 'runs'}`,
  },

  palette: {
    dialogAriaLabel: 'Command palette',
    inputAriaLabel: 'Command',
    inputPlaceholder: 'Type a command or search…',
    escHint: 'esc',
    noResults: 'No commands found.',
    closeAriaLabel: 'Close command palette',
  },

  engineBar: {
    keepsStopping: 'The engine keeps stopping.',
    restartEngine: 'Restart engine',
    reportProblem: 'Report a problem',
  },
} as const;
