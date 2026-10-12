/**
 * User-facing strings for the Trust area (UI-07).
 * Word for word from design/screens.md ("Trust") and design/prototype/Main.dc.html (the Trust
 * markup and its sample data). "Not enough runs yet" and "Below threshold" are LOCKED TRU-01
 * and TRU-02 and match the platform's labels exactly.
 */
import type { AgentId, CorrectionLayer } from '@orchagents/contracts';

export const AGENT_NAME: Record<AgentId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini CLI',
  opencode: 'OpenCode',
  agy: 'Antigravity',
};

export const trustStrings = {
  title: 'Trust',
  intro:
    'How much agent work you can rely on without fixing it. Running more agents only helps once these numbers are good, so give agents more freedom one step at a time.',

  period: {
    group: 'Period',
    days7: 'Last 7 days',
    days30: 'Last 30 days',
  },

  stats: {
    firstTry: { label: 'Verified on the first try', note: 'checks passed without a repair round' },
    humanFix: { label: 'Needed a human fix', note: 'you requested changes before merging' },
    refuted: { label: 'Refuted by checks', note: 'agent said done, checks said no' },
    moved: { label: 'Corrections moved up a layer', note: 'turned into code or lint, not just notes' },
  },

  ladder: {
    title: 'Trust ladder',
    intro: 'Each agent earns the next step with its own track record. You decide when to promote it.',
    agent: 'Agent',
    firstTry: 'First-try verified',
    levels: {
      1: { label: '1 · Review everything', desc: 'you check every change' },
      2: { label: '2 · Auto-repair', desc: 'retries until checks pass' },
      3: { label: '3 · Auto-merge low-risk', desc: 'tests, docs, small fixes' },
    },
    current: 'Current',
    promote: 'Promote',
    passed: 'passed',
    needs: (percent: number) => `needs ${percent}%`,
    notEnoughRuns: 'Not enough runs yet',
    belowThreshold: 'Below threshold',
  },

  layers: {
    title: 'Where corrections went',
    intro: 'Aim for most fixes in the top two: they hold for every agent, every time.',
    names: {
      codebase: '1 · Codebase',
      lint: '2 · Lint or CI rule',
      agent_rule: '3 · Agent rule',
      review_note: '4 · Review note',
    } satisfies Record<CorrectionLayer, string>,
  },

  gardener: {
    title: 'Gardener',
    intro:
      'Bad patterns spread because agents copy what they see. Once a week an agent looks for copied workarounds, new lint suppressions and duplicate ways of doing one thing, then proposes a cleanup and a lint rule. Its changes go through Review like any other job.',
    on: 'On',
    runsEvery: 'Runs every Monday at 09:00',
    off: 'Off',
  },
};
