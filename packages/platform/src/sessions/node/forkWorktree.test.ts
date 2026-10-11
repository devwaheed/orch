/**
 * SES-03 fork: the new branch starts from the source worktree's current state,
 * uncommitted edits included, and the source is left as it was. Real git in a temp repo.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runGit } from '../../git/node/gitService.js';
import { GitSessionWorktrees } from './forkWorktree.js';

let root: string;
let repo: string;
let source: string;

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'orch-fork-test-'));
  repo = path.join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  await runGit(['init', '-b', 'main', repo]);
  await runGit(['-C', repo, 'config', 'user.name', 'Test']);
  await runGit(['-C', repo, 'config', 'user.email', 'test@example.com']);
  writeFileSync(path.join(repo, 'a.txt'), 'committed\n', 'utf8');
  await runGit(['-C', repo, 'add', '.']);
  await runGit(['-C', repo, 'commit', '-m', 'Initial commit']);
  source = path.join(repo, '.orch', 'wt', 'r-1');
  await runGit(['-C', repo, 'worktree', 'add', '-b', 'orch/r-1', source, 'HEAD']);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('GitSessionWorktrees.fork (SES-03)', () => {
  it('copies uncommitted edits and new files into the fork, and leaves the source unchanged', async () => {
    writeFileSync(path.join(source, 'a.txt'), 'edited but not committed\n', 'utf8');
    mkdirSync(path.join(source, 'src'), { recursive: true });
    writeFileSync(path.join(source, 'src', 'new.txt'), 'new file\n', 'utf8');

    const forked = await new GitSessionWorktrees().fork(source, 'orch/r-1-fork-1');

    expect(forked.ok).toBe(true);
    if (!forked.ok) return;
    expect(forked.value.path).toBe(path.join(repo, '.orch', 'wt', 'r-1-fork-1'));
    expect(readFileSync(path.join(forked.value.path, 'a.txt'), 'utf8')).toBe('edited but not committed\n');
    expect(readFileSync(path.join(forked.value.path, 'src', 'new.txt'), 'utf8')).toBe('new file\n');
    expect(readFileSync(path.join(source, 'a.txt'), 'utf8')).toBe('edited but not committed\n');
  });

  it('a clean source forks at its commit with no extra changes', async () => {
    const forked = await new GitSessionWorktrees().fork(source, 'orch/r-1-fork-2');
    expect(forked.ok).toBe(true);
    if (!forked.ok) return;
    expect(readFileSync(path.join(forked.value.path, 'a.txt'), 'utf8')).toBe('committed\n');
    const status = await runGit(['-C', forked.value.path, 'status', '--porcelain']);
    expect(status.stdout.trim()).toBe('');
  });
});
