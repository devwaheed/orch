/**
 * Editor groups state: two groups (A = left, B = right), tabs per group, the
 * active tab per group, the split flag, and which group has focus.
 *
 * Invariants (kept by every action):
 * - a run is open in at most one group's tabs
 * - when `split` is false, `tabsB` is empty and `activeB` is null
 * - an active id is always one of its group's tabs (or null when the group is empty)
 */
import type { RunId } from '@orch/contracts';

export type PaneId = 'A' | 'B';

export interface PaneState {
  readonly tabsA: readonly RunId[];
  readonly tabsB: readonly RunId[];
  readonly activeA: RunId | null;
  readonly activeB: RunId | null;
  readonly split: boolean;
  /** The group that last had a click or a tab selected. ⌘W closes its active tab. */
  readonly focused: PaneId;
}

export const EMPTY_PANE_STATE: PaneState = {
  tabsA: [],
  tabsB: [],
  activeA: null,
  activeB: null,
  split: false,
  focused: 'A',
};

export type PaneAction =
  /** Clicking a run in the jobs sidebar. */
  | { readonly type: 'open'; readonly runId: RunId }
  | { readonly type: 'select'; readonly pane: PaneId; readonly runId: RunId }
  | { readonly type: 'close'; readonly pane: PaneId; readonly runId: RunId }
  | { readonly type: 'focus'; readonly pane: PaneId }
  | { readonly type: 'toggleSplit' }
  /** Applies the shell's split flag (⌘\ and the palette set it). */
  | { readonly type: 'setSplit'; readonly split: boolean };

export function activeOf(state: PaneState, pane: PaneId): RunId | null {
  return pane === 'A' ? state.activeA : state.activeB;
}

export function paneReducer(state: PaneState, action: PaneAction): PaneState {
  switch (action.type) {
    case 'open':
      return openRun(state, action.runId);
    case 'select':
      return selectTab(state, action.pane, action.runId);
    case 'close':
      return closeTab(state, action.pane, action.runId);
    case 'focus':
      return state.focused === action.pane ? state : { ...state, focused: action.pane };
    case 'toggleSplit':
      return state.split ? joinPanes(state) : splitPanes(state);
    case 'setSplit':
      if (action.split === state.split) return state;
      return action.split ? splitPanes(state) : joinPanes(state);
    default:
      return assertNever(action);
  }
}

/** A run already open in the right group is focused there; otherwise it opens in the left group. */
function openRun(state: PaneState, runId: RunId): PaneState {
  if (state.split && state.tabsB.includes(runId)) {
    return { ...state, activeB: runId, focused: 'B' };
  }
  const tabsA = state.tabsA.includes(runId) ? state.tabsA : [...state.tabsA, runId];
  return { ...state, tabsA, activeA: runId, focused: 'A' };
}

function selectTab(state: PaneState, pane: PaneId, runId: RunId): PaneState {
  const tabs = pane === 'A' ? state.tabsA : state.tabsB;
  if (!tabs.includes(runId)) return state;
  return pane === 'A'
    ? { ...state, activeA: runId, focused: 'A' }
    : { ...state, activeB: runId, focused: 'B' };
}

function closeTab(state: PaneState, pane: PaneId, runId: RunId): PaneState {
  if (pane === 'A') {
    if (!state.tabsA.includes(runId)) return state;
    const tabsA = state.tabsA.filter((id) => id !== runId);
    const activeA = state.activeA === runId ? (tabsA[0] ?? null) : state.activeA;
    return { ...state, tabsA, activeA };
  }
  if (!state.tabsB.includes(runId)) return state;
  const tabsB = state.tabsB.filter((id) => id !== runId);
  if (tabsB.length === 0) {
    // Closing the last tab of the right group closes the split.
    return { ...state, tabsB: [], activeB: null, split: false, focused: 'A' };
  }
  const activeB = state.activeB === runId ? (tabsB[0] ?? null) : state.activeB;
  return { ...state, tabsB, activeB };
}

/**
 * Splits the editor: the first tab of the left group that is not active moves to
 * the right group. With one tab there is nothing to move, so nothing changes.
 */
function splitPanes(state: PaneState): PaneState {
  if (state.split) return state;
  const candidate = state.tabsA.find((id) => id !== state.activeA);
  if (candidate === undefined) return state;
  return {
    ...state,
    tabsA: state.tabsA.filter((id) => id !== candidate),
    tabsB: [candidate],
    activeB: candidate,
    split: true,
    focused: 'B',
  };
}

/** Closes the split: the right group's tabs join the left group. The active left tab stays. */
function joinPanes(state: PaneState): PaneState {
  if (!state.split) return state;
  const tabsA = [...state.tabsA, ...state.tabsB.filter((id) => !state.tabsA.includes(id))];
  return {
    ...state,
    tabsA,
    tabsB: [],
    activeA: state.activeA ?? state.activeB,
    activeB: null,
    split: false,
    focused: 'A',
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled pane action: ${JSON.stringify(value)}`);
}
