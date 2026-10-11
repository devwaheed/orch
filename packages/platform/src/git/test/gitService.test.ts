import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitService, runGit } from '../node/gitService.js';

let tempDir: string;
let repoDir: string;
let git: GitService;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'orch-git-test-'));
  repoDir = path.join(tempDir, 'repo');
  fs.mkdirSync(repoDir, { recursive: true });

  await runGit(['init', '-b', 'main', repoDir]);
  await runGit(['-C', repoDir, 'config', 'user.name', 'Test']);
  await runGit(['-C', repoDir, 'config', 'user.email', 'test@example.com']);
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# Initial\n', 'utf8');
  await runGit(['-C', repoDir, 'add', 'README.md']);
  await runGit(['-C', repoDir, 'commit', '-m', 'Initial commit']);

  git = new GitService();
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('GitService', () => {
  it('ensureExclude adds .orch/ to .git/info/exclude without editing .gitignore', async () => {
    const res = await git.ensureExclude(repoDir);
    expect(res.ok).toBe(true);

    const excludeFile = path.join(repoDir, '.git', 'info', 'exclude');
    expect(fs.existsSync(excludeFile)).toBe(true);
    const content = fs.readFileSync(excludeFile, 'utf8');
    expect(content).toContain('.orch/');

    // Calling ensureExclude again is idempotent
    const res2 = await git.ensureExclude(repoDir);
    expect(res2.ok).toBe(true);
    const content2 = fs.readFileSync(excludeFile, 'utf8');
    expect(content2.match(/\.orch\//g)?.length).toBe(1);

    // .gitignore must not exist
    expect(fs.existsSync(path.join(repoDir, '.gitignore'))).toBe(false);
  });

  it('getDefaultBranch returns the default branch name', async () => {
    const res = await git.getDefaultBranch(repoDir);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toBe('main');
  });

  it('createWorktree creates .orch/wt/<run-id> and branch orch/<run-id>', async () => {
    const runId = 'r-1';
    const res = await git.createWorktree({ repoPath: repoDir, runId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.value.worktreePath).toBe(path.join(repoDir, '.orch', 'wt', runId));
    expect(res.value.branch).toBe(`orch/${runId}`);
    expect(fs.existsSync(res.value.worktreePath)).toBe(true);

    // Verify branch in worktree
    const { stdout } = await runGit(['-C', res.value.worktreePath, 'branch', '--show-current']);
    expect(stdout.trim()).toBe(`orch/${runId}`);

    // Verify exclude was added
    const excludeContent = fs.readFileSync(path.join(repoDir, '.git', 'info', 'exclude'), 'utf8');
    expect(excludeContent).toContain('.orch/');
  });

  it('getChangedFiles and getDiff reflect changes made in the worktree', async () => {
    const runId = 'r-2';
    const wtRes = await git.createWorktree({ repoPath: repoDir, runId });
    expect(wtRes.ok).toBe(true);
    if (!wtRes.ok) return;

    const wt = wtRes.value.worktreePath;
    fs.appendFileSync(path.join(wt, 'README.md'), 'Second line\n', 'utf8');
    fs.writeFileSync(path.join(wt, 'newfile.txt'), 'hello\nworld\n', 'utf8');

    const filesRes = await git.getChangedFiles(wt, 'main');
    expect(filesRes.ok).toBe(true);
    if (!filesRes.ok) return;

    const paths = filesRes.value.map((f) => f.path);
    expect(paths).toContain('README.md');
    expect(paths).toContain('newfile.txt');

    const diffRes = await git.getDiff(wt, 'main', 'README.md');
    expect(diffRes.ok).toBe(true);
    if (!diffRes.ok) return;
    expect(diffRes.value).toContain('+Second line');
  });

  it('removeWorktree deletes worktree directory and branch when deleteBranch=true', async () => {
    const runId = 'r-3';
    const wtRes = await git.createWorktree({ repoPath: repoDir, runId });
    expect(wtRes.ok).toBe(true);

    const rmRes = await git.removeWorktree({ repoPath: repoDir, runId, deleteBranch: true });
    expect(rmRes.ok).toBe(true);

    expect(fs.existsSync(path.join(repoDir, '.orch', 'wt', runId))).toBe(false);
    const { stdout } = await runGit(['-C', repoDir, 'branch', '--list', `orch/${runId}`]);
    expect(stdout.trim()).toBe('');
  });
});
