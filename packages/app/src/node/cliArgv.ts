/** Normalize Node and Electron's run-as-Node argv to the CLI's standard shape. */
export function appCliArgv(argv: readonly string[]): string[] {
  return ['node', 'orch', ...argv.slice(2)];
}
