import { beforeEach, describe, expect, it } from 'vitest';
import type {
  QueueId,
  Result,
  SpecLoadProblem,
  SpecQueue,
  SpecQueueSettings,
} from '@orch/contracts';
import { SpecId } from '@orch/contracts';
import {
  cancelQueue,
  loadQueue,
  moveSpec,
  pauseQueue,
  resumeQueue,
  retrySpec,
  skipSpec,
  startQueue,
  updateQueueSettings,
  type SpecsPort,
} from '../src/browser/contrib/specs/actions.js';
import { useSpecsUiStore } from '../src/browser/contrib/specs/stores/specsUi.js';
import { useSpecsStore } from '../src/browser/services/stores/specs.js';
import { useWorkbenchStore } from '../src/browser/services/workbenchStore.js';

interface FakeSpecsPort extends SpecsPort {
  readonly loadCalls: string[];
  readonly startCalls: QueueId[];
  readonly pauseCalls: QueueId[];
  readonly resumeCalls: QueueId[];
  readonly cancelCalls: QueueId[];
  readonly updateSettingsCalls: [QueueId, Partial<SpecQueueSettings>][];
  readonly moveCalls: [QueueId, SpecId, number][];
  readonly skipCalls: [QueueId, SpecId][];
  readonly retryCalls: [QueueId, SpecId][];
  loadResult: Result<{ queue: SpecQueue | null; problems: SpecLoadProblem[] }>;
  actionResult: Result<void>;
  updateSettingsResult: Result<SpecQueueSettings>;
}

function makeFakePort(): FakeSpecsPort {
  return {
    loadCalls: [],
    startCalls: [],
    pauseCalls: [],
    resumeCalls: [],
    cancelCalls: [],
    updateSettingsCalls: [],
    moveCalls: [],
    skipCalls: [],
    retryCalls: [],
    loadResult: {
      ok: true,
      value: {
        queue: {
          id: 'q-test' as QueueId,
          repoPath: '/work/my-repo',
          paused: false,
          createdAt: '2026-10-11T09:00:00Z',
          settings: {
            source: 'docs/specs',
            order: 'strict',
            advance: 'verified',
            retries: 2,
            on_fail: 'retry-stop',
            max_parallel: 2,
            after_each: [],
          },
          specs: [],
        },
        problems: [],
      },
    },
    actionResult: { ok: true, value: undefined },
    updateSettingsResult: {
      ok: true,
      value: {
        source: 'docs/specs',
        order: 'waves',
        advance: 'approved',
        retries: 3,
        on_fail: 'retry-skip',
        max_parallel: 2,
        after_each: [],
      },
    },
    async load(repoPath) {
      this.loadCalls.push(repoPath);
      return this.loadResult;
    },
    async start(queueId) {
      this.startCalls.push(queueId);
      return this.actionResult;
    },
    async pause(queueId) {
      this.pauseCalls.push(queueId);
      return this.actionResult;
    },
    async resume(queueId) {
      this.resumeCalls.push(queueId);
      return this.actionResult;
    },
    async cancel(queueId) {
      this.cancelCalls.push(queueId);
      return this.actionResult;
    },
    async updateSettings(queueId, settings) {
      this.updateSettingsCalls.push([queueId, settings]);
      return this.updateSettingsResult;
    },
    async move(queueId, specId, toPosition) {
      this.moveCalls.push([queueId, specId, toPosition]);
      return this.actionResult;
    },
    async skip(queueId, specId) {
      this.skipCalls.push([queueId, specId]);
      return this.actionResult;
    },
    async retry(queueId, specId) {
      this.retryCalls.push([queueId, specId]);
      return this.actionResult;
    },
  };
}

describe('specs actions', () => {
  beforeEach(() => {
    useSpecsUiStore.setState({
      view: 'list',
      expandedId: null,
      selectedId: null,
      problems: [],
      loadError: null,
      saving: false,
    });
    useWorkbenchStore.getState().setActiveProject('/work/my-repo');
  });

  it('loadQueue loads queue and problems on success', async () => {
    const port = makeFakePort();
    await loadQueue(port);
    expect(port.loadCalls).toEqual(['/work/my-repo']);
    expect(useSpecsStore.getState().queues.find((q) => q.id === 'q-test')).toBeDefined();
    expect(useSpecsUiStore.getState().loadError).toBeNull();
  });

  it('loadQueue sets loadError when load fails', async () => {
    const port = makeFakePort();
    port.loadResult = {
      ok: false,
      error: { code: 'not_found', message: 'Failed to read specs', fix: 'Check repo folder' },
    };
    await loadQueue(port);
    expect(useSpecsUiStore.getState().loadError?.message).toBe('Failed to read specs');
  });

  it('start, pause, resume, cancel delegate to port', async () => {
    const port = makeFakePort();
    const qid = 'q-test' as QueueId;

    await startQueue(port, qid);
    expect(port.startCalls).toEqual([qid]);

    await pauseQueue(port, qid);
    expect(port.pauseCalls).toEqual([qid]);

    await resumeQueue(port, qid);
    expect(port.resumeCalls).toEqual([qid]);

    await cancelQueue(port, qid);
    expect(port.cancelCalls).toEqual([qid]);
  });

  it('updateQueueSettings calls port.updateSettings and handles saving state', async () => {
    const port = makeFakePort();
    const qid = 'q-test' as QueueId;

    await updateQueueSettings(port, qid, { order: 'waves' });
    expect(port.updateSettingsCalls).toEqual([[qid, { order: 'waves' }]]);
    expect(useSpecsUiStore.getState().saving).toBe(false);
  });

  it('moveSpec, skipSpec, retrySpec parse strings and call port', async () => {
    const port = makeFakePort();
    const qid = 'q-test' as QueueId;

    await moveSpec(port, qid, '02', 1);
    expect(port.moveCalls).toEqual([[qid, SpecId.parse('02'), 1]]);

    await skipSpec(port, qid, '03');
    expect(port.skipCalls).toEqual([[qid, SpecId.parse('03')]]);

    await retrySpec(port, qid, '04');
    expect(port.retryCalls).toEqual([[qid, SpecId.parse('04')]]);
  });
});
