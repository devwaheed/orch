import { runCli } from '../../../cli/src/node/cli.js';

/** INS-03: AppImage forwards terminal commands through the app with --cli. */
export async function runCliMode(
  argv: readonly string[],
  run: (args: string[]) => Promise<number> = (args) => runCli(args),
): Promise<number | null> {
  if (argv[1] !== '--cli') return null;
  return run(['node', 'orch', ...argv.slice(2)]);
}
