/**
 * Command-line helpers shared by the headless entries. Kept free of engine
 * imports so the core host can read flags without loading Claw (ENG-02).
 */

/** Binary overrides for the agents other than Claude Code. */
export type EngineAgentBins = Readonly<Partial<Record<'codex' | 'gemini' | 'opencode' | 'agy', string>>>;

/** Command-line flags for each agent binary override (e.g. --codex-bin). */
export const AGENT_BIN_FLAGS = {
  codex: 'codex-bin',
  gemini: 'gemini-bin',
  opencode: 'opencode-bin',
  agy: 'agy-bin',
} as const satisfies Record<keyof EngineAgentBins, string>;

/** Reads `--name value` pairs from argv. Returns undefined for a missing flag. */
export function readFlag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

/** Collects every agent binary flag present in argv. */
export function readAgentBins(argv: readonly string[]): EngineAgentBins {
  const bins: Record<string, string> = {};
  for (const [agent, flag] of Object.entries(AGENT_BIN_FLAGS)) {
    const bin = readFlag(argv, flag);
    if (bin) bins[agent] = bin;
  }
  return bins;
}

/** The engine flags present in argv, to forward to the engine host child (binary overrides for tests). */
export function forwardedEngineArgs(argv: readonly string[]): string[] {
  const args: string[] = [];
  for (const flag of ['claude-bin', ...Object.values(AGENT_BIN_FLAGS)]) {
    const value = readFlag(argv, flag);
    if (value) args.push(`--${flag}`, value);
  }
  return args;
}
