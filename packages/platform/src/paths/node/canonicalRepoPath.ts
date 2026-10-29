import { realpath } from 'node:fs/promises';
import * as path from 'node:path';

const canonicalPaths = new Map<string, Promise<string>>();

/** Resolve a repository path and collapse symlinks when the target exists. */
export async function canonicalRepoPath(repoPath: string): Promise<string> {
  const resolved = path.resolve(repoPath);
  try {
    return await realpath(resolved);
  } catch {
    return resolved;
  }
}

/** Compare repository paths after resolving duplicate separators and symlinks. */
export async function sameRepo(a: string, b: string): Promise<boolean> {
  const canonical = (repoPath: string): Promise<string> => {
    let result = canonicalPaths.get(repoPath);
    if (!result) {
      result = canonicalRepoPath(repoPath);
      canonicalPaths.set(repoPath, result);
    }
    return result;
  };
  const [canonicalA, canonicalB] = await Promise.all([canonical(a), canonical(b)]);
  return canonicalA === canonicalB;
}
