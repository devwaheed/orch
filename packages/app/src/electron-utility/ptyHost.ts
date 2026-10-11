/**
 * Electron utility-process entry for the PTY host (ADR 0006). Electron's
 * parentPort is passed in, so this file compiles without electron installed; the
 * app's main process wires the real parentPort when it starts the utility.
 * All logic is shared with the Node entry in ../node/ptyHostMain.ts.
 */
import type { ShellPort } from '@orch/platform/src/shells/common/shells.js';
import { runPtyHost, type PtyHostOptions, type RunningPtyHost } from '../node/ptyHostMain.js';

/** The part of Electron's parentPort this entry uses. */
export interface ParentPortLike {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
}

export function portFromParentPort(parentPort: ParentPortLike): ShellPort {
  return {
    postMessage: (message) => parentPort.postMessage(message),
    on: (_event, listener) => {
      parentPort.on('message', (event) => listener(event.data));
      return undefined;
    },
    close: () => {
      // Electron utility process parentPort doesn't have a close method
      // The process exits when the main process kills it
    },
  };
}

export async function startPtyUtility(
  parentPort: ParentPortLike,
  options: PtyHostOptions
): Promise<RunningPtyHost> {
  return runPtyHost({
    ...options,
    port: portFromParentPort(parentPort),
  });
}