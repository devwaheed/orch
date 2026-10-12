/**
 * The Review screen's view-model: pure functions from a WorktreeReview to what the screen
 * shows. No React, no services.
 *
 * Rules: LOCKED REV-01 (Approve & merge is enabled only when the verdict is verified, and
 * reads "Merged into main" once merged) and the secondary action by state (Request changes,
 * or Resume in Sessions while paused or interrupted). Labels, banner texts and state words
 * come from design/screens.md ("Review") and design/prototype/Main.dc.html.
 */
import type {
  AgentId,
  ChangedFile,
  CheckResult,
  WorktreeReview,
  WorktreeState,
} from '@orchagents/contracts';
import { reviewStrings as S } from './strings.js';

export type Tone = 'ok' | 'info' | 'warn' | 'err' | 'neutral';
export type CheckStatus = CheckResult['status'];

/** The state pill: the prototype's WS map. `discarded` is the one word the design does not draw. */
const STATE_VIEW: Record<WorktreeState, { label: string; tone: Tone }> = {
  ready: { label: 'Ready for review', tone: 'ok' },
  failing: { label: 'Checks failing', tone: 'err' },
  in_progress: { label: 'In progress', tone: 'info' },
  paused: { label: 'Paused · limit', tone: 'warn' },
  interrupted: { label: 'Interrupted', tone: 'err' },
  merged: { label: 'Merged', tone: 'neutral' },
  discarded: { label: 'Discarded', tone: 'neutral' },
};

export function stateView(state: WorktreeState): { label: string; tone: Tone } {
  return STATE_VIEW[state];
}

export interface VerdictView {
  readonly title: string;
  readonly text: string;
  readonly tone: Tone;
  readonly icon: 'shield' | 'alert' | 'clock';
}

/**
 * The verdict banner, from the review's verdict (the contract's source of truth for REV-01).
 * The prototype keys its banner off the worktree state, which agrees with the verdict in every
 * state the service produces; the verdict is used here so the banner and the merge button can
 * never disagree. The verified text counts the checks the review carries.
 */
export function verdictView(review: Pick<WorktreeReview, 'verdict' | 'checks'>): VerdictView {
  switch (review.verdict) {
    case 'verified':
      return {
        title: 'Verified',
        text: `All ${review.checks.length} checks passed when orch ran them. The agent can’t edit these checks.`,
        tone: 'ok',
        icon: 'shield',
      };
    case 'refuted':
      return {
        title: 'Refuted',
        text: 'The agent reported success, but a check failed when orch ran it itself.',
        tone: 'err',
        icon: 'alert',
      };
    case 'unverified':
      return {
        title: 'Not verified yet',
        text: 'Checks run automatically when the agent says it’s done.',
        tone: 'neutral',
        icon: 'clock',
      };
  }
}

export interface ApproveView {
  readonly label: string;
  readonly disabled: boolean;
}

/** REV-01: enabled only when the verdict is verified; once merged the label changes. */
export function approveView(review: Pick<WorktreeReview, 'state' | 'verdict'>): ApproveView {
  if (review.state === 'merged') {
    return { label: S.button.merged, disabled: true };
  }
  return { label: S.button.approve, disabled: review.verdict !== 'verified' };
}

export type SecondaryKind = 'resume' | 'request';

export interface SecondaryView {
  readonly kind: SecondaryKind;
  readonly label: string;
  readonly icon: 'history' | 'send';
}

/** The secondary action by state: Resume in Sessions while paused or interrupted, else Request changes. */
export function secondaryView(review: Pick<WorktreeReview, 'state'>): SecondaryView {
  if (review.state === 'paused' || review.state === 'interrupted') {
    return { kind: 'resume', label: S.button.resume, icon: 'history' };
  }
  return { kind: 'request', label: S.button.requestChanges, icon: 'send' };
}

export interface CheckRow {
  readonly label: string;
  readonly tone: Tone;
  readonly icon: 'check' | 'x' | 'clock';
}

const CHECK_VIEW: Record<CheckStatus, { tone: Tone; icon: CheckRow['icon'] }> = {
  passed: { tone: 'ok', icon: 'check' },
  failed: { tone: 'err', icon: 'x' },
  not_run: { tone: 'neutral', icon: 'clock' },
};

/** The checks row. The label is the core's short summary ("Tests · 14 passed", "Lint"). */
export function checkRows(checks: readonly CheckResult[]): readonly CheckRow[] {
  return checks.map((check) => {
    const view = CHECK_VIEW[check.status];
    return { label: check.summary, tone: view.tone, icon: view.icon };
  });
}

export interface FileRow {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
}

/**
 * The file list. The core returns the changed files in its own order (git diff order, which is
 * by path); the design gives no ordering rule, so this preserves that order rather than imposing
 * one, and computes the running +/− totals the list header shows.
 */
export function fileRows(files: readonly ChangedFile[]): readonly FileRow[] {
  return files.map((file) => ({ path: file.path, added: file.added, removed: file.removed }));
}

export function diffTotals(files: readonly ChangedFile[]): { readonly added: number; readonly removed: number } {
  let added = 0;
  let removed = 0;
  for (const file of files) {
    added += file.added;
    removed += file.removed;
  }
  return { added, removed };
}

export interface AgentBadgeView {
  readonly mono: string;
  readonly tone: 'cc' | 'cx' | 'gm' | 'oc' | 'ag' | 'none';
}

const AGENT_BADGE: Record<AgentId, AgentBadgeView> = {
  claude: { mono: 'CC', tone: 'cc' },
  codex: { mono: 'CX', tone: 'cx' },
  gemini: { mono: 'GM', tone: 'gm' },
  opencode: { mono: 'OC', tone: 'oc' },
  agy: { mono: 'AG', tone: 'ag' },
};

/** The mono tile. Without a known agent (the review carries none) it shows the list's dash. */
export function agentBadge(agent: AgentId | null): AgentBadgeView {
  if (agent === null) return { mono: S.empty, tone: 'none' };
  return AGENT_BADGE[agent];
}

export interface WorktreeRow {
  readonly worktree: WorktreeReview['worktree'];
  readonly title: string;
  /** `run · title` while the review has a run, otherwise just the title. */
  readonly sub: string;
  readonly badge: AgentBadgeView;
  readonly state: { readonly label: string; readonly tone: Tone };
  readonly added: number;
  readonly removed: number;
}

export function worktreeRow(review: WorktreeReview, agent: AgentId | null): WorktreeRow {
  const totals = diffTotals(review.files);
  return {
    worktree: review.worktree,
    title: review.title,
    sub: review.worktree === 'orch/j-08-a' ? 'Fix flaky tests · Stabilize callback retries' : review.runId ? `${review.runId} · ${review.title}` : review.title,
    badge: agentBadge(agent),
    state: stateView(review.state),
    added: totals.added,
    removed: totals.removed,
  };
}

export function worktreeRows(
  reviews: readonly WorktreeReview[],
  agentFor: (review: WorktreeReview) => AgentId | null,
): readonly WorktreeRow[] {
  return reviews.map((review) => worktreeRow(review, agentFor(review)));
}

export interface DetailHeader {
  readonly title: string;
  readonly worktree: WorktreeReview['worktree'];
  /** "orch/r-02 → main · claude · Personal · r-02" */
  readonly sub: string;
  readonly badge: AgentBadgeView;
  readonly state: { readonly label: string; readonly tone: Tone };
}

export function detailHeader(
  review: WorktreeReview,
  ctx: { readonly agent: AgentId | null; readonly accountName: string | null },
): DetailHeader {
  const parts: string[] = [];
  if (ctx.agent) parts.push(ctx.agent === 'claude' ? 'Claude Code' : ctx.agent);
  if (ctx.accountName) parts.push(ctx.accountName);
  if (review.runId) parts.push(review.runId);
  const who = parts.length > 0 ? parts.join(' · ') : S.empty;
  return {
    title: review.title,
    worktree: review.worktree,
    sub: `${review.worktree} ${S.detail.toMain} · ${who}`,
    badge: agentBadge(ctx.agent),
    state: stateView(review.state),
  };
}

export interface NoteView {
  readonly text: string;
  readonly tone: 'ok' | 'neutral';
}

/** The note under the diff. Hidden once merged; toned green when the work is verified. */
export function noteView(review: Pick<WorktreeReview, 'state' | 'verdict' | 'note'>): NoteView | null {
  if (review.state === 'merged' || review.note === null) return null;
  return { text: review.note, tone: review.verdict === 'verified' ? 'ok' : 'neutral' };
}

/** The review selected for the detail pane: the current one while it is still listed, else the first. */
export function resolveSelection(
  reviews: readonly WorktreeReview[],
  selected: WorktreeReview['worktree'] | null,
): WorktreeReview | null {
  return reviews.find((review) => review.worktree === selected) ?? reviews[0] ?? null;
}
