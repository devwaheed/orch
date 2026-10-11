import { describe, expect, it } from 'vitest';
import {
  EMPTY_WINDOW_STATE,
  WINDOW_MIN_HEIGHT,
  WINDOW_MIN_WIDTH,
  defaultBounds,
  displayKey,
  fitToWorkArea,
  parseWindowState,
  planRestore,
  rememberBounds,
  type DisplayInfo,
} from './windowBounds.js';

const laptop: DisplayInfo = { key: 'laptop', workArea: { x: 0, y: 25, width: 1440, height: 875 } };
const external: DisplayInfo = { key: 'external', workArea: { x: 1440, y: 0, width: 2560, height: 1400 } };

describe('UI-04 window bounds', () => {
  it('never opens smaller than 1100 x 700', () => {
    expect(WINDOW_MIN_WIDTH).toBe(1100);
    expect(WINDOW_MIN_HEIGHT).toBe(700);
    const fitted = fitToWorkArea({ x: 0, y: 0, width: 800, height: 500 }, laptop.workArea);
    expect(fitted.width).toBe(1100);
    expect(fitted.height).toBe(700);
  });

  it('brings a window saved off-screen back into its display', () => {
    const fitted = fitToWorkArea({ x: 5000, y: -300, width: 1200, height: 800 }, laptop.workArea);
    expect(fitted.x).toBe(1440 - 1200);
    expect(fitted.y).toBe(25);
  });

  it('centres the default window on the display when nothing is saved', () => {
    const bounds = defaultBounds(laptop.workArea);
    expect(bounds.width).toBe(1100);
    expect(bounds.height).toBe(700);
    expect(bounds.x).toBe(Math.round((1440 - 1100) / 2));
    expect(bounds.y).toBe(25 + Math.round((875 - 700) / 2));
  });

  it('remembers bounds per display and reopens on the last display', () => {
    let state = EMPTY_WINDOW_STATE;
    state = rememberBounds(state, laptop, { x: 100, y: 80, width: 1200, height: 760 }, false);
    state = rememberBounds(state, external, { x: 1600, y: 100, width: 1500, height: 900 }, true);

    const plan = planRestore(state, [laptop, external], laptop);
    expect(plan.display.key).toBe('external');
    expect(plan.bounds).toEqual({ x: 1600, y: 100, width: 1500, height: 900 });
    expect(plan.maximized).toBe(true);

    // Each display keeps its own remembered bounds.
    const laptopPlan = planRestore({ ...state, lastDisplay: 'laptop' }, [laptop, external], laptop);
    expect(laptopPlan.bounds).toEqual({ x: 100, y: 80, width: 1200, height: 760 });
  });

  it('falls back to the primary display when the last display is gone', () => {
    const state = rememberBounds(EMPTY_WINDOW_STATE, external, { x: 1600, y: 100, width: 1200, height: 800 }, false);
    const plan = planRestore(state, [laptop], laptop);
    expect(plan.display.key).toBe('laptop');
    expect(plan.bounds.x).toBeGreaterThanOrEqual(0);
    expect(plan.bounds.x + plan.bounds.width).toBeLessThanOrEqual(1440);
  });

  it('identifies a display by geometry and scale factor', () => {
    expect(displayKey({ x: 0, y: 0, width: 1440, height: 900 }, 2)).toBe('0,0,1440,900@2');
    expect(displayKey({ x: 0, y: 0, width: 1440, height: 900 }, 2)).not.toBe(
      displayKey({ x: 0, y: 0, width: 1440, height: 900 }, 1),
    );
  });

  it('treats a malformed state file as empty', () => {
    expect(parseWindowState(null)).toEqual(EMPTY_WINDOW_STATE);
    expect(parseWindowState('nope')).toEqual(EMPTY_WINDOW_STATE);
    const parsed = parseWindowState({
      lastDisplay: 'laptop',
      displays: { laptop: { x: 1, y: 2, width: 3, height: 4 }, bad: { x: 'a' } },
    });
    expect(parsed.displays).toEqual({ laptop: { x: 1, y: 2, width: 3, height: 4, maximized: false } });
    expect(parsed.lastDisplay).toBe('laptop');
  });
});
