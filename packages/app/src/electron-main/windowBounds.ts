/**
 * Window size and position per display (UI-04). Pure logic: no Electron imports,
 * so the rules are unit-tested with plain rectangles.
 *
 * A display is identified by its geometry and scale factor, because Electron's
 * display ids change between launches. The window remembers its last bounds on
 * each display, and reopens on the display it was last on when that display is
 * still connected.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** UI-04: the window never gets smaller than this. */
export const WINDOW_MIN_WIDTH = 1100;
export const WINDOW_MIN_HEIGHT = 700;

export interface DisplayInfo {
  readonly key: string;
  readonly workArea: Rect;
}

export interface SavedBounds extends Rect {
  readonly maximized: boolean;
}

export interface WindowState {
  readonly version: 1;
  /** The display key the window was last on. */
  readonly lastDisplay?: string;
  /** Last bounds on each display, keyed by displayKey(). */
  readonly displays: Readonly<Record<string, SavedBounds>>;
}

export const EMPTY_WINDOW_STATE: WindowState = { version: 1, displays: {} };

/** Stable identity for a display: its geometry and scale factor. */
export function displayKey(bounds: Rect, scaleFactor: number): string {
  return `${bounds.x},${bounds.y},${bounds.width},${bounds.height}@${scaleFactor}`;
}

/** Keeps a rectangle inside the work area and at least the minimum size. */
export function fitToWorkArea(rect: Rect, workArea: Rect): Rect {
  const width = Math.min(Math.max(rect.width, WINDOW_MIN_WIDTH), Math.max(workArea.width, WINDOW_MIN_WIDTH));
  const height = Math.min(Math.max(rect.height, WINDOW_MIN_HEIGHT), Math.max(workArea.height, WINDOW_MIN_HEIGHT));
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;
  const x = Math.min(Math.max(rect.x, workArea.x), Math.max(maxX, workArea.x));
  const y = Math.min(Math.max(rect.y, workArea.y), Math.max(maxY, workArea.y));
  return { x, y, width, height };
}

/** The centred default for a display with no saved bounds: the minimum size. */
export function defaultBounds(workArea: Rect): Rect {
  return fitToWorkArea(
    {
      x: workArea.x + Math.round((workArea.width - WINDOW_MIN_WIDTH) / 2),
      y: workArea.y + Math.round((workArea.height - WINDOW_MIN_HEIGHT) / 2),
      width: WINDOW_MIN_WIDTH,
      height: WINDOW_MIN_HEIGHT,
    },
    workArea,
  );
}

export interface RestorePlan {
  readonly bounds: Rect;
  readonly maximized: boolean;
  readonly display: DisplayInfo;
}

/**
 * Where the window opens. Uses the last display when it is still connected,
 * otherwise the primary display. Saved bounds are clamped to that display.
 */
export function planRestore(state: WindowState, displays: readonly DisplayInfo[], primary: DisplayInfo): RestorePlan {
  const display = displays.find((d) => d.key === state.lastDisplay) ?? primary;
  const saved = state.displays[display.key];
  if (!saved) {
    return { bounds: defaultBounds(display.workArea), maximized: false, display };
  }
  return { bounds: fitToWorkArea(saved, display.workArea), maximized: saved.maximized, display };
}

/** Records the window's bounds under the display it is on. Returns a new state. */
export function rememberBounds(
  state: WindowState,
  display: DisplayInfo,
  bounds: Rect,
  maximized: boolean,
): WindowState {
  return {
    version: 1,
    lastDisplay: display.key,
    displays: {
      ...state.displays,
      [display.key]: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, maximized },
    },
  };
}

/** Parses the saved file. Anything malformed becomes an empty state, never a throw. */
export function parseWindowState(raw: unknown): WindowState {
  if (typeof raw !== 'object' || raw === null) return EMPTY_WINDOW_STATE;
  const record = raw as Record<string, unknown>;
  const displays: Record<string, SavedBounds> = {};
  const saved = record.displays;
  if (typeof saved === 'object' && saved !== null) {
    for (const [key, value] of Object.entries(saved as Record<string, unknown>)) {
      const bounds = parseSavedBounds(value);
      if (bounds) displays[key] = bounds;
    }
  }
  const lastDisplay = typeof record.lastDisplay === 'string' ? record.lastDisplay : undefined;
  return lastDisplay === undefined ? { version: 1, displays } : { version: 1, lastDisplay, displays };
}

function parseSavedBounds(value: unknown): SavedBounds | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const numbers = ['x', 'y', 'width', 'height'] as const;
  for (const key of numbers) {
    if (typeof v[key] !== 'number' || !Number.isFinite(v[key])) return null;
  }
  return {
    x: v.x as number,
    y: v.y as number,
    width: v.width as number,
    height: v.height as number,
    maximized: v.maximized === true,
  };
}
