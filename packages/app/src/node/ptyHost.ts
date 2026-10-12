/**
 * Headless entry: the PTY host as a plain Node child process (ADR 0006).
 * The core host forks this with IPC. Usage:
 *   node ptyHost.js [--os macos|linux|windows]
 * The environment is the one the core host passed to fork.
 */
import type { Os } from '@orchagents/contracts';
import type { ShellPort } from '@orchagents/platform/src/shells/common/shells.js';
import { readFlag } from './argv.js';
import { runPtyHost } from './ptyHostMain.js';

function osFromPlatform(): Os {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  return 'linux';
}

async function main(): Promise<void> {
  const flagOs = readFlag(process.argv, 'os');
  const os: Os = flagOs === 'macos' || flagOs === 'linux' || flagOs === 'windows' ? flagOs : osFromPlatform();

  const baseEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) baseEnv[key] = value;
  }

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

  // The core host owns our lifetime: when its channel closes, stop cleanly.
  process.on('disconnect', () => {
    void started.stop().finally(() => process.exit(0));
  });
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
