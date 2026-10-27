/**
 * SaaS Factory status (contracts.FactoryStatus). orch runs the factory's own
 * `scripts/factory-status.mjs --json` and validates its output; it never
 * re-implements the factory's rules.
 *
 * A project is a factory product when it has a brief or a `.factory/` folder.
 * The script is looked up where each agent's plugin cache installs the factory
 * (devwaheed/saas-factory); it must be installed with npx github:devwaheed/saas-factory.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { err, ok } from '@orchagents/base';
import {
  FactoryStatus as FactoryStatusSchema,
  type FactoryStatus,
  type Result,
} from '@orchagents/contracts';
import type { CommandRunner } from '../../queue/node/specMerge.js';

/** The status script must answer within 90 s. */
export const FACTORY_TIMEOUT_MS = 90_000;

const SCRIPT_NAME = path.join('scripts', 'factory-status.mjs');

export interface FactoryStatusOptions {
  /** The command runner (injected, because spawning is limited to shells/adapters/git/engine). */
  readonly commandRunner: CommandRunner;
  /** Overrides os.homedir(); only tests inject a home. */
  readonly home?: string | undefined;
}

const NOT_INSTALLED = {
  code: 'not_found' as const,
  message: 'SaaS Factory isn’t installed.',
  fix: 'Install it with npx github:devwaheed/saas-factory, then reopen the project.',
};

const readFailed = (script: string, repoPath: string) => ({
  code: 'internal' as const,
  message: 'SaaS Factory couldn’t read this project.',
  fix: `Run node ${script} ${repoPath} --json in a terminal to see the error.`,
});

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

/** Descending semver compare: 1.10.0 sorts before 1.2.0 */
function compareVersionsDesc(a: string, b: string): number {
  const pa = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return -diff;
  }
  return b.localeCompare(a);
}

/**
 * The scripts/factory-status.mjs of the highest installed version inside an
 * agent's plugin cache, or null when that cache has no installed factory.
 */
async function highestVersionScript(baseDir: string): Promise<string | null> {
  let entries;
  try {
    entries = await fs.readdir(baseDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const versions = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareVersionsDesc);
  for (const version of versions) {
    const script = path.join(baseDir, version, SCRIPT_NAME);
    if (await pathExists(script)) return script;
  }
  return null;
}

/**
 * The factory script, first match wins: the claude and codex plugin caches
 * (one folder per version), then the gemini and opencode flat folders.
 */
export async function findFactoryScript(home: string): Promise<string | null> {
  for (const agentDir of ['.claude', '.codex']) {
    const script = await highestVersionScript(
      path.join(home, agentDir, 'plugins', 'cache', 'saas-factory', 'saas-factory'),
    );
    if (script) return script;
  }
  const flat = [
    path.join(home, '.gemini', 'config', 'plugins', 'saas-factory', SCRIPT_NAME),
    path.join(home, '.config', 'opencode', 'plugins', 'saas-factory', SCRIPT_NAME),
  ];
  for (const file of flat) {
    if (await pathExists(file)) return file;
  }
  return null;
}

/**
 * Reads the SaaS Factory status of the project (services.ts ISpecsService.factoryStatus).
 * Null when the project is not a factory product; not_found when the factory isn't
 * installed; internal when the factory's own script could not answer. Never throws.
 */
export async function readFactoryStatus(
  repoPath: string,
  options: FactoryStatusOptions,
): Promise<Result<FactoryStatus | null>> {
  const home = options.home ?? os.homedir();

  // 1. Factory product check — cheap, before any process starts.
  const isProduct =
    (await pathExists(path.join(repoPath, 'docs', '00-brief.md'))) ||
    (await pathExists(path.join(repoPath, '00-brief.md'))) ||
    (await pathExists(path.join(repoPath, '.factory')));
  if (!isProduct) return ok(null);

  // 2. Find the factory's own script.
  const script = await findFactoryScript(home);
  if (!script) return err(NOT_INSTALLED);

  const readFailedRes = err(readFailed(script, repoPath));

  // 3. Run it (argument array, no shell). process.execPath plus
  //    ELECTRON_RUN_AS_NODE also works when the packaged app has no node on PATH.
  let run: { exitCode: number; stdout: string; stderr: string };
  try {
    run = await options.commandRunner(process.execPath, [script, repoPath, '--json'], {
      cwd: repoPath,
      timeoutMs: FACTORY_TIMEOUT_MS,
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
  } catch {
    return readFailedRes;
  }
  if (run.exitCode !== 0) return readFailedRes;

  // 4. Parse and validate the stdout JSON; the schema drops unknown fields.
  let parsed: unknown;
  try {
    parsed = JSON.parse(run.stdout);
  } catch {
    return readFailedRes;
  }
  const parsedRes = FactoryStatusSchema.safeParse(parsed);
  if (!parsedRes.success) return readFailedRes;
  return ok(parsedRes.data);
}
