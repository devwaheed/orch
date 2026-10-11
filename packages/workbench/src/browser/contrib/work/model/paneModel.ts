/**
 * Pure view-model for an agent pane: which run actions exist for a status, the
 * message box rules, how each output line kind renders, and the "where" label.
 */
import type { AgentId, RunId, RunLine, RunStatus, WorktreeId } from '@orch/contracts';
import { workStrings } from '../strings.js';

export type RunActionId = 'pause' | 'stop' | 'shell' | 'review' | 'continue' | 'startNow';

/**
 * Run actions by status (screens.md, Work):
 * Running → Pause, Stop, Shell, Review · Paused → Shell, Review · Done → Continue · Queued → Start now.
 * Shell and Review need a worktree to act on. Statuses the design does not cover have no actions.
 */
export function runActions(status: RunStatus, hasWorktree: boolean): readonly RunActionId[] {
  const worktreeActions: readonly RunActionId[] = hasWorktree ? ['shell', 'review'] : [];
  switch (status) {
    case 'running':
      return ['pause', 'stop', ...worktreeActions];
    case 'paused_limit':
      return worktreeActions;
    case 'done':
      return ['continue'];
    case 'queued':
      return ['startNow'];
    case 'failed':
    case 'stopped':
      return [];
    default:
      return assertNever(status);
  }
}

export function runActionLabel(action: RunActionId): string {
  return workStrings.actions[action];
}

/** Stop is the only destructive action and is drawn in the error colour. */
export function runActionIsDestructive(action: RunActionId): boolean {
  return action === 'stop';
}

export interface MessageBoxView {
  readonly enabled: boolean;
  readonly placeholder: string;
}

/** The message box is enabled only while the run is Running (screens.md, Work). */
export function messageBoxView(status: RunStatus, agentName: string, runId: RunId): MessageBoxView {
  switch (status) {
    case 'running':
      return { enabled: true, placeholder: workStrings.message.placeholderRunning(agentName, runId) };
    case 'paused_limit':
      return { enabled: false, placeholder: workStrings.message.placeholderPaused };
    case 'done':
      return { enabled: false, placeholder: workStrings.message.placeholderDone };
    case 'queued':
      return { enabled: false, placeholder: workStrings.message.placeholderQueued };
    case 'failed':
    case 'stopped':
      return { enabled: false, placeholder: workStrings.unspecifiedStatus(status) };
    default:
      return assertNever(status);
  }
}

/** Colour class of an output line. Matches a class in Output.module.css. */
export type LineTone =
  | 'meta'
  | 'you'
  | 'msg'
  | 'tool'
  | 'add'
  | 'del'
  | 'ok'
  | 'err'
  | 'limit'
  | 'spawn';

export interface LineView {
  readonly tone: LineTone;
  readonly glyph: string;
}

/** Output rendering per RunLine kind. The glyph column is decorative. */
export function lineView(kind: RunLine['kind']): LineView {
  switch (kind) {
    case 'meta':
      return { tone: 'meta', glyph: '#' };
    case 'prompt':
      return { tone: 'you', glyph: '›' };
    case 'message':
      return { tone: 'msg', glyph: '' };
    case 'tool':
      return { tone: 'tool', glyph: '⏺' };
    case 'diff_add':
      return { tone: 'add', glyph: '' };
    case 'diff_del':
      return { tone: 'del', glyph: '' };
    case 'ok':
      return { tone: 'ok', glyph: '✓' };
    case 'err':
      return { tone: 'err', glyph: '✗' };
    case 'limit':
      return { tone: 'limit', glyph: '!' };
    case 'spawn':
      return { tone: 'spawn', glyph: '↳' };
    default:
      return assertNever(kind);
  }
}

/** The "where" field of the pane header: the worktree, read-only main, or not started. */
export function whereLabel(input: { readOnly: boolean; worktree: WorktreeId | null }): string {
  if (input.readOnly) return workStrings.panes.where.readOnly;
  if (input.worktree) return input.worktree;
  return workStrings.panes.where.notStarted;
}

export function agentDisplayName(agent: AgentId, displayName: string | undefined): string {
  return displayName ?? agent;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`);
}
