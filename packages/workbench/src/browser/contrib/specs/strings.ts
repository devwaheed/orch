/**
 * User-facing strings for the Specs area (UI-07).
 * Labels and pills come word for word from docs/specs/spec-queue.md §12 (where the
 * prototype's sample text differs, §12 wins) and docs/specs/spec-queue.md §3 (rules).
 * The state pills mirror packages/platform/src/specs/queue/common/labels.ts, which is
 * the locked §12 implementation.
 */
import type { AgentId, SpecAdvance, SpecOnFail, SpecOrder } from '@orchagents/contracts';

export const AGENT_NAME: Record<AgentId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini CLI',
  opencode: 'OpenCode',
  agy: 'Antigravity',
};

/** Two-letter tiles shown on agent badges, matching design/prototype/Main.dc.html (AG). */
export const AGENT_MONO: Record<AgentId, string> = {
  claude: 'CC',
  codex: 'CX',
  gemini: 'GM',
  opencode: 'OC',
  agy: 'AG',
};

export const specStrings = {
  title: 'Specs',

  header: (count: number, source: string) =>
    `${count} stories from ${source}. orch runs them in order and moves to the next one on its own.`,

  views: {
    queue: 'Queue',
    map: 'Agent map',
    plan: 'Plan',
    live: 'Live',
  },

  queueButton: {
    pause: 'Pause queue',
    resume: 'Resume queue',
  },

  rules: {
    order: 'Order',
    advance: 'Move on when',
    onFail: 'If a spec fails',
  },

  orderOptions: {
    strict: 'One at a time',
    waves: 'Parallel when files don’t overlap',
  },

  advanceOptions: {
    verified: 'Verified',
    approved: 'I approve',
    merged: 'Merged',
  },

  /** The "If a spec fails" options bake the retries count into the label (§3 + prototype). */
  onFailOptions: (retries: number): Record<SpecOnFail, string> => ({
    'retry-stop': `Retry ${retries}× then pause`,
    'retry-skip': `Retry ${retries}× then skip`,
  }),

  counts: {
    verified: 'verified',
    running: 'running',
    needsYou: 'needs you',
    skipped: 'skipped',
    queued: 'queued',
  },

  barTitles: {
    verified: (n: number) => `${n} verified`,
    running: (n: number) => `${n} running`,
    stopped: (n: number) => `${n} stopped`,
    skipped: (n: number) => `${n} skipped`,
    queued: (n: number) => `${n} queued`,
  },

  /** Collapsed group rows (§12 Grouping). {first}/{last} are zero-padded spec ids. */
  groupMerged: (_first: string, _last: string, n: number) =>
    `${n} specs verified and merged`,
  groupQueued: (_first: string, _last: string, n: number) =>
    `${n} specs queued; they start in order as earlier ones are verified`,

  nowLine: {
    paused: 'Queue paused. Running specs finish; nothing new starts until you resume.',
    stopped: (id: string, tries: number) =>
      `Spec ${id} stopped after ${tries} ${tries === 1 ? 'try' : 'tries'} and needs you; specs that don't depend on it keep going.`,
    skipped: (id: string, tries: number) =>
      `Spec ${id} was skipped after ${tries} ${tries === 1 ? 'try' : 'tries'}.`,
    startsWhen: (next: string, when: string) => `Spec ${next} starts ${when}.`,
    when: {
      verified: (dep: string) => `as soon as ${dep} is verified`,
      approved: (dep: string) => `after ${dep} is verified and you approve it`,
      merged: (dep: string) => `after ${dep} is merged`,
    },
  },

  /** The Plan view (dependency graph, groups, stage times and events). */
  plan: {
    inPlan: (n: number) => `${n} in plan`,
    searchPlaceholder: 'Search',
    groups: {
      coding: 'Coding',
      review: 'In review',
      waiting: 'Waiting on you',
      ready: 'Ready',
      blocked: 'Blocked',
      shipped: 'Shipped',
      skipped: 'Skipped',
    },
    groupHeading: (label: string, count: number) => `${label} · ${count}`,
    waveChip: (n: number) => `W${n}`,
    nodeLabel: (id: string, title: string, group: string) => `${id} ${title}, ${group}`,
    detailLabel: (id: string, title: string) => `${id} ${title}`,
    affectedOnly: 'Show affected path only',
    viewLayers: 'VIEW LAYERS',
    layers: {
      wires: 'Dependency wires',
      waves: 'Wave labels',
      agents: 'Agent badges',
      shipped: 'All shipped specs',
    },
    shipped: 'Shipped',
    shippedPct: (pct: number) => `${pct}%`,
    wirePlan: 'Wire plan',
    insertInTerminal: (id: string) => `Insert ${id} in terminal`,
    zoomOut: 'Zoom out',
    zoomIn: 'Zoom in',
    fit: 'Fit',
    events: 'Events',
    last24: 'Last 24 hours',
    healthy: 'Healthy',
    warning: 'Warning',
    critical: 'Critical',
    noEvents: 'No events in the last 24 hours.',
    eventTitle: (id: string, title: string, group: string, time: string) =>
      `${id} ${title}: ${group} · ${time}`,
    inserted: 'Inserted from the wire plan',
    undo: 'Undo',
    waveOf: (n: number, max: number) => `Wave ${n} of ${max}`,
    worktree: 'Worktree',
    noneYet: 'None yet',
    coder: 'Coder',
    notAssigned: 'Not assigned',
    reviewer: 'Reviewer',
    dependsOn: 'Depends on',
    unblocks: 'Unblocks',
    none: 'None',
    review: 'Review',
    insertFile: (file: string) => `Insert @${file} in terminal`,
    tabs: {
      overview: 'Overview',
      needs: 'Needs',
      events: 'Events',
    },
    timePerStage: 'Time per stage (min)',
    stages: {
      code: 'Code',
      verify: 'Verify',
      review: 'Review',
      fix: 'Fix',
      merge: 'Merge',
    },
    stable: 'Stable',
    costByHour: 'Cost by hour ($)',
    noRuns: 'No runs yet.',
    eventRow: (time: string, group: string, attempt: number) =>
      `${time} · ${group} · try ${attempt}`,
  },

  /** SaaS Factory strip and the Plan view's factory story row. */
  factory: {
    title: 'SaaS Factory',
    runNext: 'Run next step',
    next: (next: string) => `Next: ${next}`,
    stories: (done: number, total: number) => `${done}/${total} stories`,
    stageTitle: (stage: string, by: string) => `${stage} · ${by}`,
    goal: (next: string) =>
      `Run the SaaS Factory's next step for this project: ${next}. Use the factory skill (/factory, or $factory in Codex).`,
    story: 'Factory story',
    specTasksOpen: (n: number) => `${n} spec tasks open`,
    specTasksDone: 'spec tasks done',
    noSpec: 'no Kiro spec yet',
  },

  map: {
    runner: (repoName: string) => `Spec runner · ${repoName}`,
    agentsWorking: (n: number, tokens: string) => `orch · ${n} agents working · ${tokens}`,
    clickHint: (count: number) => `${count} agents · click an agent to watch live`,
    backgroundTask: 'background task',
    backgroundTaskOne: '1 background task',
    afterEveryVerified: 'runs after every verified spec',
  },

  /** Spec row helper labels (§12 pill text is computed in specsView.ts). */
  row: {
    doneWhen: 'Done when',
    dependsOn: 'Depends on',
    mayChange: 'May change',
    openInWork: 'Watch live',
    skip: 'Skip this spec',
    retry: 'Retry',
  },

  states: {
    /** §12: empty screen when there are no specs loaded. */
    empty: {
      title: 'No specs yet',
      description: 'Describe what you want done and orch runs it, checks it and hands it to you for review.',
      button: 'New spec',
    },
    /** §12: loading state while the queue loads. */
    loading: 'Loading the spec queue…',
    /** Problems list heading (§11). */
    problems: 'Problems loading the queue',
    problemsIntro: 'The queue won’t start while these exist. Fix the files and reload.',
  },

  /** Fix in terminal & manual check (owner request, spec-queue.md §6). */
  fixInTerminal: 'Fix in terminal',
  checkAgain: 'Check again',
  checking: 'Checking…',
  notMetYet: 'Not met yet',

  /** Resolves a SpecAdvance → human label for the "Move on when" pill. */
  advanceLabel: (a: SpecAdvance): string => specStrings.advanceOptions[a],
  orderLabel: (o: SpecOrder): string => specStrings.orderOptions[o],
  onFailLabel: (f: SpecOnFail, retries: number): string => specStrings.onFailOptions(retries)[f],
  agentName: (agent: AgentId): string => AGENT_NAME[agent],
} as const;
