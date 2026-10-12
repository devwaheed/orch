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
    waves: "Parallel when files don't overlap",
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

  map: {
    runner: (repoName: string) => `Spec runner · ${repoName}`,
    agentsWorking: (n: number, tokens: string) => `orch · ${n} agents working · ${tokens}`,
    clickHint: (count: number) => `${count} agents · click an agent to open it in Work`,
    backgroundTask: 'background task',
    backgroundTaskOne: '1 background task',
    afterEveryVerified: 'runs after every verified spec',
  },

  /** Spec row helper labels (§12 pill text is computed in specsView.ts). */
  row: {
    doneWhen: 'Done when',
    dependsOn: 'Depends on',
    mayChange: 'May change',
    openInWork: 'Open in Work',
    skip: 'Skip this spec',
    retry: 'Retry',
  },

  states: {
    /** §12: empty screen when there are no specs loaded. */
    empty: {
      title: 'No spec queue here',
      description: 'Put stories in the source folder and they run in order.',
    },
    /** §12: loading state while the queue loads. */
    loading: 'Loading the spec queue…',
    /** Problems list heading (§11). */
    problems: 'Problems loading the queue',
    problemsIntro: 'The queue won’t start while these exist. Fix the files and reload.',
  },

  /** Resolves a SpecAdvance → human label for the "Move on when" pill. */
  advanceLabel: (a: SpecAdvance): string => specStrings.advanceOptions[a],
  orderLabel: (o: SpecOrder): string => specStrings.orderOptions[o],
  onFailLabel: (f: SpecOnFail, retries: number): string => specStrings.onFailOptions(retries)[f],
  agentName: (agent: AgentId): string => AGENT_NAME[agent],
} as const;
