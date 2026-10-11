/**
 * Terminal dock tab state (S2-06). Pure functions: each returns a new state and
 * never touches the shell service, the DOM or the store. The controller calls them.
 *
 * Status rules:
 * - opening: the shell is being started (or restarted); no shell id yet.
 * - running: a shell id is attached; input and output flow.
 * - stopped: shell.exited with code null, i.e. the PTY host went away. Shows "Terminal stopped · Restart".
 * - exited: shell.exited with a numeric code, i.e. the shell itself ended.
 * - failed: the shell could not be opened.
 */
import type { ShellId } from '@orch/contracts';

export type TerminalTabStatus = 'opening' | 'running' | 'stopped' | 'exited' | 'failed';

export interface TerminalTab {
  /** Stable for the life of the tab, across restarts. Also keys the xterm instance. */
  readonly key: string;
  /** The folder the shell starts in. A restart reopens here. */
  readonly cwd: string;
  /** Short name shown on the tab, e.g. the folder name. */
  readonly label: string;
  readonly shellId: ShellId | null;
  readonly status: TerminalTabStatus;
}

export interface TerminalTabsState {
  readonly tabs: readonly TerminalTab[];
  readonly activeKey: string | null;
}

export const EMPTY_TERMINAL_TABS: TerminalTabsState = { tabs: [], activeKey: null };

function mapTab(state: TerminalTabsState, key: string, change: (tab: TerminalTab) => TerminalTab): TerminalTabsState {
  if (!state.tabs.some((tab) => tab.key === key)) return state;
  return { ...state, tabs: state.tabs.map((tab) => (tab.key === key ? change(tab) : tab)) };
}

/** Adds a tab in the opening state and makes it active. */
export function addTab(state: TerminalTabsState, tab: { key: string; cwd: string; label: string }): TerminalTabsState {
  return {
    tabs: [...state.tabs, { ...tab, shellId: null, status: 'opening' }],
    activeKey: tab.key,
  };
}

export function selectTab(state: TerminalTabsState, key: string): TerminalTabsState {
  if (!state.tabs.some((tab) => tab.key === key)) return state;
  return { ...state, activeKey: key };
}

/**
 * Removes a tab. If it was active, the tab before it becomes active, else the first
 * tab after it, else nothing.
 */
export function closeTab(state: TerminalTabsState, key: string): TerminalTabsState {
  const index = state.tabs.findIndex((tab) => tab.key === key);
  if (index === -1) return state;
  const tabs = state.tabs.filter((tab) => tab.key !== key);
  let activeKey = state.activeKey;
  if (state.activeKey === key) {
    activeKey = tabs[index - 1]?.key ?? tabs[index]?.key ?? null;
  }
  return { tabs, activeKey };
}

/** The shell opened: attach its id and show it as running. */
export function markOpened(state: TerminalTabsState, key: string, shellId: ShellId): TerminalTabsState {
  return mapTab(state, key, (tab) => ({ ...tab, shellId, status: 'running' }));
}

/** The shell could not be opened. */
export function markOpenFailed(state: TerminalTabsState, key: string): TerminalTabsState {
  return mapTab(state, key, (tab) => ({ ...tab, shellId: null, status: 'failed' }));
}

/** Restart pressed on a stopped tab: back to opening, same folder. */
export function markRestarting(state: TerminalTabsState, key: string): TerminalTabsState {
  return mapTab(state, key, (tab) => ({ ...tab, shellId: null, status: 'opening' }));
}

/**
 * shell.exited for a shell this dock shows. A null code means the PTY host stopped
 * (stopped); a number means the shell ended by itself (exited). Either way the tab
 * no longer holds a live shell id. Events for unknown shells are ignored.
 */
export function shellExited(state: TerminalTabsState, shellId: ShellId, code: number | null): TerminalTabsState {
  const tab = state.tabs.find((t) => t.shellId === shellId);
  if (!tab) return state;
  return mapTab(state, tab.key, (t) => ({ ...t, shellId: null, status: code === null ? 'stopped' : 'exited' }));
}

/** The tab key that holds a shell id, if any. */
export function tabKeyForShell(state: TerminalTabsState, shellId: ShellId): string | null {
  return state.tabs.find((tab) => tab.shellId === shellId)?.key ?? null;
}

/** Whether Restart is offered for a tab. */
export function canRestart(tab: TerminalTab): boolean {
  return tab.status === 'stopped';
}

/**
 * The folder name shown on a tab: the last path segment, handling both / and \ so
 * Windows paths read correctly. A root or empty path gives the whole path.
 */
export function folderName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const segments = trimmed.split(/[\\/]/);
  return segments[segments.length - 1] || path;
}

/** Terminal size for a box, given one character cell. Never less than one column or row. */
export function terminalSize(
  width: number,
  height: number,
  cell: { readonly width: number; readonly height: number },
): { cols: number; rows: number } {
  if (!(cell.width > 0) || !(cell.height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return { cols: 1, rows: 1 };
  }
  return {
    cols: Math.max(1, Math.floor(width / cell.width)),
    rows: Math.max(1, Math.floor(height / cell.height)),
  };
}
