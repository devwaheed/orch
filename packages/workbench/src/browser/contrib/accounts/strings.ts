/**
 * User-facing strings for the Accounts area (UI-07).
 * Word for word from design/screens.md ("Accounts and Add account") and
 * design/prototype/Main.dc.html (the Accounts and Add account markup and its state logic).
 */
import type { AgentId, Os } from '@orchagents/contracts';

export const OS_NAME: Record<Os, string> = {
  macos: 'macOS',
  linux: 'Linux',
  windows: 'Windows',
};

export const accountsStrings = {
  title: 'Accounts',
  intro:
    'Add an account, sign in once, and orch keeps it separate from the others. No folders or environment variables to manage.',
  viewGroupLabel: 'View as',
  viewVisual: 'Visual',
  viewConfig: 'Config file',
  addAccount: 'Add account',

  machine: {
    thisMachine: (os: string) => `This machine: ${os}`,
    checking: 'Checking this machine…',
    checkedNow:
      'Checked just now: separate logins confirmed, and every account can see its agent’s shared skills.',
    checkedDemo:
      'Last checked by orch doctor 2 min ago: logins and shared skills, using two throwaway profiles per agent.',
    runCheck: 'Run check again',
  },

  routing: {
    title: 'How orch picks an account',
    primary: {
      label: 'Primary first',
      desc: 'Use the primary account until it nears its limit, then the next',
    },
    headroom: {
      label: 'Most headroom',
      desc: 'Always pick the account with the most capacity left',
    },
  },

  agent: {
    accountsSummary: (total: number, usable: number) =>
      `${total} ${total === 1 ? 'account' : 'accounts'} · ${usable} usable now`,
    supportParallel: 'Several accounts at once',
    supportSingle: (os: string) => `One account on ${os}`,
    supportUnverified: (os: string) => `Not yet confirmed on ${os}`,
    via: (setting: string) => `via ${setting}`,
    addAnother: (name: string) => `Add another ${name} account`,
    addSingleLimit: (name: string, os: string) => `${name} allows one account on ${os}`,
    addRunCheck: 'Run the check first',
    claudeProNote:
      'OpenCode signs in to other providers. Claude Pro or Max plans can’t be used here: Anthropic allows them only in Claude Code, so use the Claude Code agent for Claude. Check each provider’s terms before adding its login.',
    skillsShared: (count: number, name: string, demo = false) =>
      `${count} skills${demo ? ' (incl. saas-factory)' : ''} shared with all ${name} accounts from`,
    skillsNotShared: 'Each account only sees skills installed in its own folder, not',
    shareWithEveryAccount: 'Share with every account',
  },

  /** Per-agent, per-OS notes. Keyed by agent, then OS. */
  supportNotes: {
    agy: {
      macos:
        'Antigravity keeps its login in one shared macOS Keychain entry, so only one account can be signed in. orch won’t swap logins automatically: a running task would silently move to the other account. Linux supports several.',
      windows:
        'Antigravity keeps one login per machine in Windows Credential Manager, so only one account can be signed in. orch won’t swap logins automatically: a running task would silently move to the other account. Linux supports several.',
    },
    opencode: {
      windows:
        'On Windows, OpenCode may keep its login under %LOCALAPPDATA% instead of XDG_DATA_HOME. orch doctor tests this with two throwaway profiles before it allows a second account.',
    },
  } as Partial<Record<AgentId, Partial<Record<Os, string>>>>,

  /** Tooltip on the per-OS support chip. */
  supportHow: {
    claude: 'Anthropic documents this. On macOS each folder gets its own Keychain entry.',
    codex: 'orch sets cli_auth_credentials_store = "file" in every profile, so logins never go to the shared keyring.',
    gemini: 'Login lives in oauth_creds.json inside each profile.',
    agy: 'No config-folder setting. On Linux orch gives each account its own home and keeps the login out of the system keyring.',
    opencode: 'XDG_DATA_HOME moves the login and sessions; OPENCODE_CONFIG_DIR alone does not.',
  } as Record<AgentId, string>,

  account: {
    primary: 'Primary',
    routingRole: 'Routing role',
    roleUnavailable: 'Unavailable until signed in',
    roleOff: 'Switched off · never used',
    rolePrimary: 'Primary · used first',
    roleBackup: 'Backup · used when the primary is busy',
    stateAvailable: 'Available',
    stateEstimated: 'Available · est.',
    stateNearLimit: 'Near limit',
    stateLimited: 'Limited',
    stateLimitedUntil: (time: string) => `Limited · ${time}`,
    stateSignedOut: 'Signed out',
    usageUnknown: 'Usage',
    usageLimitedUntil: (time: string) => `Limited until ${time}`,
    usageOf: (pct: string, windowLabel: string) => `${pct} of ${windowLabel}`,
    use: 'Use',
    makePrimary: (name: string) => `Make ${name} primary`,
    makePrimaryTitle: 'Make primary',
    signIn: 'Sign in',
    reLogin: 'Re-login',
    loginKind: {
      subscription: 'subscription · usage window',
      api_key: 'API key · rate limits only',
    },
    windowLabel: {
      per_minute: 'per minute',
      '5h': '5-hour',
      daily: 'daily',
      weekly: 'weekly',
      monthly: 'monthly',
    } as Record<string, string>,
  },

  config: {
    fileName: '~/.orch/accounts.yaml',
    hint: 'Edit here or on the Visual tab: both stay in sync. This file is all there is to configure.',
    openEditor: 'Open in editor',
  },

  add: {
    title: 'Add an account',
    dialogAriaLabel: 'Add an account',
    stepLabel: (step: number) => `Step ${step} of 3`,
    steps: ['Agent', 'Name', 'Sign in'] as const,
    pickAgent: 'Which agent is this account for?',
    oneOnOs: (os: string) => `One account on ${os} (already added)`,
    testFirst: (os: string) => `Will be tested first on ${os}`,
    addedSeveral: (count: number) => `${count} added · several allowed`,
    nameIntro: (agent: string) => `Give this ${agent} account a name you’ll recognise.`,
    names: ['Work', 'Team', 'Client', 'Personal 2'],
    folderNote: (agent: string) =>
      `orch creates a private folder for this account and points ${agent} at it. There is nothing to set up yourself.`,
    signInIntro: (agent: string, name: string) =>
      `Sign in to ${agent} · ${name}. orch opens ${agent}’s own sign-in page; your password never passes through orch.`,
    openSignIn: 'Open sign-in',
    checkSignedIn: 'Signed in',
    checkSignedInAs: (email: string) => `as ${email}`,
    checkKeptSeparate: 'Kept separate',
    checkKeptSeparateOthers: (others: string) =>
      `orch confirmed this login is different from ${others}.`,
    checkKeptSeparateNew: 'in its own private folder.',
    checkReady: 'Ready',
    checkReadyText: 'usage tracking is on and orch can route work to it.',
    close: 'Close',
    back: 'Back',
    next: 'Next',
    done: 'Done',
    cliPlaceholder: 'orch accounts add <agent> "<name>"',
    cli: (agent: string, name: string) => `orch accounts add ${agent} "${name}"`,
    joinOthers: (labels: readonly string[]) => labels.join(' and '),
  },

  contribution: {
    paletteAddAccount: 'Add an account',
  },
} as const;
