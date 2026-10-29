import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { canonicalRepoPath, sameRepo } from './canonicalRepoPath.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('matches a repository path containing duplicate separators', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orch-canonical-path-'));
  roots.push(root);
  const repo = path.join(root, 'repo');
  await mkdir(repo);

  expect(await canonicalRepoPath(`${root}//repo`)).toBe(await canonicalRepoPath(repo));
  expect(await sameRepo(`${root}//repo`, repo)).toBe(true);
});

it('matches a symlinked repository path to its real path', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orch-canonical-path-'));
  roots.push(root);
  const repo = path.join(root, 'repo');
  const alias = path.join(root, 'alias');
  await mkdir(repo);
  await symlink(repo, alias, 'dir');

  expect(await canonicalRepoPath(alias)).toBe(await canonicalRepoPath(repo));
  expect(await sameRepo(alias, repo)).toBe(true);
});
