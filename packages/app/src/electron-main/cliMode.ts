import { spawn } from 'node:child_process';
import { join } from 'node:path';

/**
 * INS-03: the AppImage wrapper runs `<AppImage> --cli <args>`. Re-run this executable as Node on the
 * bundled CLI (the same entry the bin/orch launcher uses, INS-02), so every command behaves the same.
 */
export function cliModeArgs(argv: readonly string[], appRoot: string): string[] | null {
  if (argv[1] !== '--cli') return null;
  return [join(appRoot, 'dist', 'orch.js'), ...argv.slice(2)];
}

export function runCliMode(execPath: string, args: readonly string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(execPath, args, { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    child.on('error', () => resolve(1));
    child.on('exit', (code) => resolve(code ?? 1));
  });
}
