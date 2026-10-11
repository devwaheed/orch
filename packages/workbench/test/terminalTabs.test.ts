/**
 * Terminal dock tab state (S2-06): the pure reducer, the stopped and restart rules,
 * and the size and folder-name helpers.
 */
import { describe, expect, it } from 'vitest';
import { ShellId } from '@orch/contracts';
import {
  EMPTY_TERMINAL_TABS,
  addTab,
  canRestart,
  closeTab,
  folderName,
  markOpenFailed,
  markOpened,
  markRestarting,
  selectTab,
  shellExited,
  tabKeyForShell,
  terminalSize,
  type TerminalTabsState,
} from '../src/browser/parts/terminal/terminalTabs.js';

const sh1 = ShellId.parse('sh-1');
const sh2 = ShellId.parse('sh-2');

function threeTabs(): TerminalTabsState {
  let state = addTab(EMPTY_TERMINAL_TABS, { key: 'a', cwd: '/repo/api', label: 'api' });
  state = addTab(state, { key: 'b', cwd: '/repo/api/.orch/wt/r-02', label: 'r-02' });
  state = addTab(state, { key: 'c', cwd: '/repo/api/.orch/wt/r-04', label: 'r-04' });
  return state;
}

describe('tab list', () => {
  it('adds a tab in the opening state and makes it active', () => {
    const state = addTab(EMPTY_TERMINAL_TABS, { key: 'a', cwd: '/repo', label: 'repo' });
    expect(state.activeKey).toBe('a');
    expect(state.tabs).toEqual([{ key: 'a', cwd: '/repo', label: 'repo', shellId: null, status: 'opening' }]);
  });

  it('selects a known tab and ignores an unknown key', () => {
    const state = threeTabs();
    expect(selectTab(state, 'a').activeKey).toBe('a');
    expect(selectTab(state, 'missing')).toBe(state);
  });

  it('closing the active tab activates the tab before it, else the one after', () => {
    const state = threeTabs();
    expect(closeTab(state, 'c').activeKey).toBe('b');
    expect(closeTab(selectTab(state, 'a'), 'a').activeKey).toBe('b');
    expect(closeTab(selectTab(state, 'c'), 'b').activeKey).toBe('c');
  });

  it('closing a tab that is not active keeps the active tab', () => {
    const state = selectTab(threeTabs(), 'b');
    expect(closeTab(state, 'c').activeKey).toBe('b');
  });

  it('closing the last tab leaves no active tab', () => {
    const state = closeTab(addTab(EMPTY_TERMINAL_TABS, { key: 'a', cwd: '/repo', label: 'repo' }), 'a');
    expect(state).toEqual({ tabs: [], activeKey: null });
  });
});

describe('shell status', () => {
  it('a tab is running once its shell has opened', () => {
    const state = markOpened(threeTabs(), 'a', sh1);
    expect(state.tabs[0]).toMatchObject({ status: 'running', shellId: sh1 });
    expect(tabKeyForShell(state, sh1)).toBe('a');
  });

  it('an open failure marks the tab failed with no shell', () => {
    const state = markOpenFailed(threeTabs(), 'b');
    expect(state.tabs[1]).toMatchObject({ status: 'failed', shellId: null });
  });

  it('shell.exited with code null (PTY host stopped) marks the tab stopped and allows restart', () => {
    const state = shellExited(markOpened(threeTabs(), 'a', sh1), sh1, null);
    const tab = state.tabs[0];
    expect(tab).toMatchObject({ status: 'stopped', shellId: null });
    expect(tab && canRestart(tab)).toBe(true);
  });

  it('shell.exited with a number (the shell ended itself) is exited, not stopped', () => {
    const state = shellExited(markOpened(threeTabs(), 'a', sh1), sh1, 0);
    const tab = state.tabs[0];
    expect(tab).toMatchObject({ status: 'exited', shellId: null });
    expect(tab && canRestart(tab)).toBe(false);
  });

  it('exit events for shells the dock does not show change nothing', () => {
    const state = markOpened(threeTabs(), 'a', sh1);
    expect(shellExited(state, sh2, null)).toBe(state);
  });

  it('restart returns a stopped tab to opening, in the same folder and tab position', () => {
    const stopped = shellExited(markOpened(threeTabs(), 'a', sh1), sh1, null);
    const restarting = markRestarting(stopped, 'a');
    expect(restarting.tabs[0]).toEqual({ key: 'a', cwd: '/repo/api', label: 'api', shellId: null, status: 'opening' });
    expect(restarting.tabs.map((t) => t.key)).toEqual(['a', 'b', 'c']);
  });

  it('a running tab cannot be restarted', () => {
    const tab = markOpened(threeTabs(), 'a', sh1).tabs[0];
    expect(tab && canRestart(tab)).toBe(false);
  });
});

describe('helpers', () => {
  it('names a tab after its folder, for both path separators', () => {
    expect(folderName('/Users/me/code/api-server')).toBe('api-server');
    expect(folderName('C:\\code\\api-server\\')).toBe('api-server');
    expect(folderName('/repo/api/')).toBe('api');
  });

  it('sizes the terminal to whole character cells, at least one of each', () => {
    expect(terminalSize(800, 380, { width: 8, height: 19.2 })).toEqual({ cols: 100, rows: 19 });
    expect(terminalSize(3, 3, { width: 8, height: 19.2 })).toEqual({ cols: 1, rows: 1 });
    expect(terminalSize(800, 380, { width: 0, height: 19.2 })).toEqual({ cols: 1, rows: 1 });
  });
});
