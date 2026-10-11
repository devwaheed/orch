/**
 * Headless entry: the core host as a plain Node process (`orch serve`). Usage:
 *   node coreHost.js [--claude-bin <path>] [--codex-bin|--gemini-bin|--opencode-bin|--agy-bin <path>]
 * The home folder is os.homedir(). The engine host is forked as a child process.
 */
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { forwardedEngineArgs } from './argv.js';
import { startCoreHost } from './coreHostMain.js';

const host = await startCoreHost({
  home: homedir(),
  baseEnv: Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
  engine: {
    entry: fileURLToPath(new URL('./engineHost.js', import.meta.url)),
    args: forwardedEngineArgs(process.argv),
  },
});

const stop = (): void => {
  void host.dispose().finally(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
