/**
 * Reads and writes the window state file. The file lives in ~/.orch (ENG-03's
 * folder for app data), as window-state.json. Failures are logged and ignored:
 * a missing or broken file just means the default window.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EMPTY_WINDOW_STATE, parseWindowState, type WindowState } from './windowBounds.js';

export const WINDOW_STATE_FILE = 'window-state.json';

export function windowStatePath(orchRoot: string): string {
  return join(orchRoot, WINDOW_STATE_FILE);
}

export async function loadWindowState(orchRoot: string): Promise<WindowState> {
  try {
    return parseWindowState(JSON.parse(await readFile(windowStatePath(orchRoot), 'utf8')));
  } catch {
    return EMPTY_WINDOW_STATE;
  }
}

export async function saveWindowState(orchRoot: string, state: WindowState): Promise<void> {
  try {
    await mkdir(orchRoot, { recursive: true, mode: 0o700 });
    await writeFile(windowStatePath(orchRoot), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  } catch {
    // Not saving the window position is not worth a crash.
  }
}
