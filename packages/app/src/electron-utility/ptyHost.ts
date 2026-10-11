/**
 * Electron utility-process and child-process entry for the PTY host (ADR 0006).
 * All logic is shared with the Node entry in ../node/ptyHostMain.ts.
 */
import fs from 'node:fs';
import type { Os } from '@orch/contracts';
import type { ShellPort } from '@orch/platform/src/shells/common/shells.js';
import { readFlag } from '../node/argv.js';
import { HOST_READY_MESSAGE } from '../node/hostReady.js';
import { runPtyHost, type PtyHostOptions, type RunningPtyHost } from '../node/ptyHostMain.js';

// node-pty's ensureSpawnHelperExecutable checks helperPath inside app.asar.
// In Electron, app.asar is a virtual archive where stat mode does not reflect
// the execute bit of unpacked binaries and chmod throws ENOTDIR.
// Redirect statSync and chmodSync to app.asar.unpacked where the executable helper actually lives.
const origStatSync = fs.statSync;
const patchedStatSync: typeof fs.statSync = ((path: fs.PathLike, options?: Parameters<typeof fs.statSync>[1]) => {
  if (typeof path === 'string' && path.includes('app.asar') && !path.includes('app.asar.unpacked')) {
    const unpacked = path.replace('app.asar', 'app.asar.unpacked');
    if (fs.existsSync(unpacked)) {
      return origStatSync(unpacked, options);
    }
  }
  return origStatSync(path, options);
}) as typeof fs.statSync;
fs.statSync = patchedStatSync;

const origChmodSync = fs.chmodSync;
const patchedChmodSync: typeof fs.chmodSync = ((path: fs.PathLike, mode: fs.Mode) => {
  if (typeof path === 'string' && path.includes('app.asar') && !path.includes('app.asar.unpacked')) {
    const unpacked = path.replace('app.asar', 'app.asar.unpacked');
    if (fs.existsSync(unpacked)) {
      return origChmodSync(unpacked, mode);
    }
  }
  return origChmodSync(path, mode);
}) as typeof fs.chmodSync;
fs.chmodSync = patchedChmodSync;

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
  options: PtyHostOptions,
): Promise<RunningPtyHost> {
  return runPtyHost({
    ...options,
    port: portFromParentPort(parentPort),
  });
}

function osFromPlatform(): Os {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  return 'linux';
}

const flagOs = readFlag(process.argv, 'os');
const os: Os = flagOs === 'macos' || flagOs === 'linux' || flagOs === 'windows' ? flagOs : osFromPlatform();

const baseEnv: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) baseEnv[key] = value;
}

const parentPort = (process as unknown as { parentPort?: ParentPortLike & { postMessage(message: unknown): void } })
  .parentPort;

void (async () => {
  if (typeof process.send === 'function') {
    // Child process mode with Node IPC (forked by core host PtyHostChild)
    const port: ShellPort = {
      postMessage: (message) => {
        process.send?.(message);
      },
      on: (_event, listener) => {
        process.on('message', listener);
        return undefined;
      },
      close: () => undefined,
    };
    const started = await runPtyHost({ port, baseEnv, os });
    process.on('disconnect', () => {
      void started.stop().finally(() => process.exit(0));
    });
  } else if (parentPort) {
    // Electron utility process mode
    await startPtyUtility(parentPort, { baseEnv, os, port: portFromParentPort(parentPort) });
    parentPort.postMessage(HOST_READY_MESSAGE);
  }
})();