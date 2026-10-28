/**
 * Reads the repo-root files the New spec check presets need. Best effort: a
 * missing or unreadable file just means that ecosystem isn't offered.
 */
import { access, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { detectCheckPresets, type RepoCheckFiles } from '../common/checkPresets.js';

const LOCKFILES = ['pnpm-lock.yaml', 'yarn.lock', 'bun.lockb'] as const;

async function readOptional(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** The files the pure detector takes, read from one repo root. */
export async function readRepoCheckFiles(repoPath: string): Promise<RepoCheckFiles> {
  const [packageJson, pyprojectToml, pytestIni, cargoToml, goMod, makefile, lockfiles] = await Promise.all([
    readOptional(path.join(repoPath, 'package.json')),
    readOptional(path.join(repoPath, 'pyproject.toml')),
    readOptional(path.join(repoPath, 'pytest.ini')),
    readOptional(path.join(repoPath, 'Cargo.toml')),
    readOptional(path.join(repoPath, 'go.mod')),
    readOptional(path.join(repoPath, 'Makefile')),
    Promise.all(
      LOCKFILES.map(async (name) => ((await exists(path.join(repoPath, name))) ? name : null)),
    ),
  ]);
  return {
    packageJson,
    lockfiles: lockfiles.filter((name): name is (typeof LOCKFILES)[number] => name !== null),
    pyprojectToml,
    pytestIni,
    cargoToml,
    goMod,
    makefile,
  };
}

/** The command presets the New spec form offers for this repo. Empty means "use the fallback". */
export async function readRepoCheckPresets(repoPath: string): Promise<string[]> {
  return detectCheckPresets(await readRepoCheckFiles(repoPath));
}
