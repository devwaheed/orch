import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok } from '@orchagents/base';
import { SpecDraft } from '@orchagents/contracts';
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
} from '@orchagents/contracts';
import type { CreateWorktreeOptions, CreateWorktreeResult, IGitService } from '../../../git/common/git.js';
import { DEFAULT_SPEC_QUEUE_SETTINGS } from '../common/scheduler.js';
import { SpecsQueueService } from '../node/specsQueueService.js';
import type { ISpecJobRunner, TryRunResult } from '../node/specJobRunner.js';
import { specDraftToCommand } from '../common/toCommand.js';
import { parseSpecContent } from '../../loader/node/frontMatter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BMAD_FIXTURE = path.resolve(__dirname, '../../../../test/fixtures/specs/bmad');

function commandWords(command: string): string[] {
  const words: string[] = [];
  const pattern = /(?:"(?:\\.|[^"\\])*"|[^\s]+)/g;
  for (const match of command.matchAll(pattern)) {
    const word = match[0];
    words.push(word.startsWith('"') ? JSON.parse(word) as string : word);
  }
  return words;
}

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
    mode: 'single',
    agents: [],
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
  history: [],
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

  it('stops specs with a live or quota-paused try and keeps their worktrees (runner.cancel)', async () => {
    const queue = makeQueue(tmp, [makeSpec('1', 1, 'running'), makeSpec('2', 2, 'queued'), makeSpec('3', 3, 'waiting_quota')]);
    service.initQueue(queue);

    await service.cancel(queue.id);

    expect(runner.cancelled).toEqual(['1', '3']);
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

describe('SpecsQueueService.create (ADR 0013, spec-queue.md §2)', () => {
  let tmp: string;
  let service: SpecsQueueService;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-specs-create-'));
    await fs.mkdir(path.join(tmp, 'docs', 'specs'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'docs', 'specs', '007-existing.md'), '---\nid: "7"\ntitle: Existing\nscope: [src/**]\ndone_when:\n  - by: audit\n    text: Existing check\n---\nexisting body\n');
    service = new SpecsQueueService({ git: new NoopGitService(), jobRunner: new GatedRunner() });
  });

  afterEach(async () => {
    service.dispose();
    await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  });

  it('writes a loadable spec with the next id, default audit, and run-next ordering', async () => {
    const res = await service.create(tmp, {
      title: 'Next Spec', body: 'Build the feature.', mode: 'single', agent: 'auto', agents: [], scope: ['src/**'], done_when: [], runNext: true,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.id).toBe('8');
    expect(res.value.file).toBe('docs/specs/008-next-spec.md');
    const content = await fs.readFile(path.join(tmp, res.value.file), 'utf8');
    const parsed = parseSpecContent(content, res.value.file);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.spec.done_when).toEqual([{ by: 'audit', text: 'The goal is met' }]);
      expect(parsed.data.body.trim()).toBe('Build the feature.');
    }
    expect(service.getQueue(res.value.queueId)?.specs.map((spec) => spec.id)).toEqual(['8', '7']);
  });

  it('refuses to overwrite an existing file', async () => {
    const draft = { title: 'Next Spec', body: '', mode: 'single' as const, agent: 'auto' as const, agents: [], scope: [], done_when: [], runNext: false };
    const [first, second] = await Promise.all([service.create(tmp, draft), service.create(tmp, draft)]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect([first.ok, second.ok].filter((ok) => !ok)).toHaveLength(1);
    const files = (await fs.readdir(path.join(tmp, 'docs', 'specs'))).filter((name) => name.startsWith('008-next-spec'));
    expect(files).toHaveLength(1);
    expect((await fs.readFile(path.join(tmp, 'docs', 'specs', files[0]!), 'utf8')).match(/title: Next Spec/g)).toHaveLength(1);
  });

  it('round-trips a draft through the generated CLI command flags', () => {
    const draft = SpecDraft.parse({
      title: 'A "quoted" title', body: 'two words', mode: 'compare', agent: 'auto', agents: ['claude', 'codex'], scope: ['src/**'],
      done_when: [
        { by: 'check', text: 'pnpm test --run', check: { kind: 'command', run: 'pnpm test --run' } },
        { by: 'check', text: 'https://example.test', check: { kind: 'http', url: 'https://example.test', expectStatus: 200 } },
        { by: 'audit', text: 'The result is correct' },
      ], runNext: true,
    });
    const words = commandWords(specDraftToCommand(draft));
    expect(words.slice(0, 3)).toEqual(['orch', 'specs', 'add']);
    const parsed = { title: words[3]!, body: '', mode: 'single', agent: 'auto', agents: [] as string[], scope: [] as string[], done_when: [] as unknown[], runNext: false };
    for (let i = 4; i < words.length; i++) {
      const flag = words[i]!;
      const value = words[i + 1];
      if (flag === '--body') { parsed.body = value ?? ''; i++; }
      else if (flag === '--mode') { parsed.mode = value ?? 'single'; i++; }
      else if (flag === '--agent') { if (value) parsed.agents.push(value); i++; }
      else if (flag === '--check' && value) { parsed.done_when.push({ by: 'check', text: value, check: { kind: 'command', run: value } }); i++; }
      else if (flag === '--web-check' && value) { parsed.done_when.push({ by: 'check', text: value, check: { kind: 'http', url: value, expectStatus: 200 } }); i++; }
      else if (flag === '--allow' && value) { parsed.scope.push(value); i++; }
      else if (flag === '--audit' && value) { parsed.done_when.push({ by: 'audit', text: value }); i++; }
      else if (flag === '--next') parsed.runNext = true;
    }
    expect(SpecDraft.parse(parsed)).toEqual(SpecDraft.parse(draft));
  });
});
