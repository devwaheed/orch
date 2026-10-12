/**
 * Headless entry: the core host as a plain Node process (`orch serve`). Usage:
 *   node coreHost.js [--claude-bin <path>] [--codex-bin|--gemini-bin|--opencode-bin|--agy-bin <path>]
 * The home folder is os.homedir(). The engine host is forked as a child process.
 */
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forwardedEngineArgs } from './argv.js';
import { startCoreHost } from './coreHostMain.js';

function siblingHost(name: string): string {
  const sourceEntry = process.argv[1]?.endsWith('.ts') ?? false;
  const extension = sourceEntry ? '.ts' : '.cjs';
  return join(dirname(resolve(process.argv[1] ?? process.cwd())), `${name}${extension}`);
}

function childExecArgv(): string[] {
  if (!process.argv[1]?.endsWith('.ts')) return [];
  return ['--import', fileURLToPath(new URL('../../test/support/source-ts-loader.mjs', import.meta.url))];
}

const host = await startCoreHost({
  home: homedir(),
  baseEnv: Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
  engine: {
    entry: siblingHost('engineHost'),
    args: forwardedEngineArgs(process.argv),
    execArgv: childExecArgv(),
  },
  pty: {
    entry: siblingHost('ptyHost'),
    args: [],
    execArgv: childExecArgv(),
  },
});

const stop = (): void => {
  void host.dispose().finally(() => process.exit(0));
};
process.stdout.write(`orch listening on ${host.socketPath}\n`);
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
