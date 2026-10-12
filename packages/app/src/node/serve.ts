/** `orch serve`: the core host in this process, with the engine and PTY hosts as children next to this file. */
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { forwardedEngineArgs } from './argv.js';
import { startCoreHost } from './coreHostMain.js';

function baseEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

function childExecArgv(): string[] {
  if (!process.argv[1]?.endsWith('.ts')) return [];
  return ['--import', fileURLToPath(new URL('../../test/support/source-ts-loader.mjs', import.meta.url))];
}

export async function runHeadlessServe(): Promise<number> {
  const hostExtension = process.argv[1]?.endsWith('.ts') ? '.ts' : '.cjs';
  const host = await startCoreHost({
    home: homedir(),
    baseEnv: baseEnv(),
    engine: {
      entry: fileURLToPath(new URL(`./engineHost${hostExtension}`, import.meta.url)),
      args: forwardedEngineArgs(process.argv),
      execArgv: childExecArgv(),
    },
    pty: {
      entry: fileURLToPath(new URL(`./ptyHost${hostExtension}`, import.meta.url)),
      args: [],
      execArgv: childExecArgv(),
    },
  });

  process.stdout.write(`orch listening on ${host.socketPath}\n`);
  return new Promise<number>((resolve) => {
    const stop = (): void => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      void host.dispose().then(() => resolve(0));
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
}
