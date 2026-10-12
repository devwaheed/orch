import { describe, expect, it } from 'vitest';
import { RunId } from '@orchagents/contracts';
import { EMPTY_PANE_STATE, initialPaneState, paneReducer, type PaneState } from './paneState.js';

const r = (id: string) => RunId.parse(id);
const R2 = r('r-02');
const R3 = r('r-03');
const R4 = r('r-04');

describe('initialPaneState', () => {
  it('matches the prototype work arrangement only in demo mode', () => {
    expect(initialPaneState(true)).toEqual({
      tabsA: [r('r-02'), r('r-01'), r('r-03')],
      tabsB: [r('r-04'), r('r-05')],
      activeA: r('r-02'),
      activeB: r('r-04'),
      split: true,
      focused: 'B',
    });
    expect(initialPaneState(false)).toEqual(EMPTY_PANE_STATE);
  });

  it('restores the exact demo arrangement after prior tab activation and shell split sync', () => {
    const seed = initialPaneState(true);
    const changed = paneReducer(seed, { type: 'select', pane: 'A', runId: r('r-03') });
    const splitSynced = paneReducer(changed, { type: 'setSplit', split: true });

    expect(paneReducer(splitSynced, { type: 'resetDemo' })).toEqual(seed);
  });
});

function run(actions: Parameters<typeof paneReducer>[1][]): PaneState {
  return actions.reduce<PaneState>((state, action) => paneReducer(state, action), EMPTY_PANE_STATE);
}

describe('paneReducer open', () => {
  it('opens a run in the left group and activates it', () => {
    const state = run([{ type: 'open', runId: R2 }]);
    expect(state.tabsA).toEqual([R2]);
    expect(state.activeA).toBe(R2);
    expect(state.split).toBe(false);
  });

  it('does not duplicate a tab that is already open', () => {
    const state = run([
      { type: 'open', runId: R2 },
      { type: 'open', runId: R3 },
      { type: 'open', runId: R2 },
    ]);
    expect(state.tabsA).toEqual([R2, R3]);
    expect(state.activeA).toBe(R2);
  });

  it('focuses a run that is already open in the right group', () => {
    // Opening R3 last makes it active, so the split moves R2 (the first non-active tab) right.
    const split = run([
      { type: 'open', runId: R2 },
      { type: 'open', runId: R3 },
      { type: 'toggleSplit' },
    ]);
    expect(split.tabsB).toEqual([R2]);
    const state = paneReducer(split, { type: 'open', runId: R2 });
    expect(state.activeB).toBe(R2);
    expect(state.focused).toBe('B');
    expect(state.tabsA).toEqual([R3]);
  });
});

describe('paneReducer split', () => {
  it('does nothing with a single tab', () => {
    const state = run([{ type: 'open', runId: R2 }, { type: 'toggleSplit' }]);
    expect(state.split).toBe(false);
    expect(state.tabsB).toEqual([]);
  });

  it('moves the first non-active tab to the right group when split is turned on', () => {
    const state = run([
      { type: 'open', runId: R2 },
      { type: 'open', runId: R3 },
      { type: 'open', runId: R4 },
      { type: 'toggleSplit' },
    ]);
    expect(state.split).toBe(true);
    expect(state.tabsA).toEqual([R3, R4]);
    expect(state.tabsB).toEqual([R2]);
    expect(state.activeB).toBe(R2);
    expect(state.focused).toBe('B');
  });

  it('joins the right group back into the left when split is turned off', () => {
    const state = run([
      { type: 'open', runId: R2 },
      { type: 'open', runId: R3 },
      { type: 'toggleSplit' },
      { type: 'toggleSplit' },
    ]);
    expect(state.split).toBe(false);
    expect(state.tabsA).toEqual([R3, R2]);
    expect(state.tabsB).toEqual([]);
    expect(state.activeB).toBeNull();
    expect(state.activeA).toBe(R3);
  });

  it('applies the shell split flag, and ignores a request that cannot split', () => {
    const one = run([{ type: 'open', runId: R2 }, { type: 'setSplit', split: true }]);
    expect(one.split).toBe(false);
    const two = run([
      { type: 'open', runId: R2 },
      { type: 'open', runId: R3 },
      { type: 'setSplit', split: true },
    ]);
    expect(two.split).toBe(true);
    expect(paneReducer(two, { type: 'setSplit', split: false }).split).toBe(false);
  });
});

describe('paneReducer close', () => {
  it('moves the active left tab to the next tab when the active one closes', () => {
    const state = run([
      { type: 'open', runId: R2 },
      { type: 'open', runId: R3 },
      { type: 'close', pane: 'A', runId: R3 },
    ]);
    expect(state.tabsA).toEqual([R2]);
    expect(state.activeA).toBe(R2);
  });

  it('leaves no active tab when the last left tab closes', () => {
    const state = run([{ type: 'open', runId: R2 }, { type: 'close', pane: 'A', runId: R2 }]);
    expect(state.tabsA).toEqual([]);
    expect(state.activeA).toBeNull();
  });

  it('closes the split when the last right tab closes', () => {
    const state = run([
      { type: 'open', runId: R2 },
      { type: 'open', runId: R3 },
      { type: 'toggleSplit' },
      { type: 'close', pane: 'B', runId: R2 },
    ]);
    expect(state.split).toBe(false);
    expect(state.tabsB).toEqual([]);
    expect(state.activeB).toBeNull();
    expect(state.tabsA).toEqual([R3]);
  });

  it('keeps the split and moves the right active tab when one of several right tabs closes', () => {
    const split: PaneState = { ...EMPTY_PANE_STATE, tabsA: [R2], tabsB: [R3, R4], activeB: R3, split: true };
    const state = paneReducer(split, { type: 'close', pane: 'B', runId: R3 });
    expect(state.split).toBe(true);
    expect(state.tabsB).toEqual([R4]);
    expect(state.activeB).toBe(R4);
  });

  it('ignores a close for a tab the group does not have', () => {
    const state = run([{ type: 'open', runId: R2 }]);
    expect(paneReducer(state, { type: 'close', pane: 'B', runId: R3 })).toBe(state);
  });
});

describe('paneReducer focus and select', () => {
  it('records which group has focus and selects a tab in it', () => {
    const state = run([
      { type: 'open', runId: R2 },
      { type: 'open', runId: R3 },
      { type: 'select', pane: 'A', runId: R2 },
    ]);
    expect(state.activeA).toBe(R2);
    expect(state.focused).toBe('A');
    expect(paneReducer(state, { type: 'focus', pane: 'B' }).focused).toBe('B');
  });

  it('ignores a select for a run the group does not show', () => {
    const state = run([{ type: 'open', runId: R2 }]);
    expect(paneReducer(state, { type: 'select', pane: 'A', runId: R4 })).toBe(state);
  });
});
