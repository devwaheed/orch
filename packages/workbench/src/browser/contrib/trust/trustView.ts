/**
 * The Trust screen's view-model: pure functions from a TrustSummary to what the
 * screen shows. No React, no services. Rules: LOCKED TRU-01 (20 runs in 30 days),
 * TRU-02 (thresholds 70 % and 85 %, "Below threshold" 10 points under a level's
 * threshold, promotion one step at a time and only when the agent qualifies).
 */
import { TRUST_THRESHOLDS, type AgentId, type AgentTrack, type CorrectionLayer, type TrustLevel, type TrustSummary } from '@orchagents/contracts';
import { AGENT_NAME, trustStrings as S } from './strings.js';

/** TRU-01: the run count an agent needs in the window before it shows a rate that can be promoted. */
export const TRU_MIN_RUNS = 20;
/** TRU-02: how many points under a level's threshold an agent may drop before "Below threshold". */
export const TRU_BELOW_MARGIN = 10;

export type Tone = 'ok' | 'info' | 'warn' | 'err';

export interface StatCardVM {
  readonly label: string;
  readonly value: string;
  readonly note: string;
  readonly tone: Tone;
}

export function periodLabel(days: 7 | 30): string {
  return days === 7 ? S.period.days7 : S.period.days30;
}

export function statCards(summary: TrustSummary): readonly StatCardVM[] {
  return [
    { label: S.stats.firstTry.label, value: `${summary.firstTryVerifiedPct}%`, note: S.stats.firstTry.note, tone: 'ok' },
    { label: S.stats.humanFix.label, value: `${summary.humanFixPct}%`, note: S.stats.humanFix.note, tone: 'warn' },
    { label: S.stats.refuted.label, value: String(summary.refutedCount), note: S.stats.refuted.note, tone: 'err' },
    {
      label: S.stats.moved.label,
      value: `${summary.correctionsMovedUp.moved} of ${summary.correctionsMovedUp.total}`,
      note: S.stats.moved.note,
      tone: 'info',
    },
  ];
}

/** The notice shown beside an agent's rate, or null. Mirrors the platform's track rules. */
export function trackNotice(track: AgentTrack): string | null {
  if (track.runs < TRU_MIN_RUNS) return S.ladder.notEnoughRuns;
  if (track.level !== 1 && track.firstTryVerifiedPct <= TRUST_THRESHOLDS[track.level] - TRU_BELOW_MARGIN) {
    return S.ladder.belowThreshold;
  }
  return null;
}

/**
 * The level the Promote button moves an agent to, or null. Promotion is manual (TRU-02):
 * this only says the button may be shown. The service still checks again on promote.
 */
export function promotionTarget(track: AgentTrack): TrustLevel | null {
  if (track.eligibleFor === null) return null;
  if (track.eligibleFor !== track.level + 1) return null;
  if (trackNotice(track) !== null) return null;
  return track.eligibleFor;
}

export type StepVM =
  | { readonly kind: 'current' }
  | { readonly kind: 'done' }
  | { readonly kind: 'promote'; readonly level: TrustLevel }
  | { readonly kind: 'locked'; readonly need: string };

export interface LadderRowVM {
  readonly agent: AgentId;
  readonly name: string;
  readonly mono: string;
  readonly rate: string;
  readonly ratePct: number;
  readonly rateTone: Tone;
  readonly notice: string | null;
  /** Steps 1, 2 and 3, in order. */
  readonly steps: readonly [StepVM, StepVM, StepVM];
}

const MONO: Record<AgentId, string> = { claude: 'CC', codex: 'CX', gemini: 'GM', opencode: 'OC', agy: 'AG' };

function rateTone(pct: number): Tone {
  if (pct >= TRUST_THRESHOLDS[3]) return 'ok';
  if (pct >= TRUST_THRESHOLDS[2]) return 'info';
  return 'warn';
}

export function stepsFor(track: AgentTrack, promoteTo: TrustLevel | null): readonly [StepVM, StepVM, StepVM] {
  const at = (level: TrustLevel): StepVM => {
    if (level === track.level) return { kind: 'current' };
    if (level < track.level) return { kind: 'done' };
    if (promoteTo === level) return { kind: 'promote', level };
    const threshold = level === 1 ? 0 : TRUST_THRESHOLDS[level];
    return { kind: 'locked', need: S.ladder.needs(threshold) };
  };
  return [at(1), at(2), at(3)];
}

export function ladderRows(summary: TrustSummary): readonly LadderRowVM[] {
  const order: readonly AgentId[] = ['claude', 'codex', 'agy', 'gemini', 'opencode'];
  return [...summary.agents].sort((a, b) => order.indexOf(a.agent) - order.indexOf(b.agent)).map((track) => {
    const promoteTo = promotionTarget(track);
    return {
      agent: track.agent,
      name: AGENT_NAME[track.agent],
      mono: MONO[track.agent],
      rate: `${track.firstTryVerifiedPct}%`,
      ratePct: track.firstTryVerifiedPct,
      rateTone: rateTone(track.firstTryVerifiedPct),
      notice: trackNotice(track),
      steps: stepsFor(track, promoteTo),
    };
  });
}

export interface LayerRowVM {
  readonly layer: CorrectionLayer;
  readonly label: string;
  readonly count: number;
  /** 0 to 100: the bar width relative to the largest layer. */
  readonly width: number;
  readonly tone: 'ok' | 'info' | 'warn';
}

const LAYER_ORDER: readonly CorrectionLayer[] = ['codebase', 'lint', 'agent_rule', 'review_note'];
const LAYER_TONE: Record<CorrectionLayer, LayerRowVM['tone']> = {
  codebase: 'ok',
  lint: 'ok',
  agent_rule: 'info',
  review_note: 'warn',
};

export function layerRows(summary: TrustSummary): readonly LayerRowVM[] {
  const counts = LAYER_ORDER.map((layer) => summary.correctionsByLayer[layer] ?? 0);
  const max = Math.max(0, ...counts);
  return LAYER_ORDER.map((layer, index) => {
    const count = counts[index] ?? 0;
    return {
      layer,
      label: S.layers.names[layer],
      count,
      width: max === 0 ? 0 : Math.round((count / max) * 100),
      tone: LAYER_TONE[layer],
    };
  });
}

export interface GardenerVM {
  readonly on: boolean;
  /** The schedule line, or "Off". */
  readonly when: string;
  readonly findings: readonly { readonly text: string; readonly when: string }[];
}

/** A finding's day, e.g. "Oct 6". Formatted in UTC unless a zone is given, so tests are stable. */
export function findingDay(at: string, timeZone = 'UTC'): string {
  const findingDate = new Date(at);
  const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone }));
  const findingDayStart = new Date(findingDate.toLocaleDateString('en-CA', { timeZone }));
  const daysAgo = Math.round((today.getTime() - findingDayStart.getTime()) / 86_400_000);
  if (daysAgo === 7) {
    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone }).format(findingDate);
    return `last ${weekday}`;
  }
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone }).format(new Date(at));
}

export function gardenerView(summary: TrustSummary, timeZone?: string): GardenerVM {
  const { gardener } = summary;
  return {
    on: gardener.on,
    when: gardener.on ? S.gardener.runsEvery : S.gardener.off,
    findings: gardener.findings.map((finding) => ({ text: finding.text, when: findingDay(finding.at, timeZone) })),
  };
}
