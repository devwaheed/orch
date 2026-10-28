/**
 * Picks the "Done when" command presets for a repo from the files at its root.
 * Pure: the node reader fills `RepoCheckFiles`, so every ecosystem rule is
 * testable without touching disk. Kept in the same order as the New spec form.
 */

/** The repo-root files the preset scan reads. null means the file is not there. */
export interface RepoCheckFiles {
  readonly packageJson: string | null;
  /** Lockfile names present at the repo root, e.g. pnpm-lock.yaml. */
  readonly lockfiles: readonly string[];
  readonly pyprojectToml: string | null;
  readonly pytestIni: string | null;
  readonly cargoToml: string | null;
  readonly goMod: string | null;
  readonly makefile: string | null;
}

const SCRIPT_ORDER = ['test', 'lint', 'typecheck', 'build'] as const;

type PackageManager = 'pnpm' | 'yarn' | 'bun' | 'npm';

/** The repo's command presets, in form order. Empty when no known ecosystem is present. */
export function detectCheckPresets(files: RepoCheckFiles): string[] {
  const presets: string[] = [];
  const scripts = packageScripts(files.packageJson);
  if (scripts.size > 0) {
    const manager = packageManager(files.lockfiles);
    for (const script of SCRIPT_ORDER) {
      if (scripts.has(script)) presets.push(scriptCommand(manager, script));
    }
  }
  if (files.pyprojectToml !== null || files.pytestIni !== null) presets.push('pytest');
  if (files.cargoToml !== null) presets.push('cargo test');
  if (files.goMod !== null) presets.push('go test ./...');
  if (files.makefile !== null && /^test[ \t]*:(?!=)/m.test(files.makefile)) presets.push('make test');
  return presets;
}

/** The package.json scripts we offer, as names. Bad JSON or no scripts means none. */
function packageScripts(source: string | null): Set<string> {
  if (source === null) return new Set();
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return new Set();
  }
  if (!isRecord(parsed) || !isRecord(parsed.scripts)) return new Set();
  const scripts = parsed.scripts;
  return new Set(
    SCRIPT_ORDER.filter((name) => typeof scripts[name] === 'string'),
  );
}

/** Lockfile wins: pnpm, then yarn, then bun, else npm. */
function packageManager(lockfiles: readonly string[]): PackageManager {
  if (lockfiles.includes('pnpm-lock.yaml')) return 'pnpm';
  if (lockfiles.includes('yarn.lock')) return 'yarn';
  if (lockfiles.includes('bun.lockb')) return 'bun';
  return 'npm';
}

function scriptCommand(manager: PackageManager, script: string): string {
  if (manager === 'npm') return script === 'test' ? 'npm test' : `npm run ${script}`;
  if (manager === 'bun') return `bun run ${script}`;
  return `${manager} ${script}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
