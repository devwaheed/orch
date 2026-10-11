import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok } from '@orch/base';
import type {
  ChangedFile,
  OrchEvent,
  QueueId,
  Result,
  SpecId,
  SpecQueue,
  SpecRun,
  SpecState,
  Timestamp,
} from '@orch/contracts';
import type { CreateWorktreeOptions, CreateWorktreeResult, IGitService } from '../../../git/common/git.js';
import { DEFAULT_SPEC_QUEUE_SETTINGS } from '../common/scheduler.js';
import { SpecsQueueService } from '../node/specsQueueService.js';
import type { ISpecJobRunner, TryRunResult } from '../node/specJobRunner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BMAD_FIXTURE = path.resolve(__dirname, '../../../../test/fixtures/specs/bmad');

class NoopGitService implements IGitService {
  async ensureExclude(): Promise<Result<void>> {
    return ok(undefined);
  }
  async getDefaultBranch(): Promise<Result<string>> {
    return ok('main');
  }
  async createWorktree(options: CreateWorktreeOptions): Promise<Result<CreateWorktreeResult>> {
    const branch = `orch/${options.runId}`;
    return ok({ worktreePath: path.join(options.repoPath, 'wt', options.runId), branch, targetBranch: 'main' });
  }
  async removeWorktree(): Promise<Result<void>> {
    return ok(undefined);
  }
  async getChangedFiles(): Promise<Result<ChangedFile[]>> {
    return ok([]);
  }
  async getDiff(): Promise<Result<string>> {
    return ok('');
  }
}

/** A runner whose tries stay open until the test finishes them, so cancel can land mid-try. */
class GatedRunner implements ISpecJobRunner {
  readonly started: string[] = [];
  readonly cancelled: string[] = [];
  private release: ((result: TryRunResult) => void) | null = null;

  runTry(spec: SpecRun): Promise<TryRunResult> {
    this.started.push(spec.id);
    return new Promise<TryRunResult>((resolve) => {
      this.release = resolve;
    });
  }

  finish(result: TryRunResult): void {
    this.release?.(result);
    this.release = null;
  }

  async cancel(spec: SpecRun): Promise<void> {
    this.cancelled.push(spec.id);
  }
}

const makeSpec = (id: string, position: number, state: SpecState): SpecRun => ({
  id: id as SpecId,
  queueId: 'q-cancel' as QueueId,
  position,
  file: `docs/specs/${id}.md`,
  spec: {
    id,
    title: `Spec ${id}`,
    depends_on: [],
    scope: [`src/${id}/**`],
    done_when: [{ by: 'audit', text: 'Audit' }],
    agent: 'auto',
  },
  state,
  attempt: state === 'queued' ? null : 1,
  jobId: null,
  worktree: null,
  implementer: null,
  criteria: [{ index: 0, state: 'pending', summary: null, auditor: null }],
  blockedBy: [],
  startedAt: null,
  finishedAt: null,
  tokens: 0,
});

const makeQueue = (repoPath: string, specs: SpecRun[]): SpecQueue => ({
  id: 'q-cancel' as QueueId,
  repoPath,
  paused: false,
  createdAt: new Date().toISOString() as Timestamp,
  settings: { ...DEFAULT_SPEC_QUEUE_SETTINGS },
  specs,
});

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('SpecsQueueService.cancel (spec-queue.md §9)', () => {
  let tmp: string;
  let events: OrchEvent[];
  let runner: GatedRunner;
  let service: SpecsQueueService;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-specs-cancel-'));
    events = [];
    runner = new GatedRunner();
    service = new SpecsQueueService({
      git: new NoopGitService(),
      jobRunner: runner,
      onEvent: (event) => events.push(event),
    });
  });

  afterEach(async () => {
    service.dispose();
    await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  });

  it('sets every non-merged spec to cancelled and leaves merged specs alone', async () => {
    const queue = makeQueue(tmp, [
      makeSpec('1', 1, 'running'),
      makeSpec('2', 2, 'queued'),
      makeSpec('3', 3, 'waiting_quota'),
      makeSpec('4', 4, 'verified'),
      makeSpec('5', 5, 'needs_you'),
      makeSpec('6', 6, 'skipped'),
      makeSpec('7', 7, 'merged'),
      makeSpec('8', 8, 'cancelled'),
    ]);
    service.initQueue(queue);

    const res = await service.cancel(queue.id);
    expect(res.ok).toBe(true);

    const states = Object.fromEntries(service.getQueue(queue.id)!.specs.map((s) => [s.id, s.state]));
    expect(states).toEqual({
      '1': 'cancelled',
      '2': 'cancelled',
      '3': 'cancelled',
      '4': 'cancelled',
      '5': 'cancelled',
      '6': 'cancelled',
      '7': 'merged',
      '8': 'cancelled',
    });
    expect(events.some((e) => e.type === 'queue.changed')).toBe(true);
  });

  it('stops only specs that have a try in progress and keeps their worktrees (runner.cancel)', async () => {
    const queue = makeQueue(tmp, [makeSpec('1', 1, 'running'), makeSpec('2', 2, 'queued'), makeSpec('3', 3, 'verified')]);
    service.initQueue(queue);

    await service.cancel(queue.id);

    expect(runner.cancelled).toEqual(['1']);
  });

  it('persists the cancelled states', async () => {
    const queue = makeQueue(tmp, [makeSpec('1', 1, 'queued'), makeSpec('2', 2, 'merged')]);
    service.initQueue(queue);

    await service.cancel(queue.id);

    const saved = JSON.parse(await fs.readFile(path.join(tmp, '.orch', 'queue-state.json'), 'utf8')) as {
      specs: Array<{ id: string; state: SpecState }>;
    };
    expect(saved.specs.map((s) => [s.id, s.state])).toEqual([
      ['1', 'cancelled'],
      ['2', 'merged'],
    ]);
  });

  it('a try that finishes after cancel does not move the spec out of cancelled', async () => {
    const queue = makeQueue(tmp, [makeSpec('1', 1, 'queued')]);
    service.initQueue(queue);

    await service.start(queue.id);
    await waitFor(() => runner.started.length === 1);

    await service.cancel(queue.id);
    expect(service.getQueue(queue.id)!.specs[0]!.state).toBe('cancelled');

    runner.finish({ success: true, criterionResults: [] });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const spec = service.getQueue(queue.id)!.specs[0]!;
    expect(spec.state).toBe('cancelled');
    expect(spec.finishedAt).toBeNull();
    expect(spec.criteria).toEqual([{ index: 0, state: 'pending', summary: null, auditor: null }]);
  });

  it('returns not_found for an unknown queue', async () => {
    const res = await service.cancel('q-missing' as QueueId);
    expect(res.ok).toBe(false);
  });
});

describe('SpecsQueueService.init (orch specs init, spec-queue.md §2, §13)', () => {
  let tmp: string;
  let service: SpecsQueueService;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-specs-init-'));
    service = new SpecsQueueService({ git: new NoopGitService(), jobRunner: new GatedRunner() });
  });

  afterEach(async () => {
    service.dispose();
    await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  });

  it('adds front matter to stories without it and reports the ones that already had it', async () => {
    await fs.cp(BMAD_FIXTURE, path.join(tmp, 'docs', 'stories'), { recursive: true });

    const res = await service.init(tmp);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.added).toHaveLength(2);
    expect(res.value.added.find((item) => item.id === '1')?.title).toBe('User login');
    expect(res.value.skipped).toEqual(['003-already-init.md']);
  });

  it('returns an OrchError with a fix when there is no stories folder', async () => {
    const res = await service.init(tmp);

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('not_found');
    expect(res.error.fix).toBeTruthy();
  });
});
