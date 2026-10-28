import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { QueueId, SpecId, SpecRun, SpecState } from '@orchagents/contracts';
import { GitService, runGit } from '../../../git/node/gitService.js';
import { getNextSpecToMerge, isReadyToMerge, mergeApprovedSpec } from '../node/specMerge.js';

let tempDir: string | undefined;
afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe('specMerge (SQ-14, SQ-17, SQ-18, §7)', () => {
  const makeSpec = (
    id: string,
    position: number,
    state: SpecState = 'approved',
    dependsOn: string[] = [],
  ): SpecRun => ({
    id: id as SpecId,
    queueId: 'q-test' as QueueId,
    position,
    file: `docs/specs/${id}.md`,
    spec: {
      id,
      title: `Spec ${id}`,
      depends_on: dependsOn,
      scope: [],
      done_when: [{ by: 'audit', text: 'audit' }],
      agent: 'auto',
      mode: 'single',
      agents: [],
    },
    state,
    attempt: 1,
    jobId: null,
    worktree: null,
    implementer: null,
    criteria: [],
    blockedBy: [],
    startedAt: null,
    finishedAt: null,
    tokens: 0,
    history: [],
  });

  describe('isReadyToMerge & getNextSpecToMerge', () => {
    it('returns false if spec is not approved', () => {
      const s = makeSpec('1', 1, 'verified');
      expect(isReadyToMerge(s, [s])).toBe(false);
    });

    it('returns true if spec has no unmerged dependencies', () => {
      const s = makeSpec('1', 1, 'approved');
      expect(isReadyToMerge(s, [s])).toBe(true);
    });

    it('returns false if a dependency is not yet merged', () => {
      const s1 = makeSpec('1', 1, 'approved');
      const s2 = makeSpec('2', 2, 'approved', ['1']);
      expect(isReadyToMerge(s2, [s1, s2])).toBe(false);

      // Once s1 is merged
      const s1Merged = { ...s1, state: 'merged' as const };
      expect(isReadyToMerge(s2, [s1Merged, s2])).toBe(true);
    });

    it('SQ-17: 10 and 11 approved, 11 depends on 10 -> 10 merges first, then 11', () => {
      const s10 = makeSpec('10', 1, 'approved');
      const s11 = makeSpec('11', 2, 'approved', ['10']);
      const specs = [s10, s11];

      // Next to merge should be s10
      const next1 = getNextSpecToMerge(specs);
      expect(next1?.id).toBe('10');

      // After 10 merges
      const s10Merged = { ...s10, state: 'merged' as const };
      const next2 = getNextSpecToMerge([s10Merged, s11]);
      expect(next2?.id).toBe('11');
    });

    it('SQ-14: merges approved specs in position order', () => {
      const sA = makeSpec('A', 1, 'approved');
      const sB = makeSpec('B', 2, 'approved');
      // Independent specs: A comes first because position is 1
      expect(getNextSpecToMerge([sA, sB])?.id).toBe('A');
    });
  });

  it('commits staged and untracked try changes before rebase and merges them to main', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'orch-spec-merge-'));
    const repoPath = path.join(tempDir, 'repo');
    fs.mkdirSync(repoPath);
    await runGit(['init', '-b', 'main', repoPath]);
    await runGit(['-C', repoPath, 'config', 'user.name', 'Test']);
    await runGit(['-C', repoPath, 'config', 'user.email', 'test@example.com']);
    fs.writeFileSync(path.join(repoPath, 'README.md'), 'base\n');
    await runGit(['-C', repoPath, 'add', 'README.md']);
    await runGit(['-C', repoPath, 'commit', '-m', 'base']);

    const git = new GitService();
    const created = await git.createWorktree({ repoPath, runId: 'spec-1' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    fs.mkdirSync(path.join(created.value.worktreePath, 'src'));
    fs.writeFileSync(path.join(created.value.worktreePath, 'src', 'add.js'), 'export default 1;\n');
    await runGit(['-C', created.value.worktreePath, 'add', 'src/add.js']);
    fs.writeFileSync(path.join(created.value.worktreePath, 'src', 'extra.js'), 'export default 2;\n');

    const spec = { ...makeSpec('1', 1), attempt: 3 };
    const result = await mergeApprovedSpec(spec, { repoPath, git });
    expect(result.ok && result.value.success, JSON.stringify(result)).toBe(true);
    expect((await runGit(['-C', repoPath, 'show', 'main:src/add.js'])).stdout).toContain('export default 1');
    expect((await runGit(['-C', repoPath, 'show', 'main:src/extra.js'])).stdout).toContain('export default 2');
    expect((await runGit(['-C', repoPath, 'log', '-1', '--format=%s%n%b'])).stdout).toMatch(/^Spec 1\norch: spec 1, verified/m);
  });

  it('uses the orch identity when the repository has no configured user.name', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'orch-spec-identity-'));
    const repoPath = path.join(tempDir, 'repo');
    fs.mkdirSync(repoPath);
    await runGit(['init', '-b', 'main', repoPath]);
    await runGit(['-C', repoPath, '-c', 'user.name=Initial', '-c', 'user.email=initial@localhost', 'commit', '--allow-empty', '-m', 'base']);
    const git = new GitService();
    git.removeWorktree = async () => ({ ok: true, value: undefined });
    const created = await git.createWorktree({ repoPath, runId: 'spec-1' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    fs.writeFileSync(path.join(created.value.worktreePath, 'added.txt'), 'content\n');
    const spec = makeSpec('1', 1);
    spec.spec.done_when = [{ by: 'check', text: 'configure main identity', check: { kind: 'command', run: 'configure' } }];
    const result = await mergeApprovedSpec(spec, {
      repoPath,
      git,
      commandRunner: async () => {
        await runGit(['-C', repoPath, 'config', 'user.name', 'Main']);
        await runGit(['-C', repoPath, 'config', 'user.email', 'main@localhost']);
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });
    expect(result.ok && result.value.success, JSON.stringify(result)).toBe(true);
    expect((await runGit(['-C', repoPath, 'log', 'orch/spec-1', '-1', '--format=%an <%ae>'])).stdout.trim()).toBe('orch <orch@localhost>');
  });
});
