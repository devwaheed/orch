/**
 * User-facing strings for the New job area (UI-07).
 * Word for word from design/screens.md ("Start a job") and design/prototype/Main.dc.html (NewJob).
 */

export const newJobStrings = {
  title: 'New spec',
  subtitle: 'orch writes it to the spec folder and runs it when its turn comes. Capacity on the right is live.',
  route: {
    name: 'New spec',
  },

  titleField: {
    label: 'Title',
    placeholder: 'e.g. Integration tests for the callback flow',
  },

  goal: {
    label: 'What to do',
    placeholder: 'Details for the agents: what to change, where, what to avoid',
  },

  modes: {
    heading: 'How should agents work on this?',
    intro: 'You can change your mind later. Every mode shows up in Live, Review and Sessions the same way.',
    groupLabel: 'Job mode',
    bestFor: (best: string) => `Best for: ${best}`,
    comingLater: 'Coming in a later version',
    single: {
      label: 'One job, split up',
      desc: 'An orchestrator plans the work and hands parts to other agents.',
      best: 'features, bug fixes',
    },
    compare: {
      label: 'Compare agents',
      desc: 'Several agents get the same question; you see every answer side by side.',
      best: 'design choices, second opinions',
    },
    council: {
      label: 'Council',
      desc: 'Agents each try it in their own worktree and discuss until they agree.',
      best: 'tricky problems, big refactors',
    },
    autoloop: {
      label: 'Autoloop',
      desc: 'Planner, Coder and Reviewer keep iterating until the goal is met.',
      best: 'long tasks you want to leave running',
    },
  },

  orchestrator: {
    heading: 'Orchestrator',
    intro: 'Plans the work and hands tasks to workers. Let orch choose the account, or pin one.',
    auto: 'Auto',
    autoUses: (account: string) => `Uses ${account} now`,
    noRoom: 'No account has room',
    pinnedLimited: (back: string) => `limited until ${back}`,
    warningLimited: (agent: string, account: string, back: string, fallback: string) =>
      `${agent} · ${account} is limited until ${back}. The job will be scheduled for then, or pick Auto to start now on ${fallback}.`,
    warningLimitedNoTime: (agent: string, account: string, fallback: string) =>
      `${agent} · ${account} is limited. The job will be scheduled for then, or pick Auto to start now on ${fallback}.`,
    fallbackAccount: 'another account',
    warningNear: (agent: string, account: string) =>
      `${agent} · ${account} is near its limit. Long jobs may pause partway through.`,
  },

  accountState: {
    available: 'Available',
    near_limit: 'Near limit',
    limited: 'Limited',
    estimated: 'Available · est.',
    signed_out: 'Signed out',
  },

  workers: {
    heading: 'Workers',
    usable: (usable: number, total: number) =>
      `${usable} of ${total} ${total === 1 ? 'account' : 'accounts'} usable now`,
  },

  checks: {
    heading: 'Done when',
    helperText: 'No lines? orch adds one audit: “The goal is met”.',
    intro:
      'orch runs these itself when the agents say they’re finished. Agents can’t change them, and nothing reaches Review as “verified” unless they pass.',
    guardrailTag: 'guardrail · always on',
    guardrails: {
      no_new_suppressions: 'No new lint or type suppressions',
      protected_files: 'Lint config, tests and CI files stay unchanged',
    },
    commandKind: 'command',
    fileRuleKind: 'file rule',
    webKind: 'web check',
    auditKind: 'audit',
    auditPlaceholder: 'e.g. Error codes match docs/api/errors.md',
    appAddress: 'App address, e.g. http://localhost:3000',
    appAddressAria: 'App address for the web check',
    add: 'Add:',
    addAuditLine: 'Add audit line',
    remove: (check: string) => `Remove check ${check}`,
    removeAudit: 'Remove audit line',
  },

  runNext: {
    label: 'Run next',
    description: 'Starts before the other queued specs.',
  },

  limits: {
    heading: 'When an account hits its limit',
    options: {
      switch_account: { label: 'Switch account', desc: 'Same agent, another account; wait if none' },
      switch_agent: { label: 'Switch agent', desc: 'Hand the task to another agent in the pool' },
      ask: { label: 'Ask me', desc: 'Pause and notify me' },
    },
  },

  compare: {
    heading: 'Ask these agents',
    combineLabel: 'Combine the answers into one',
    combineDesc: 'A final pass compares them and writes one recommendation, with where they disagreed.',
  },

  council: {
    heading: 'Council members',
    roundsLabel: 'Rounds before you decide:',
    roundsGroupLabel: 'Maximum rounds',
    roundOption: (n: number) => `up to ${n}`,
    roundsSubtext: 'Each member works in its own worktree; they vote until they agree, then you review.',
  },

  autoloop: {
    heading: 'Who plays each role',
    intro:
      'You agree the plan with the Planner first. Then the Coder and Reviewer iterate on their own and come back to you at decision points.',
    roles: {
      planner: {
        label: 'Planner',
        desc: 'agrees the plan with you',
        aria: 'Planner agent',
      },
      coder: {
        label: 'Coder',
        desc: 'writes the changes',
        aria: 'Coder agent',
      },
      reviewer: {
        label: 'Reviewer',
        desc: 'checks each step',
        aria: 'Reviewer agent',
      },
    },
  },

  footer: {
    cancel: 'Cancel',
    start: 'Add spec',
    addSpec: 'Add spec',
    schedule: (time: string) => `Schedule for ${time}`,
    askAgents: (count: number) => `Ask ${count} agents`,
    startCouncil: 'Start council',
    startPlanner: 'Start with the Planner',
  },

  errors: {
    cliFailed: 'The command could not be built.',
  },
} as const;
