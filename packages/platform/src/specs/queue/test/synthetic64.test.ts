import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { ok } from '@orchagents/base';
import type {
  ChangedFile,
  QueueId,
  Result,
  SpecId,
  SpecQueue,
  SpecRun,
  Timestamp,
} from '@orchagents/contracts';
import { DEFAULT_SPEC_QUEUE_SETTINGS } from '../common/scheduler.js';
import { SpecsQueueService } from '../node/specsQueueService.js';
import { FastSpecJobRunner } from '../node/specJobRunner.js';
import type {
  CreateWorktreeOptions,
  CreateWorktreeResult,
  IGitService,
  RemoveWorktreeOptions,
} from '../../../git/common/git.js';

class MockGitService implements IGitService {
  async ensureExclude(_repoPath: string): Promise<Result<void>> {
    void _repoPath;
    return ok(undefined);
  }
  async getDefaultBranch(_repoPath: string): Promise<Result<string>> {
    void _repoPath;
    return ok('main');
  }
  async createWorktree(options: CreateWorktreeOptions): Promise<Result<CreateWorktreeResult>> {
    return ok({
      worktreePath: path.join(options.repoPath, 'wt', options.runId),
      branch: `orch/${options.runId}`,
      targetBranch: 'main',
    });
  }
  async removeWorktree(_options: RemoveWorktreeOptions): Promise<Result<void>> {
    void _options;
    return ok(undefined);
  }
  async getChangedFiles(_worktreePath: string, _targetBranch: string): Promise<Result<ChangedFile[]>> {
    void _worktreePath;
    void _targetBranch;
    return ok([]);
  }
  async getDiff(_worktreePath: string, _targetBranch: string, _filePath?: string): Promise<Result<string>> {
    void _worktreePath;
    void _targetBranch;
    void _filePath;
    return ok('');
  }
}

describe('synthetic 64-spec queue', () => {
  it('completes 64-spec synthetic queue unattended without deadlocks', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-synth64-'));

    try {
      const numSpecs = 64;
      const specs: SpecRun[] = [];

      // 8 waves of 8 specs:
      // Wave 0: specs 1..8 (independent, scopes src/module-0..7/**)
      // Wave 1: specs 9..16 (spec 8+i depends on spec i)
      // etc.
      for (let i = 1; i <= numSpecs; i++) {
        const wave = Math.floor((i - 1) / 8);
        const col = (i - 1) % 8;
        const dependsOn: string[] = wave > 0 ? [String(i - 8)] : [];

        specs.push({
          id: String(i) as SpecId,
          queueId: 'q-synth' as QueueId,
          position: i,
          file: `docs/specs/${String(i).padStart(2, '0')}-spec.md`,
          spec: {
            id: String(i),
            title: `Synthetic Spec ${i}`,
            depends_on: dependsOn,
            scope: [`packages/mod-${col}/**`],
            done_when: [{ by: 'audit', text: `Audit for spec ${i}` }],
            agent: 'auto',
          },
          state: 'queued',
          attempt: null,
          jobId: null,
          worktree: null,
          implementer: null,
          criteria: [
            {
              index: 0,
              state: 'pending',
              summary: null,
              auditor: null,
            },
          ],
          blockedBy: [],
          startedAt: null,
          finishedAt: null,
          tokens: 0,
        });
      }

      const mockGit = new MockGitService();
      const fastRunner = new FastSpecJobRunner();

      const service = new SpecsQueueService({
        git: mockGit,
        jobRunner: fastRunner,
      });

      const initialQueue: SpecQueue = {
        id: 'q-synth' as QueueId,
        repoPath: tmp,
        paused: false,
        createdAt: new Date().toISOString() as Timestamp,
        settings: {
          ...DEFAULT_SPEC_QUEUE_SETTINGS,
          order: 'waves',
          max_parallel: 4,
          advance: 'verified',
        },
        specs,
      };

      service.initQueue(initialQueue);

      // Start queue
      const startRes = await service.start(initialQueue.id);
      expect(startRes.ok).toBe(true);

      // Wait for all 64 specs to reach 'verified'
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const current = service.getQueue(initialQueue.id);
        const verifiedCount = current?.specs.filter((s: SpecRun) => s.state === 'verified').length ?? 0;
        if (verifiedCount === numSpecs) {
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      const finalQueue = service.getQueue(initialQueue.id);
      expect(finalQueue).toBeDefined();
      const verifiedSpecs = finalQueue!.specs.filter((s: SpecRun) => s.state === 'verified');
      expect(verifiedSpecs).toHaveLength(64);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
